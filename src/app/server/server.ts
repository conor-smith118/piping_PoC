import { createApp, lakebase, server } from '@databricks/appkit';
import { registerMeRoutes } from './routes/me';
import { registerViewAsRoutes } from './routes/viewAs';
import { registerProjectRoutes } from './routes/projects';
import { registerLineRoutes } from './routes/lines';
import { registerConfigRoutes } from './routes/config';
import type { AppKitHandle } from './lib/appkitTypes';

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
  plugins: [server(), lakebase()],
  async onPluginsReady(appkit) {
    await verifyLakebaseAccess(appkit);
    registerMeRoutes(appkit);
    registerViewAsRoutes(appkit);
    registerProjectRoutes(appkit);
    registerLineRoutes(appkit);
    registerConfigRoutes(appkit);
  },
}).catch(console.error);
