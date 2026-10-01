-- ============================================================================
-- Gold layer.
--
-- gold_line_status / gold_project_rollup are VIEWS (not tables) — changed
-- from an earlier design where refresh_silver_gold.py rebuilt them as
-- physical Delta tables via CREATE OR REPLACE TABLE AS SELECT. That meant
-- the dashboard/Genie only ever saw whatever snapshot the last manual (or
-- simulate_new_data/reset_poc-chained) run of that job happened to leave
-- behind — direct app usage writes straight to Lakebase and was never
-- chained to anything, so the dashboard could sit stale indefinitely after
-- a real workflow action. Since v_lines/v_stage_history/v_true_up_records/
-- v_projects (03_union_views.sql) already compute their LIVE half directly
-- from the lb_*_history CDC landing tables — confirmed live to reflect a
-- write within a couple of seconds, no batch job involved — making
-- gold_line_status/gold_project_rollup views over those same v_* views
-- means they inherit that same freshness for free, with the exact same SQL
-- that used to run once per batch job execution now just running once per
-- query instead. See ARCHITECTURE.md, "Dashboard freshness: query CDC
-- directly instead of waiting on a batch job".
--
-- ml_stage_transition_features / gold_ml_predictions stay physical tables,
-- built by src/notebooks/ml/*.py — batch ML scoring, not something you'd
-- want recomputed (an XGBoost model load + inference pass) on every
-- dashboard page load.
--
-- Column comments on the two views are applied via COMMENT ON COLUMN below
-- (same reason as 03_union_views.sql: Genie/UC search read a column's
-- comment on the exact object queried, and gold_line_status/
-- gold_project_rollup are what the dashboard and Genie agents query most
-- directly). The two ML tables get inline column comments in their
-- CREATE TABLE — same fresh-vs-existing caveat as 01/02_*.sql applies: the
-- comments here were also back-filled onto the already-existing tables via
-- ALTER TABLE ... ALTER COLUMN ... COMMENT.
-- ============================================================================

CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.gold_line_status
COMMENT 'One row per line: v_lines + latest v_stage_history event + true-up variance summary. Always live (see file header) — feeds the Kanban board and dashboard.'
AS
WITH latest_event AS (
  SELECT *
  FROM (
    SELECT sh.*, ROW_NUMBER() OVER (PARTITION BY sh.line_id ORDER BY sh.stage_number DESC) AS rn
    FROM css_fevm.burns_piping_poc.v_stage_history sh
  )
  WHERE rn = 1
),
prelim_tu AS (
  SELECT line_id, length_variance_pct AS prelim_length_variance_pct
  FROM css_fevm.burns_piping_poc.v_true_up_records WHERE true_up_type = 'PRELIMINARY'
),
final_tu AS (
  SELECT line_id, length_variance_pct AS final_length_variance_pct
  FROM css_fevm.burns_piping_poc.v_true_up_records WHERE true_up_type = 'FINAL'
)
SELECT
  l.line_id, l.project_id, l.line_no, l.service, l.line_class_spec, l.nominal_size_in,
  l.material, l.estimated_centerline_length_ft, l.current_stage,
  CASE l.current_stage
    WHEN 1 THEN 'Initial Data Entry' WHEN 2 THEN 'Initial Engineer Confirmation'
    WHEN 3 THEN 'Preliminary True-Up Complete' WHEN 4 THEN 'Engineer Prelim True-Up Confirmation'
    WHEN 5 THEN 'Final True-Up Complete' WHEN 6 THEN 'Engineer Final Confirmation'
  END AS current_stage_name,
  l.is_complete,
  e.event_type AS latest_event_type, e.actor_email AS latest_event_actor_email,
  e.actor_role AS latest_event_actor_role, e.event_timestamp AS latest_event_timestamp,
  p.prelim_length_variance_pct, f.final_length_variance_pct,
  l.data_origin
FROM css_fevm.burns_piping_poc.v_lines l
LEFT JOIN latest_event e ON e.line_id = l.line_id
LEFT JOIN prelim_tu p ON p.line_id = l.line_id
LEFT JOIN final_tu f ON f.line_id = l.line_id;

COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_line_status.line_id IS 'Unique piping line identifier. Primary key.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_line_status.project_id IS 'Project this line belongs to. Foreign key to gold_project_rollup.project_id.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_line_status.line_no IS 'Line-list number as shown on the P&ID/isometric (e.g. L-001).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_line_status.service IS 'Process service the line carries (e.g. Cooling Water, Steam, Crude Oil).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_line_status.line_class_spec IS 'Piping line class / specification governing materials and ratings.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_line_status.nominal_size_in IS 'Nominal pipe size, in inches (NPS).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_line_status.material IS 'Pipe material of construction (e.g. CS, SS316, Hastelloy).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_line_status.estimated_centerline_length_ft IS 'Estimator''s initial centerline length estimate, in feet — the baseline the true-up stages compare the S3D-routed actual length against.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_line_status.current_stage IS 'Current workflow stage, 1-6.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_line_status.current_stage_name IS 'Human-readable name of current_stage (e.g. Preliminary True-Up Complete).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_line_status.is_complete IS 'True once the line has passed stage 6 (Engineer Final Confirmation).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_line_status.latest_event_type IS 'event_type of this line''s most recent stage-history entry.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_line_status.latest_event_actor_email IS 'Email of the actor who performed the most recent stage action.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_line_status.latest_event_actor_role IS 'Role of the actor who performed the most recent stage action.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_line_status.latest_event_timestamp IS 'Timestamp of the most recent stage action — drives "days in current stage" calculations (see gold_project_rollup.avg_days_in_current_stage).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_line_status.prelim_length_variance_pct IS 'length_variance_pct from this line''s PRELIMINARY true-up, if performed.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_line_status.final_length_variance_pct IS 'length_variance_pct from this line''s FINAL true-up, if performed.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_line_status.data_origin IS 'LIVE (computed from Lakebase CDC at query time) or SYNTHETIC_HISTORICAL (static ML training data).';

-- No mode_stage_name/min_stage_name columns — an earlier version of this
-- file declared them as an aspirational schema stub, but the job that
-- actually built this table (now: the view below) never populated them;
-- the app/dashboard render stage names via their own STAGE_NAMES-equivalent
-- lookups keyed on the numeric mode_stage/min_stage instead.
CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.gold_project_rollup
COMMENT 'One row per project: stage rollup driving the 6-stage timeline and dashboard KPIs. Always live (see file header).'
AS
WITH counts AS (
  SELECT project_id, COUNT(*) AS total_lines, COUNT(*) FILTER (WHERE is_complete) AS lines_complete
  FROM css_fevm.burns_piping_poc.gold_line_status
  GROUP BY project_id
),
stage_stats AS (
  -- Spark SQL's mode() is a plain aggregate (no Postgres-style
  -- WITHIN GROUP (ORDER BY ...) needed) — confirmed directly against this
  -- warehouse.
  SELECT project_id,
         MODE(current_stage) AS mode_stage,
         MIN(current_stage) AS min_stage,
         AVG(DATEDIFF(CURRENT_TIMESTAMP(), latest_event_timestamp)) AS avg_days_in_current_stage
  FROM css_fevm.burns_piping_poc.gold_line_status
  WHERE NOT is_complete
  GROUP BY project_id
)
SELECT
  p.project_id, p.project_name, p.client_name,
  c.total_lines, c.lines_complete,
  CAST(c.lines_complete AS DOUBLE) / c.total_lines AS pct_lines_complete,
  COALESCE(s.mode_stage, 6) AS mode_stage,
  COALESCE(s.min_stage, 6) AS min_stage,
  COALESCE(s.avg_days_in_current_stage, 0.0) AS avg_days_in_current_stage,
  p.data_origin
FROM css_fevm.burns_piping_poc.v_projects p
JOIN counts c ON c.project_id = p.project_id
LEFT JOIN stage_stats s ON s.project_id = p.project_id;

COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_project_rollup.project_id IS 'Unique project identifier (e.g. BM-L-001). Primary key.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_project_rollup.project_name IS 'Human-readable project name.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_project_rollup.client_name IS 'End client the project is being executed for.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_project_rollup.total_lines IS 'Total number of lines in the project.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_project_rollup.lines_complete IS 'Number of lines that have reached stage 6 (complete).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_project_rollup.pct_lines_complete IS 'lines_complete divided by total_lines.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_project_rollup.mode_stage IS 'Most common current_stage among this project''s incomplete lines — the headline marker on the 6-stage timeline.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_project_rollup.min_stage IS 'Earliest current_stage among this project''s incomplete lines — the laggard.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_project_rollup.avg_days_in_current_stage IS 'Average days incomplete lines have sat in their current stage, measured from gold_line_status.latest_event_timestamp.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.gold_project_rollup.data_origin IS 'LIVE (computed from Lakebase CDC at query time) or SYNTHETIC_HISTORICAL (static ML training data).';

-- ml_stage_transition_features / gold_ml_predictions stay physical Delta
-- tables, built by src/notebooks/ml/*.py — unchanged by this file.
CREATE TABLE IF NOT EXISTS css_fevm.burns_piping_poc.ml_stage_transition_features (
  project_id                       STRING  COMMENT 'Project the line in this row belongs to.',
  line_id                          STRING  COMMENT 'Line this stage-transition row describes.',
  stage_number                     INT     COMMENT 'Workflow stage number, 1-6, this row is a transition for.',
  stage_name                       STRING  COMMENT 'Human-readable name of stage_number.',
  stage_entry_ts                   TIMESTAMP COMMENT 'Timestamp the line entered this stage.',
  stage_exit_ts                    TIMESTAMP COMMENT 'Timestamp the line exited this stage (advanced to the next); NULL if still in-flight.',
  duration_hours                   DOUBLE  COMMENT 'Hours spent in this stage — the training label. NULL if in-flight (stage_exit_ts is NULL).',
  is_complete_transition            BOOLEAN COMMENT 'True if this stage-transition has a known exit time, i.e. is usable as a labeled training row.',
  nominal_size_in                   DOUBLE  COMMENT 'Line attribute carried as a model feature: nominal pipe size, in inches.',
  material                         STRING  COMMENT 'Line attribute carried as a model feature: pipe material of construction.',
  line_class_spec                   STRING  COMMENT 'Line attribute carried as a model feature: piping line class / specification.',
  service                          STRING  COMMENT 'Line attribute carried as a model feature: process service the line carries.',
  insulation_type                  STRING  COMMENT 'Line attribute carried as a model feature: insulation type.',
  heat_tracing_flag                BOOLEAN COMMENT 'Line attribute carried as a model feature: whether the line requires heat tracing.',
  estimated_centerline_length_ft     DOUBLE  COMMENT 'Line attribute carried as a model feature: Estimator''s initial centerline length estimate, in feet.',
  num_lines_in_project               INT     COMMENT 'Project-scale model feature: the project''s target_line_count (planned total line count).',
  project_type                     STRING  COMMENT 'Project attribute carried as a model feature: EPC project category.',
  data_origin                      STRING  COMMENT 'LIVE (in-flight, scored by batch inference) or SYNTHETIC_HISTORICAL (fully-labeled training data).'
) USING DELTA
COMMENT 'Training/scoring grain: one row per line x stage-transition. Historical rows are fully-labeled training data; live rows are in-flight and scored by batch inference.';

CREATE TABLE IF NOT EXISTS css_fevm.burns_piping_poc.gold_ml_predictions (
  project_id                     STRING  COMMENT 'Project the predicted line belongs to.',
  line_id                        STRING  COMMENT 'Line this prediction is for.',
  current_stage                  INT     COMMENT 'The line''s current_stage at the time this prediction was scored.',
  predicted_remaining_hours       DOUBLE  COMMENT 'Model-predicted hours remaining until the line reaches stage 6, summed across its remaining stage transitions.',
  predicted_completion_ts         TIMESTAMP COMMENT 'Model-predicted completion timestamp: scored_at + predicted_remaining_hours.',
  model_version                  STRING  COMMENT 'UC Model Registry version number resolved from stage_duration_model''s @prod alias at the time this row was scored.',
  scored_at                      TIMESTAMP COMMENT 'Timestamp this prediction was produced by ml_batch_inference.'
) USING DELTA
COMMENT 'Batch-inference output from the stage-duration model, overwritten per run. Feeds Kanban ETA column, dashboard KPI, and per-project Genie prediction views.';
