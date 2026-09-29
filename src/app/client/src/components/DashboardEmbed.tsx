import { useEffect, useState } from 'react';
import { Alert, Skeleton } from '@databricks/appkit-ui/react';
import { ExternalLink } from 'lucide-react';
import { api } from '../lib/api';

/**
 * Embeds this project's own dedicated "Piping Project Progress" dashboard
 * (see src/dashboards/build_dashboard_config.py — one dashboard PER live
 * project, not a single shared dashboard with a filter).
 *
 * This replaced an earlier single-shared-dashboard-plus-filter-parameter
 * design (Phase 5) once it became clear a shared dashboard object can never
 * be natively, correctly linked to a specific project's Genie agent —
 * Lakeview's `uiSettings.genieSpace.overrideId` is one static space ID
 * baked into the dashboard *object*, so it can't track a filter's value.
 * With one dashboard per project, each one's built-in "Ask Genie" button is
 * simply, statically, correctly linked — no separate in-app chat surface
 * needed (an app-level Genie tab was tried and reverted for feeling like a
 * second, competing "Ask Genie" button). See docs/ARCHITECTURE.md.
 *
 * Two things confirmed from Databricks docs/testing, not guessed:
 *  - Embed URL shape: https://<host>/embed/dashboardsv3/<id>?o=<workspaceId>
 *    (the "basic" same-workspace embed — viewers use their own Databricks
 *    session; this is NOT the external-embed SDK flow, which is for
 *    anonymous/external viewers and needs a token-minting server + service
 *    principal we deliberately did not build for this PoC).
 *  - The dashboard must be published with embed_credentials=true (done —
 *    see the publish command in ARCHITECTURE.md) so viewers don't need
 *    direct warehouse/table permissions themselves.
 *
 * One thing NOT fully confirmed (Databricks' own docs don't give a
 * definitive answer, and this needs a real browser + real Databricks admin
 * console to nail down — see the README "Known follow-ups" section):
 *  - Whether this app's domain is already on the workspace's embedding
 *    allowlist. If the iframe below renders blank/blocked, a workspace
 *    admin needs to add it via the dashboard's "Share > Embed dashboard"
 *    dialog, which shows the exact domain to allow.
 *
 * The "Open full dashboard" link is a deliberate fallback so the feature
 * degrades gracefully (a new tab) rather than showing nothing if that
 * isn't resolved yet.
 *
 * The caller mounts this with `key={projectId}` (see ProjectView.tsx) so a
 * project switch fully remounts it — fresh `useState` initial values —
 * rather than needing an effect to manually reset state on prop change.
 */
export function DashboardEmbed({ projectId }: { projectId: string }) {
  const [embedBaseUrl, setEmbedBaseUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getConfig(projectId)
      .then((c) => setEmbedBaseUrl(c.embedBaseUrl))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [projectId]);

  if (error) {
    return <Alert variant="destructive">Could not load dashboard config: {error}</Alert>;
  }
  if (embedBaseUrl === null) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <div className="space-y-2">
      <div className="relative h-[600px] w-full rounded-md border overflow-hidden bg-muted/20">
        {!loaded && <Skeleton className="absolute inset-0" />}
        <iframe
          title="Piping Project Progress dashboard"
          src={embedBaseUrl}
          className="h-full w-full border-0"
          onLoad={() => setLoaded(true)}
        />
      </div>
      <a
        href={embedBaseUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        Open full dashboard in a new tab <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}
