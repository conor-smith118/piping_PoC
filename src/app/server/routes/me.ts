import type { AppKitHandle } from '../lib/appkitTypes';
import { getRequestIdentity } from '../lib/auth';
import { eligibleRoles, getViewAsOverride } from '../lib/roles';

export function registerMeRoutes(appkit: AppKitHandle) {
  appkit.server.extend((app) => {
    app.get('/api/me', async (req, res) => {
      try {
        const identity = await getRequestIdentity(req);
        res.json({
          email: identity.email,
          eligibleRoles: eligibleRoles(identity.groups),
          viewAsRole: getViewAsOverride(req),
          isDevFallback: identity.isDevFallback,
        });
      } catch (err) {
        console.error('GET /api/me failed:', err);
        res.status(500).json({ error: 'Failed to resolve identity' });
      }
    });
  });
}
