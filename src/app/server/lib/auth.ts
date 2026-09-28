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
import type { Request } from 'express';

export interface RequestIdentity {
  email: string;
  groups: string[];
  /** true when running without real OBO headers (local dev only) */
  isDevFallback: boolean;
}

// Local dev only: no reverse proxy, so no forwarded headers exist. Mirrors
// conor.smith's real membership (all 4 groups) so local testing can exercise
// every role via the same "view as" switcher used in the deployed app.
const DEV_FALLBACK_EMAIL = 'conor.smith@databricks.com';
const DEV_FALLBACK_GROUPS = ['Estimator', 'Lead Engineer', 'Design Lead', 'piping_admin'];

const groupsCache = new Map<string, { groups: string[]; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchGroupsFromScim(accessToken: string): Promise<string[]> {
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
  const data = (await resp.json()) as { groups?: { display?: string }[] };
  return (data.groups ?? []).map((g) => g.display).filter((d): d is string => !!d);
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

  const cached = groupsCache.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) {
    return { email, groups: cached.groups, isDevFallback: false };
  }

  // A transient SCIM/network failure should degrade to "no groups" (the user
  // sees no access, gets a clear 403 downstream) rather than crash the
  // request — or worse, the whole process, if some caller forgets a
  // try/catch of its own. Every route handler still has its own try/catch
  // (defense in depth), but this is the one place literally every request
  // passes through, so it gets the strictest guarantee.
  let groups: string[] = [];
  try {
    groups = await fetchGroupsFromScim(accessToken);
  } catch (err) {
    console.error('[auth] Failed to resolve group membership:', err);
  }
  groupsCache.set(accessToken, { groups, expiresAt: Date.now() + CACHE_TTL_MS });
  return { email, groups, isDevFallback: false };
}
