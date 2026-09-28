import { z } from 'zod';
import type { AppKitHandle } from '../lib/appkitTypes';
import { getRequestIdentity } from '../lib/auth';
import { eligibleRoles, setViewAsCookie, ROLES } from '../lib/roles';

const Body = z.object({ role: z.enum(ROLES).nullable() });

/**
 * Admin-only, bounded-by-real-group-membership "view as role" switcher — see
 * ARCHITECTURE.md for why this is not an unbounded superuser bypass. Only
 * lets the caller preview/act as a role they are actually a group-member of.
 */
export function registerViewAsRoutes(appkit: AppKitHandle) {
  appkit.server.extend((app) => {
    app.post('/api/view-as', async (req, res) => {
      try {
        const parsed = Body.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'Invalid role' });
          return;
        }
        const identity = await getRequestIdentity(req);
        const eligible = eligibleRoles(identity.groups);
        if (!eligible.includes('Admin')) {
          res.status(403).json({ error: 'Only Admin-group members can use the view-as switcher.' });
          return;
        }
        const role = parsed.data.role;
        if (role !== null && !eligible.includes(role)) {
          res.status(403).json({ error: `You are not a member of the ${role} group.` });
          return;
        }
        setViewAsCookie(res, role);
        res.json({ role });
      } catch (err) {
        console.error('POST /api/view-as failed:', err);
        res.status(500).json({ error: 'Failed to update view-as role' });
      }
    });
  });
}
