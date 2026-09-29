// Role model + authorization. See docs/ARCHITECTURE.md "Auth / authorization
// design" for the full reasoning — this file is the one place that logic
// lives, so UI gating and server-side write checks can never drift apart.
import type { Request, Response } from 'express';
import type { RequestIdentity } from './auth';
import type { AppKitHandle } from './appkitTypes';

export const ROLES = ['Estimator', 'Lead Engineer', 'Design Lead', 'Admin'] as const;
export type Role = (typeof ROLES)[number];

// Workspace *group* names differ from the in-app *role* label — originally
// just for Admin (`piping_admin`, to avoid colliding with the workspace's
// generic `admins` group), but now for all 4: these groups were migrated
// from workspace-local SCIM groups to **account-level** groups (so a user
// can select/assume one at login, which workspace-local groups don't
// support), and the account already had unrelated groups named exactly
// `Estimator` etc. from other workloads sharing this account — so all 4 got
// a ` Piping` suffix on creation. The role a user sees/holds in the app is
// unaffected either way — still "Estimator"/"Lead Engineer"/"Design
// Lead"/"Admin". Confirmed the workspace's SCIM `Me` call (see auth.ts)
// surfaces account-group membership identically to how it surfaced
// workspace-group membership — no other code needed to change for this
// migration, only this mapping's keys.
const GROUP_TO_ROLE: Record<string, Role> = {
  'Estimator Piping': 'Estimator',
  'Lead Engineer Piping': 'Lead Engineer',
  'Design Lead Piping': 'Design Lead',
  'Admin Piping': 'Admin',
};

// Databricks RBAC "assume role" embeds the assumed group's numeric ID (not
// display name) as an `ag` claim in the forwarded OBO access token — see
// auth.ts's getRequestIdentity for how this is read, and
// ARCHITECTURE.md's "assume role" investigation for how this claim was
// found (only appears via a genuinely fresh OAuth authorization flow with a
// role explicitly picked during it — the in-session workspace role switcher
// and the `aid=` URL param against an already-authenticated session both
// leave the forwarded token, and this claim, completely absent). IDs
// confirmed directly via `databricks current-user me`; kept as a separate
// ID-keyed map rather than merged into GROUP_TO_ROLE since it's a different
// keyspace (id vs. display name) for the same 4 groups — auth.ts uses this
// to resolve an `ag` claim back to a display name, which then flows through
// GROUP_TO_ROLE exactly like normal group membership would.
export const GROUP_ID_TO_NAME: Record<string, string> = {
  '153366456771408': 'Estimator Piping',
  '149555560035170': 'Lead Engineer Piping',
  '153030422207286': 'Design Lead Piping',
  '151444824573483': 'Admin Piping',
};

export function eligibleRoles(groups: string[]): Role[] {
  const set = new Set<Role>();
  for (const g of groups) {
    const role = GROUP_TO_ROLE[g];
    if (role) set.add(role);
  }
  // The SCIM `Me` endpoint's `groups` array order is not stable — confirmed
  // directly (two identical calls, same token, no params changed, returned
  // groups in two different orders). Left unsorted, this made the landing
  // page's role badges visibly reorder/reflow on every load. Sort into the
  // fixed ROLES order so the UI is deterministic regardless of API ordering.
  return ROLES.filter((r) => set.has(r));
}

/** Stage number (1-6) -> the role that performs that stage's action. */
export const STAGE_ROLE: Record<number, Role> = {
  1: 'Estimator',
  2: 'Lead Engineer',
  3: 'Design Lead',
  4: 'Lead Engineer',
  5: 'Design Lead',
  6: 'Lead Engineer',
};

export const STAGE_NAMES: Record<number, string> = {
  1: 'Initial Data Entry',
  2: 'Initial Engineer Confirmation',
  3: 'Preliminary True-Up Complete',
  4: 'Engineer Prelim True-Up Confirmation',
  5: 'Final True-Up Complete',
  6: 'Engineer Final Confirmation',
};

export const STAGE_EVENT_TYPE: Record<number, string> = {
  1: 'INITIAL_DATA_ENTRY',
  2: 'INITIAL_ENGINEER_CONFIRMATION',
  3: 'PRELIM_TRUE_UP_COMPLETE',
  4: 'ENGINEER_PRELIM_TRUE_UP_CONFIRMATION',
  5: 'FINAL_TRUE_UP_COMPLETE',
  6: 'ENGINEER_FINAL_CONFIRMATION',
};

const VIEW_AS_COOKIE = 'piping_view_as_role';

export function getViewAsOverride(req: Request): Role | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === VIEW_AS_COOKIE) {
      const v = decodeURIComponent(rest.join('='));
      return (ROLES as readonly string[]).includes(v) ? (v as Role) : null;
    }
  }
  return null;
}

export function setViewAsCookie(res: Response, role: Role | null) {
  if (role === null) {
    res.setHeader('Set-Cookie', `${VIEW_AS_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`);
  } else {
    res.setHeader(
      'Set-Cookie',
      `${VIEW_AS_COOKIE}=${encodeURIComponent(role)}; Path=/; Max-Age=2592000; SameSite=Lax`,
    );
  }
}

export interface EffectiveRole {
  email: string;
  eligibleRoles: Role[];
  /** The role to act as for this project right now — null means no access. */
  role: Role | null;
  /** true when `role` came from the "view as" override, not a real assignment. */
  isOverride: boolean;
}

/**
 * The single function backing both UI gating (via GET /api/projects/:id) and
 * every write route's server-side check. See ARCHITECTURE.md for the
 * eligibility-vs-assignment reconciliation rule this implements.
 */
export async function getEffectiveRole(
  appkit: AppKitHandle,
  req: Request,
  identity: RequestIdentity,
  projectId: string,
): Promise<EffectiveRole> {
  const eligible = eligibleRoles(identity.groups);

  const viewAs = getViewAsOverride(req);
  if (viewAs && eligible.includes(viewAs)) {
    return { email: identity.email, eligibleRoles: eligible, role: viewAs, isOverride: true };
  }

  const { rows } = await appkit.lakebase.query<{ role: string }>(
    'SELECT role FROM user_project_role WHERE user_email = $1 AND project_id = $2',
    [identity.email, projectId],
  );
  const assigned = rows[0]?.role as Role | undefined;
  if (assigned && eligible.includes(assigned)) {
    return { email: identity.email, eligibleRoles: eligible, role: assigned, isOverride: false };
  }

  // Admins can act on any project even without an explicit per-project row.
  if (eligible.includes('Admin')) {
    return { email: identity.email, eligibleRoles: eligible, role: 'Admin', isOverride: false };
  }

  return { email: identity.email, eligibleRoles: eligible, role: null, isOverride: false };
}

/**
 * Returns true and does nothing if authorized; sends 403 and returns false
 * otherwise. Deliberately exact-match only — `Admin` is an administrative
 * role (manage project/role assignments, view everything), not a superset of
 * the workflow roles. An Admin performs a stage action only by switching
 * "view as" to a role they're also really a group-member of (conor.smith,
 * the tester, is in all 4 groups; a real production Admin typically is not,
 * and that's the point — separation of duties stays real, not a superuser
 * bypass dressed up as a role).
 */
export function requireRole(res: Response, effective: EffectiveRole, allowed: Role[]): boolean {
  if (effective.role && allowed.includes(effective.role)) {
    return true;
  }
  res.status(403).json({
    error: `This action requires role ${allowed.join(' or ')}; you are ${effective.role ?? 'unassigned'} on this project.`,
  });
  return false;
}
