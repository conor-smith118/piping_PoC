// User identity + group membership resolution.
//
// Databricks Apps injects the calling user's identity via reverse-proxy
// headers (see AppKit "execution-context" docs): `x-forwarded-email` carries
// the email, `x-forwarded-access-token` carries a short-lived OAuth token.
// User authorization is GA and on by default for every app (no
// `user_api_scopes` declaration needed for this) — it always includes the
// `iam.current-user:read` default scope, which is exactly what's needed
// here. Declaring that scope explicitly is actually rejected by the
// workspace API (INVALID_PARAMETER_VALUE) since it's an automatic default,
// not a requestable one — confirmed against this exact workspace.
//
// We use that token for exactly one OBO call: the SCIM "Me" endpoint, to read
// the caller's real workspace group memberships. This is deliberately NOT
// going through a generic Databricks SDK "current user" helper — the AppKit
// docs don't document one, and the raw REST shape here is already confirmed
// against this exact workspace (`databricks current-user me` returns a
// `groups` array with `.display` names matching our 4 role groups).
//
// Databricks RBAC "assume role" support: the forwarded token itself is a
// JWT, and when the caller went through a fresh OAuth authorization flow
// and explicitly picked a role, its decoded payload carries an `ag`
// ("assumed group") claim with that role's backing group ID — found by
// direct empirical testing, documented in ARCHITECTURE.md. When present, it
// takes priority over the full SCIM group list, narrowing this request's
// identity to just that one assumed role. The ID is resolved to a display
// name by matching it against the SAME SCIM `Me` call's `groups[].value`
// field (confirmed directly against a live workspace: SCIM `Me` returns
// `{display, value, $ref}` per group, and `value` is exactly the same
// numeric-string ID format as the `ag` claim) — deliberately NOT a
// hardcoded, account-specific ID->name table, since a caller can only ever
// assume a group they are themselves a member of, which SCIM `Me` always
// includes. This makes the whole mechanism portable to any account's groups
// with zero config.
import type { Request } from 'express';

export interface RequestIdentity {
  email: string;
  groups: string[];
  /** true when running without real OBO headers (local dev only) */
  isDevFallback: boolean;
}

// Local dev only: no reverse proxy, so no forwarded headers exist. Mirrors
// membership in all 4 role groups so local testing can exercise every role
// via the same "view as" switcher used in the deployed app. Harmless to
// leave as-is for any deployment — this path is never reachable once the
// app runs behind the real Databricks Apps proxy (see the !email/!accessToken
// check below), which always forwards both headers.
const DEV_FALLBACK_EMAIL = 'dev.fallback@example.com';
const DEV_FALLBACK_GROUPS = ['Estimator Piping', 'Lead Engineer Piping', 'Design Lead Piping', 'Admin Piping'];

interface ScimGroup {
  id: string;
  display: string;
}

const groupsCache = new Map<string, { groups: ScimGroup[]; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Decodes a JWT's payload segment without verifying its signature — safe
 * here because we never trust the *content* on its own; the token is only
 * ever used as the actual OBO bearer credential for the SCIM call below (or,
 * when `ag` is present, we trust it precisely because Databricks itself
 * already only ever issues that claim after checking Assume permission —
 * the same trust boundary as everything else forwarded by the platform's
 * own reverse proxy). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fetchGroupsFromScim(accessToken: string): Promise<ScimGroup[]> {
  const rawHost = process.env.DATABRICKS_HOST;
  if (!rawHost) {
    console.warn('[auth] DATABRICKS_HOST not set; cannot resolve group membership');
    return [];
  }
  // Confirmed against the actual deployed runtime: DATABRICKS_HOST there is a
  // bare hostname (e.g. "adb-....azuredatabricks.net"), NOT a full URL with
  // scheme — unlike `databricks auth env`'s local-CLI output, which does
  // include "https://". Handle both rather than assume either.
  const host = /^https?:\/\//.test(rawHost) ? rawHost : `https://${rawHost}`;
  const url = `${host.replace(/\/$/, '')}/api/2.0/preview/scim/v2/Me`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    console.warn(`[auth] SCIM Me lookup failed: ${resp.status} ${resp.statusText}`);
    return [];
  }
  const data = (await resp.json()) as { groups?: { display?: string; value?: string }[] };
  return (data.groups ?? [])
    .filter((g): g is { display: string; value: string } => !!g.display && !!g.value)
    .map((g) => ({ id: g.value, display: g.display }));
}

async function getGroupsCached(accessToken: string): Promise<ScimGroup[]> {
  const cached = groupsCache.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.groups;
  }
  // A transient SCIM/network failure should degrade to "no groups" (the user
  // sees no access, gets a clear 403 downstream) rather than crash the
  // request — or worse, the whole process, if some caller forgets a
  // try/catch of its own. Every route handler still has its own try/catch
  // (defense in depth), but this is the one place literally every request
  // passes through, so it gets the strictest guarantee.
  let groups: ScimGroup[] = [];
  try {
    groups = await fetchGroupsFromScim(accessToken);
  } catch (err) {
    console.error('[auth] Failed to resolve group membership:', err);
  }
  groupsCache.set(accessToken, { groups, expiresAt: Date.now() + CACHE_TTL_MS });
  return groups;
}

/**
 * Resolve the calling user's email + real workspace group memberships.
 * Falls back to a fixed dev identity when forwarded-auth headers are absent
 * (i.e. `npm run dev` locally, not behind the Databricks Apps proxy).
 */
export async function getRequestIdentity(req: Request): Promise<RequestIdentity> {
  const email = req.header('x-forwarded-email');
  const accessToken = req.header('x-forwarded-access-token');

  if (!email || !accessToken) {
    return { email: DEV_FALLBACK_EMAIL, groups: DEV_FALLBACK_GROUPS, isDevFallback: true };
  }

  const assumedGroupId = decodeJwtPayload(accessToken)?.ag;
  const scimGroups = await getGroupsCached(accessToken);

  if (typeof assumedGroupId === 'string') {
    const assumed = scimGroups.find((g) => g.id === assumedGroupId);
    if (assumed) {
      // Narrow to exactly the assumed role, regardless of how many groups
      // this account is a member of — the whole point of "assume role".
      return { email, groups: [assumed.display], isDevFallback: false };
    }
    // `ag` present but not found in this user's own SCIM group list should
    // not happen (Databricks only issues `ag` for a group the caller is
    // already a member of) — fall through to the full list rather than
    // silently granting zero access on an unexpected mismatch.
  }

  return { email, groups: scimGroups.map((g) => g.display), isDevFallback: false };
}
