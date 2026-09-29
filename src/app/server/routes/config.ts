import type { AppKitHandle } from '../lib/appkitTypes';

// One dashboard per live project (Option B — see docs/ARCHITECTURE.md),
// each hardcoded to its own project_id and natively linked to that
// project's Genie agent via that dashboard's own
// uiSettings.genieSpace.overrideId. No AppKit "dashboard" resource type
// exists (only sql-warehouse, serving-endpoint, lakebase, etc.), so these
// are plain env vars, not permission-bearing `valueFrom` resources — see
// app.yaml.
const DASHBOARD_IDS: Record<string, string> = {
  'BM-L-001': process.env.DASHBOARD_ID_BM_L_001 ?? '',
  'BM-L-002': process.env.DASHBOARD_ID_BM_L_002 ?? '',
  'BM-L-003': process.env.DASHBOARD_ID_BM_L_003 ?? '',
  'BM-L-004': process.env.DASHBOARD_ID_BM_L_004 ?? '',
  'BM-L-005': process.env.DASHBOARD_ID_BM_L_005 ?? '',
};

export function registerConfigRoutes(appkit: AppKitHandle) {
  appkit.server.extend((app) => {
    app.get('/api/config', (req, res) => {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';
      const dashboardId = DASHBOARD_IDS[projectId] || null;
      const rawHost = process.env.DATABRICKS_HOST ?? '';
      // Same gotcha as lib/auth.ts: DATABRICKS_HOST has no scheme in the
      // deployed runtime, unlike local CLI output.
      const host = rawHost ? (/^https?:\/\//.test(rawHost) ? rawHost : `https://${rawHost}`) : '';
      const workspaceId = process.env.DATABRICKS_WORKSPACE_ID ?? '';
      const embedBaseUrl =
        host && dashboardId ? `${host.replace(/\/$/, '')}/embed/dashboardsv3/${dashboardId}?o=${workspaceId}` : null;
      res.json({ dashboardId, embedBaseUrl });
    });
  });
}
