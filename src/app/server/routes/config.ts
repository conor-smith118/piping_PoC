import type { AppKitHandle } from '../lib/appkitTypes';

// The dashboard has no AppKit resource type of its own (no `dashboard` entry
// in the platform's resource table — only sql-warehouse, serving-endpoint,
// lakebase, etc.), so its ID is just a plain env var, not a permission-
// bearing `valueFrom` resource. See app.yaml.
const DASHBOARD_ID = process.env.DASHBOARD_ID ?? '';

export function registerConfigRoutes(appkit: AppKitHandle) {
  appkit.server.extend((app) => {
    app.get('/api/config', (_req, res) => {
      const rawHost = process.env.DATABRICKS_HOST ?? '';
      // Same gotcha as lib/auth.ts: DATABRICKS_HOST has no scheme in the
      // deployed runtime, unlike local CLI output.
      const host = rawHost ? (/^https?:\/\//.test(rawHost) ? rawHost : `https://${rawHost}`) : '';
      const workspaceId = process.env.DATABRICKS_WORKSPACE_ID ?? '';
      const embedBaseUrl =
        host && DASHBOARD_ID ? `${host.replace(/\/$/, '')}/embed/dashboardsv3/${DASHBOARD_ID}?o=${workspaceId}` : null;
      res.json({ dashboardId: DASHBOARD_ID || null, embedBaseUrl });
    });
  });
}
