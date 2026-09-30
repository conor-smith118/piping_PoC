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

-- ml_stage_transition_features / gold_ml_predictions stay physical Delta
-- tables, built by src/notebooks/ml/*.py — unchanged by this file.
CREATE TABLE IF NOT EXISTS css_fevm.burns_piping_poc.ml_stage_transition_features (
  project_id                       STRING,
  line_id                          STRING,
  stage_number                     INT,
  stage_name                       STRING,
  stage_entry_ts                   TIMESTAMP,
  stage_exit_ts                    TIMESTAMP,   -- NULL if in-flight
  duration_hours                   DOUBLE,      -- label; NULL if in-flight
  is_complete_transition            BOOLEAN,
  nominal_size_in                   DOUBLE,
  material                         STRING,
  line_class_spec                   STRING,
  service                          STRING,
  insulation_type                  STRING,
  heat_tracing_flag                BOOLEAN,
  estimated_centerline_length_ft     DOUBLE,
  num_lines_in_project               INT,
  project_type                     STRING,
  data_origin                      STRING
) USING DELTA
COMMENT 'Training/scoring grain: one row per line x stage-transition. Historical rows are fully-labeled training data; live rows are in-flight and scored by batch inference.';

CREATE TABLE IF NOT EXISTS css_fevm.burns_piping_poc.gold_ml_predictions (
  project_id                     STRING,
  line_id                        STRING,
  current_stage                  INT,
  predicted_remaining_hours       DOUBLE,
  predicted_completion_ts         TIMESTAMP,
  model_version                  STRING,
  scored_at                      TIMESTAMP
) USING DELTA
COMMENT 'Batch-inference output from the stage-duration model, overwritten per run. Feeds Kanban ETA column, dashboard KPI, and per-project Genie prediction views.';
