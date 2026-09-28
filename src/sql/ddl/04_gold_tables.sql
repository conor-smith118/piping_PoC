-- ============================================================================
-- Gold layer — physical Delta tables, fully rebuilt (CREATE OR REPLACE /
-- INSERT OVERWRITE) by src/notebooks/etl/refresh_silver_gold.py (line_status,
-- project_rollup) and src/notebooks/ml/*.py (ml_stage_transition_features,
-- ml_predictions). Declared here with explicit schemas so downstream
-- consumers (dashboard, Genie views, app queries) have a stable contract from
-- Phase 0 onward, even before those jobs exist yet.
-- ============================================================================

CREATE TABLE IF NOT EXISTS css_fevm.burns_piping_poc.gold_line_status (
  line_id                          STRING,
  project_id                       STRING,
  line_no                          STRING,
  service                          STRING,
  line_class_spec                   STRING,
  nominal_size_in                   DOUBLE,
  material                         STRING,
  estimated_centerline_length_ft     DOUBLE,
  current_stage                     INT,
  current_stage_name                STRING,
  is_complete                       BOOLEAN,
  latest_event_type                 STRING,
  latest_event_actor_email           STRING,
  latest_event_actor_role            STRING,
  latest_event_timestamp             TIMESTAMP,
  prelim_length_variance_pct         DOUBLE,
  final_length_variance_pct          DOUBLE,
  data_origin                       STRING
) USING DELTA
COMMENT 'One row per line: v_lines + latest v_stage_history event + true-up variance summary. Feeds the Kanban board.';

CREATE TABLE IF NOT EXISTS css_fevm.burns_piping_poc.gold_project_rollup (
  project_id                  STRING,
  project_name                STRING,
  client_name                 STRING,
  total_lines                 INT,
  lines_complete              INT,
  pct_lines_complete          DOUBLE,
  mode_stage                  INT,      -- most common stage among incomplete lines (headline timeline marker)
  mode_stage_name             STRING,
  min_stage                   INT,      -- laggard line's stage (secondary stat)
  min_stage_name              STRING,
  avg_days_in_current_stage    DOUBLE,
  data_origin                 STRING
) USING DELTA
COMMENT 'One row per project: stage rollup driving the 6-stage timeline and dashboard KPIs.';

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
