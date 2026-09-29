import type { AppKitHandle } from '../lib/appkitTypes';
import { getRequestIdentity } from '../lib/auth';
import { eligibleRoles, getEffectiveRole, STAGE_NAMES, type Role } from '../lib/roles';

interface ProjectRow {
  project_id: string;
  project_name: string;
  client_name: string;
  site_location: string | null;
  project_type: string | null;
  status: string;
  target_line_count: number | null;
  created_at: string;
}

interface Rollup {
  totalLines: number;
  linesComplete: number;
  pctComplete: number;
  modeStage: number | null;
  modeStageName: string | null;
  minStage: number | null;
  minStageName: string | null;
}

async function rollupForProjects(
  appkit: AppKitHandle,
  projectIds: string[],
): Promise<Map<string, Rollup>> {
  const map = new Map<string, Rollup>();
  if (projectIds.length === 0) return map;

  const { rows: counts } = await appkit.lakebase.query<{
    project_id: string;
    total_lines: string;
    lines_complete: string;
  }>(
    `SELECT project_id, COUNT(*) AS total_lines, COUNT(*) FILTER (WHERE is_complete) AS lines_complete
     FROM lines WHERE project_id = ANY($1) GROUP BY project_id`,
    [projectIds],
  );
  for (const c of counts) {
    const total = Number(c.total_lines);
    const complete = Number(c.lines_complete);
    map.set(c.project_id, {
      totalLines: total,
      linesComplete: complete,
      pctComplete: total > 0 ? complete / total : 0,
      modeStage: total > 0 && complete === total ? 6 : null,
      modeStageName: total > 0 && complete === total ? STAGE_NAMES[6] : null,
      minStage: total > 0 && complete === total ? 6 : null,
      minStageName: total > 0 && complete === total ? STAGE_NAMES[6] : null,
    });
  }

  // Mode/min stage among INCOMPLETE lines only — the project's headline
  // timeline marker is "where the bulk of the remaining work is", not a
  // simple average across everything (see ARCHITECTURE.md rollup design).
  const { rows: stages } = await appkit.lakebase.query<{
    project_id: string;
    mode_stage: number;
    min_stage: number;
  }>(
    `SELECT project_id, MODE() WITHIN GROUP (ORDER BY current_stage) AS mode_stage, MIN(current_stage) AS min_stage
     FROM lines WHERE project_id = ANY($1) AND NOT is_complete GROUP BY project_id`,
    [projectIds],
  );
  for (const s of stages) {
    const entry = map.get(s.project_id);
    if (entry) {
      entry.modeStage = s.mode_stage;
      entry.modeStageName = STAGE_NAMES[s.mode_stage] ?? null;
      entry.minStage = s.min_stage;
      entry.minStageName = STAGE_NAMES[s.min_stage] ?? null;
    }
  }
  return map;
}

function projectDto(p: ProjectRow) {
  return {
    projectId: p.project_id,
    projectName: p.project_name,
    clientName: p.client_name,
    siteLocation: p.site_location,
    projectType: p.project_type,
    status: p.status,
    targetLineCount: p.target_line_count,
    createdAt: p.created_at,
  };
}

export function registerProjectRoutes(appkit: AppKitHandle) {
  appkit.server.extend((app) => {
    // Project picker — only projects the user has a CURRENTLY ELIGIBLE role
    // on; Admins see all. Both the project list and the `yourRole` badge
    // must agree with getEffectiveRole's own reconciliation rule (roles.ts)
    // — filtering by `upr.user_email = $1` alone, without also requiring
    // `upr.role = ANY(eligible)`, was a real bug: a user's stored
    // `user_project_role` row can be for a role they're not currently
    // eligible for (e.g. an Admin-eligible-by-default row from seed data,
    // now viewed via a Databricks "assume role" session narrowed to just
    // Estimator) — that row should NOT count as access, and the badge
    // should NOT display it, but an unfiltered join/lookup did both.
    app.get('/api/projects', async (req, res) => {
      try {
        const identity = await getRequestIdentity(req);
        const eligible = eligibleRoles(identity.groups);
        const isAdmin = eligible.includes('Admin');

        const { rows: projects } = await appkit.lakebase.query<ProjectRow>(
          isAdmin
            ? 'SELECT * FROM projects ORDER BY project_name'
            : `SELECT p.* FROM projects p
               JOIN user_project_role upr ON upr.project_id = p.project_id
               WHERE upr.user_email = $1 AND upr.role = ANY($2)
               ORDER BY p.project_name`,
          isAdmin ? [] : [identity.email, eligible],
        );

        const rollups = await rollupForProjects(appkit, projects.map((p) => p.project_id));
        const { rows: roleRows } = await appkit.lakebase.query<{ project_id: string; role: string }>(
          'SELECT project_id, role FROM user_project_role WHERE user_email = $1',
          [identity.email],
        );
        const roleByProject = new Map(
          roleRows.filter((r) => eligible.includes(r.role as Role)).map((r) => [r.project_id, r.role]),
        );

        res.json(
          projects.map((p) => ({
            ...projectDto(p),
            yourRole: roleByProject.get(p.project_id) ?? (isAdmin ? 'Admin' : null),
            ...rollups.get(p.project_id),
          })),
        );
      } catch (err) {
        console.error('GET /api/projects failed:', err);
        res.status(500).json({ error: 'Failed to load projects' });
      }
    });

    // Project detail — feeds the 6-stage timeline + role badge.
    app.get('/api/projects/:projectId', async (req, res) => {
      try {
        const { projectId } = req.params;
        const identity = await getRequestIdentity(req);
        const effective = await getEffectiveRole(appkit, req, identity, projectId);
        if (!effective.role) {
          res.status(403).json({ error: 'You do not have access to this project.' });
          return;
        }

        const { rows } = await appkit.lakebase.query<ProjectRow>(
          'SELECT * FROM projects WHERE project_id = $1',
          [projectId],
        );
        if (rows.length === 0) {
          res.status(404).json({ error: 'Project not found' });
          return;
        }

        const rollups = await rollupForProjects(appkit, [projectId]);
        res.json({
          ...projectDto(rows[0]),
          effectiveRole: effective.role,
          isOverride: effective.isOverride,
          eligibleRoles: effective.eligibleRoles,
          ...(rollups.get(projectId) ?? {
            totalLines: 0,
            linesComplete: 0,
            pctComplete: 0,
            modeStage: null,
            modeStageName: null,
            minStage: null,
            minStageName: null,
          }),
        });
      } catch (err) {
        console.error('GET /api/projects/:projectId failed:', err);
        res.status(500).json({ error: 'Failed to load project' });
      }
    });

    // Kanban board rows.
    app.get('/api/projects/:projectId/lines', async (req, res) => {
      try {
        const { projectId } = req.params;
        const identity = await getRequestIdentity(req);
        const effective = await getEffectiveRole(appkit, req, identity, projectId);
        if (!effective.role) {
          res.status(403).json({ error: 'You do not have access to this project.' });
          return;
        }

        const { rows } = await appkit.lakebase.query(
          `SELECT l.*, se.actor_email AS latest_actor_email, se.actor_role AS latest_actor_role,
                  se.event_timestamp AS latest_event_timestamp, se.event_type AS latest_event_type
           FROM lines l
           LEFT JOIN stage_events se ON se.line_id = l.line_id AND se.stage_number = l.current_stage
           WHERE l.project_id = $1
           ORDER BY l.line_no`,
          [projectId],
        );
        res.json(rows);
      } catch (err) {
        console.error('GET /api/projects/:projectId/lines failed:', err);
        res.status(500).json({ error: 'Failed to load lines' });
      }
    });
  });
}
