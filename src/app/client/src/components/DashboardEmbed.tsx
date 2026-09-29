import { useEffect, useState } from 'react';
import { Alert, Skeleton } from '@databricks/appkit-ui/react';
import { ExternalLink } from 'lucide-react';
import { api } from '../lib/api';

/**
 * Embeds the single, project-parameterized "Piping Project Progress"
 * dashboard (see src/dashboards/project_progress.lvdash.json), fixing its
 * project_id filter to the current project at embed time.
 *
 * Two things here are confirmed from Databricks docs/testing, not guessed:
 *  - Embed URL shape: https://<host>/embed/dashboardsv3/<id>?o=<workspaceId>
 *    (the "basic" same-workspace embed — viewers use their own Databricks
 *    session; this is NOT the external-embed SDK flow, which is for
 *    anonymous/external viewers and needs a token-minting server + service
 *    principal we deliberately did not build for this PoC).
 *  - The dashboard must be published with embed_credentials=true (done —
 *    see the publish command in ARCHITECTURE.md) so viewers don't need
 *    direct warehouse/table permissions themselves.
 *
 * Two things are NOT fully confirmed (Databricks' own docs don't give a
 * definitive answer, and this needs a real browser + real Databricks admin
 * console to nail down — see the README "Known follow-ups" section):
 *  - The exact filter query-parameter encoding. Databricks documents the
 *    pattern as `f_<pageId>~<widgetId>=<value>`, but the id components seen
 *    in Databricks' own example look like opaque generated ids, not the
 *    human-readable "name" fields we set in the dashboard JSON (page
 *    "main", widget "filter_project"). We use those names verbatim below as
 *    the best-documented guess — confirm in a browser and adjust here if
 *    the filter doesn't visibly apply.
 *  - Whether this app's domain is already on the workspace's embedding
 *    allowlist. If the iframe below renders blank/blocked, a workspace
 *    admin needs to add it via the dashboard's "Share > Embed dashboard"
 *    dialog, which shows the exact domain to allow.
 *
 * The "Open full dashboard" link is a deliberate fallback so the feature
 * degrades gracefully (a new tab, unfiltered-until-clicked) rather than
 * showing nothing if either of the above isn't resolved yet.
 */
export function DashboardEmbed({ projectId }: { projectId: string }) {
  const [embedBaseUrl, setEmbedBaseUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getConfig()
      .then((c) => setEmbedBaseUrl(c.embedBaseUrl))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) {
    return <Alert variant="destructive">Could not load dashboard config: {error}</Alert>;
  }
  if (embedBaseUrl === null) {
    return <Skeleton className="h-96 w-full" />;
  }

  const filteredUrl = `${embedBaseUrl}&f_main~filter_project=${encodeURIComponent(projectId)}`;

  return (
    <div className="space-y-2">
      <div className="relative h-[600px] w-full rounded-md border overflow-hidden bg-muted/20">
        {!loaded && <Skeleton className="absolute inset-0" />}
        <iframe
          title="Piping Project Progress dashboard"
          src={filteredUrl}
          className="h-full w-full border-0"
          onLoad={() => setLoaded(true)}
        />
      </div>
      <a
        href={filteredUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        Open full dashboard in a new tab <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}
