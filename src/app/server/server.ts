import { createApp, genie, lakebase, server } from '@databricks/appkit';
import { registerMeRoutes } from './routes/me';
import { registerViewAsRoutes } from './routes/viewAs';
import { registerProjectRoutes } from './routes/projects';
import { registerLineRoutes } from './routes/lines';
import { registerConfigRoutes } from './routes/config';
import type { AppKitHandle } from './lib/appkitTypes';

// One Genie space alias per live project (Phase 7's 5 per-project agents —
// see resources/genie_spaces/*.genie-space.yml). Keying the map by the
// literal project_id (e.g. "BM-L-001") rather than an arbitrary short name
// means the client can pass `alias={project.projectId}` directly — no
// lookup table needed on either side, and no way for the two to drift out
// of sync. This is the answer to "can the embedded Genie agent track
// project selection": yes, via AppKit's multi-space `spaces` map, not via
// the dashboard's native (single, static) Genie link — see
// components/GenieAssistant.tsx and docs/ARCHITECTURE.md.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set — check app.yaml's env block and the matching genie_space app resource ` +
        'in resources/app.burns_piping_poc.yml.',
    );
  }
  return value;
}

const GENIE_SPACES: Record<string, string> = {
  'BM-L-001': requireEnv('DATABRICKS_GENIE_SPACE_BM_L_001'),
  'BM-L-002': requireEnv('DATABRICKS_GENIE_SPACE_BM_L_002'),
  'BM-L-003': requireEnv('DATABRICKS_GENIE_SPACE_BM_L_003'),
  'BM-L-004': requireEnv('DATABRICKS_GENIE_SPACE_BM_L_004'),
  'BM-L-005': requireEnv('DATABRICKS_GENIE_SPACE_BM_L_005'),
};

// Defense in depth: every route handler in routes/*.ts has its own
// try/catch, but Node's default behavior for ANY unhandled promise
// rejection anywhere in the process is to crash entirely — taking down
// every other in-flight request, not just the one that failed. We hit this
// for real during Phase 2-3 verification (a DATABRICKS_HOST parsing bug in
// lib/auth.ts crashed the whole server on the very first /api/me call).
// Attaching a listener changes Node's default from "crash" to "log and keep
// running" for anything that slips through a missing try/catch in the future.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandled rejection]', reason);
});

// Registration functions are typed against our own minimal `AppKitHandle`
// (see lib/appkitTypes.ts) rather than AppKit's internal type — structural
// typing lets the real `appkit` object (which has strictly more on it) pass
// through at each call site below with no cast needed. A double assertion
// here (`as unknown as`) is exactly what `appkit lint`'s
// no-double-type-assertion rule exists to catch.
async function verifyLakebaseAccess(appkit: AppKitHandle) {
  // The 6 Lakebase tables already exist (created in Phase 0 as the project
  // owner, seeded with historical/live data) — this app's service principal
  // does NOT create them. It needs an explicit one-time GRANT instead; see
  // src/sql/lakebase/01_grant_app_access.sql. Verify access rather than
  // silently failing later on the first write:
  try {
    await appkit.lakebase.query('SELECT 1 FROM projects LIMIT 1');
    console.log('[startup] Lakebase access to public.projects confirmed.');
  } catch (err) {
    console.error(
      '[startup] Cannot read public.projects — the service principal likely needs ' +
        'src/sql/lakebase/01_grant_app_access.sql run against this Lakebase project ' +
        '(see that file for instructions). Routes will register but will fail until granted.',
    );
    console.error(err);
  }
}

createApp({
  plugins: [server(), lakebase(), genie({ spaces: GENIE_SPACES })],
  async onPluginsReady(appkit) {
    await verifyLakebaseAccess(appkit);
    registerMeRoutes(appkit);
    registerViewAsRoutes(appkit);
    registerProjectRoutes(appkit);
    registerLineRoutes(appkit);
    registerConfigRoutes(appkit);
  },
}).catch(console.error);
