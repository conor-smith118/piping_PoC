import { GenieChat } from '@databricks/appkit-ui/react';

/**
 * Per-project Genie chat panel.
 *
 * Each of the 5 live projects has its own curated Genie agent (Phase 7 —
 * resources/genie_spaces/*.genie-space.yml + src/genie/*.geniespace.json),
 * scoped to that project's own line list, stage history, true-up detail,
 * and ML predictions via static row-filtered views.
 *
 * This panel is deliberately NOT the dashboard's native
 * `uiSettings.genieSpace` link. That mechanism bakes a single, static space
 * ID into the dashboard *object* itself — incompatible with this app's one
 * shared dashboard parameterized per-embed by a project filter (see
 * DashboardEmbed.tsx). Instead, the alignment happens here: the server
 * registers all 5 spaces with AppKit's genie() plugin under a `spaces` map
 * keyed by literal project_id (see server/server.ts's GENIE_SPACES
 * constant), and this component just passes the current project's
 * `projectId` straight through as the `alias` prop. Both sides key off the
 * same string, so there's no separate lookup table that could drift out of
 * sync, and the chat automatically re-points itself to the right project's
 * agent every time the user navigates to a different project.
 *
 * `key={projectId}` forces GenieChat to fully remount on project switch —
 * without it, its internal conversation state (and the conversationId it
 * persists to the URL/localStorage) could otherwise carry over from one
 * project's agent to another's.
 */
export function GenieAssistant({ projectId }: { projectId: string }) {
  return (
    <div className="h-[600px] rounded-md border overflow-hidden">
      <GenieChat
        key={projectId}
        alias={projectId}
        placeholder="Ask about this project's lines, stage history, true-ups, or predicted completion..."
      />
    </div>
  );
}
