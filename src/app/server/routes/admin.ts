import { z } from 'zod';
import type { AppKitHandle } from '../lib/appkitTypes';
import { getRequestIdentity } from '../lib/auth';
import { eligibleRoles, ROLES } from '../lib/roles';

// Presentational only — NOT part of the authorization logic of record (that
// stays entirely in lib/roles.ts's getEffectiveRole/eligibleRoles). Shown in
// the admin UI purely so an admin assigning a role knows which workspace
// group the target user needs to actually belong to. See the big comment on
// POST /api/admin/roles below for why this route doesn't (and doesn't need
// to) independently re-verify that membership before writing the row.
const ROLE_TO_GROUP: Record<string, string> = {
  Estimator: 'Estimator',
  'Lead Engineer': 'Lead Engineer',
  'Design Lead': 'Design Lead',
  Admin: 'piping_admin',
};

const AssignBody = z.object({
  userEmail: z.string().email(),
  projectId: z.string().min(1),
  role: z.enum(ROLES),
});

const RevokeBody = z.object({
  userEmail: z.string().email(),
  projectId: z.string().min(1),
});

export function registerAdminRoutes(appkit: AppKitHandle) {
  appkit.server.extend((app) => {
    // GET /api/admin/overview — Admin-only. Everything the /admin page needs
    // in one call: the 5 live projects (for the assignment form's project
    // picker), every current user_project_role row across all of them (so an
    // admin sees the full picture, not just one project at a time), the
    // fixed role list, and the role->group reference mapping.
    app.get('/api/admin/overview', async (req, res) => {
      try {
        const identity = await getRequestIdentity(req);
        if (!eligibleRoles(identity.groups).includes('Admin')) {
          res.status(403).json({ error: 'Admins only.' });
          return;
        }

        const { rows: projects } = await appkit.lakebase.query<{ project_id: string; project_name: string }>(
          'SELECT project_id, project_name FROM projects ORDER BY project_name',
        );
        const { rows: assignments } = await appkit.lakebase.query<{
          user_email: string;
          project_id: string;
          role: string;
          assigned_by: string | null;
          assigned_at: string;
        }>('SELECT user_email, project_id, role, assigned_by, assigned_at FROM user_project_role ORDER BY project_id, user_email');

        res.json({
          projects: projects.map((p) => ({ projectId: p.project_id, projectName: p.project_name })),
          assignments: assignments.map((a) => ({
            userEmail: a.user_email,
            projectId: a.project_id,
            role: a.role,
            assignedBy: a.assigned_by,
            assignedAt: a.assigned_at,
          })),
          roles: ROLES,
          roleToGroup: ROLE_TO_GROUP,
        });
      } catch (err) {
        console.error('GET /api/admin/overview failed:', err);
        res.status(500).json({ error: 'Failed to load admin overview' });
      }
    });

    // POST /api/admin/roles — Admin-only. Assigns (or reassigns) a role to a
    // user for a project.
    //
    // Deliberately does NOT make a live workspace-directory call to verify
    // the target user is actually a member of the matching group before
    // writing this row. Two reasons: (1) the app's server-side identity here
    // is the calling admin's own OBO token, which is only good for looking
    // up *that admin's own* group memberships (see lib/auth.ts) — checking
    // an arbitrary *other* user's memberships needs a workspace-directory
    // (SCIM Groups) call under a different, more-privileged identity than
    // this app has ever needed so far, and (2) it isn't actually a security
    // gap even without it: getEffectiveRole (lib/roles.ts) independently
    // re-checks every assignment against the ACTING user's real group
    // membership on every single request, and simply won't honor a row
    // written here for a role the target user isn't really a group-member
    // of — a mismatched assignment silently has no effect rather than
    // granting unintended access. This route is a convenience for recording
    // *intended* assignments, not the security boundary itself.
    app.post('/api/admin/roles', async (req, res) => {
      try {
        const identity = await getRequestIdentity(req);
        if (!eligibleRoles(identity.groups).includes('Admin')) {
          res.status(403).json({ error: 'Admins only.' });
          return;
        }
        const parsed = AssignBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'userEmail, projectId, and a valid role are required.' });
          return;
        }
        const { userEmail, projectId, role } = parsed.data;
        await appkit.lakebase.query(
          `INSERT INTO user_project_role (user_email, project_id, role, assigned_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_email, project_id)
           DO UPDATE SET role = EXCLUDED.role, assigned_by = EXCLUDED.assigned_by, assigned_at = now()`,
          [userEmail, projectId, role, identity.email],
        );
        res.json({ userEmail, projectId, role });
      } catch (err) {
        console.error('POST /api/admin/roles failed:', err);
        res.status(500).json({ error: 'Failed to save role assignment' });
      }
    });

    // DELETE /api/admin/roles — Admin-only. Revokes a user's assignment on a
    // project entirely (they keep whatever coarse group membership they
    // have, but lose the per-project row that makes getEffectiveRole honor
    // it for this specific project).
    app.delete('/api/admin/roles', async (req, res) => {
      try {
        const identity = await getRequestIdentity(req);
        if (!eligibleRoles(identity.groups).includes('Admin')) {
          res.status(403).json({ error: 'Admins only.' });
          return;
        }
        const parsed = RevokeBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'userEmail and projectId are required.' });
          return;
        }
        const { userEmail, projectId } = parsed.data;
        await appkit.lakebase.query('DELETE FROM user_project_role WHERE user_email = $1 AND project_id = $2', [
          userEmail,
          projectId,
        ]);
        res.status(204).end();
      } catch (err) {
        console.error('DELETE /api/admin/roles failed:', err);
        res.status(500).json({ error: 'Failed to revoke role assignment' });
      }
    });
  });
}
