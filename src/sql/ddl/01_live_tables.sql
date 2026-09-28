-- ============================================================================
-- LIVE Delta tables — populated by src/notebooks/etl/refresh_silver_gold.py
-- from the Lakebase CDC history tables (lb_*_history), never written directly
-- by synthetic/historical jobs. Column shape mirrors src/sql/lakebase/00_schema.sql
-- and the historical counterparts in 02_historical_tables.sql exactly, so
-- v_*.sql union views are trivial UNION ALLs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS css_fevm.burns_piping_poc.live_projects (
  project_id            STRING  NOT NULL,
  project_name          STRING,
  client_name           STRING,
  site_location         STRING,
  project_type          STRING,
  status                STRING,   -- ACTIVE | CLOSED
  target_line_count     INT,
  created_at            TIMESTAMP,
  closed_at             TIMESTAMP
) USING DELTA
COMMENT 'Live piping projects, CDC''d from Lakebase (5 to start).';

CREATE TABLE IF NOT EXISTS css_fevm.burns_piping_poc.live_lines (
  line_id                         STRING  NOT NULL,
  project_id                      STRING,
  line_no                         STRING,
  service                         STRING,
  origin_tag                      STRING,
  destination_tag                 STRING,
  area_package_zone               STRING,
  line_class_spec                  STRING,
  nominal_size_in                  DOUBLE,
  schedule_thickness                STRING,
  material                        STRING,
  design_pressure_psig              DOUBLE,
  design_temperature_f              DOUBLE,
  operating_pressure_psig           DOUBLE,
  operating_temperature_f           DOUBLE,
  corrosion_allowance_in            DOUBLE,
  insulation_type                  STRING,
  insulation_thickness_in           DOUBLE,
  heat_tracing_flag                BOOLEAN,
  heat_tracing_spec                STRING,
  end_connections                  STRING,
  flange_rating                    STRING,
  pid_reference                    STRING,
  isometric_drawing_no               STRING,
  estimated_centerline_length_ft     DOUBLE,
  special_notes                    STRING,
  current_stage                    INT,       -- 1-6, denormalized
  is_complete                      BOOLEAN,
  created_by                       STRING,
  created_at                       TIMESTAMP,
  updated_at                       TIMESTAMP
) USING DELTA
COMMENT 'Live line-list master record, current snapshot per line, CDC''d from Lakebase.';

CREATE TABLE IF NOT EXISTS css_fevm.burns_piping_poc.live_stage_history (
  event_id          STRING  NOT NULL,
  line_id           STRING,
  project_id        STRING,
  stage_number      INT,      -- 1-6
  stage_name        STRING,
  event_type        STRING,   -- INITIAL_DATA_ENTRY | INITIAL_ENGINEER_CONFIRMATION |
                               -- PRELIM_TRUE_UP_COMPLETE | ENGINEER_PRELIM_TRUE_UP_CONFIRMATION |
                               -- FINAL_TRUE_UP_COMPLETE | ENGINEER_FINAL_CONFIRMATION
  actor_email       STRING,
  actor_role        STRING,
  event_timestamp   TIMESTAMP,
  notes             STRING
) USING DELTA
COMMENT 'Append-only audit/confirmation log of every stage transition, CDC''d from Lakebase.';

CREATE TABLE IF NOT EXISTS css_fevm.burns_piping_poc.live_true_up_records (
  true_up_id                       STRING  NOT NULL,
  line_id                          STRING,
  project_id                       STRING,
  true_up_type                     STRING,   -- PRELIMINARY | FINAL
  estimated_centerline_length_ft    DOUBLE,
  actual_centerline_length_ft       DOUBLE,
  length_variance_pct               DOUBLE,
  fitting_detail                   STRING,   -- JSON: [{type,size,estimated_qty,actual_qty}, ...]
  valve_detail                     STRING,   -- JSON, same shape
  support_detail                   STRING,   -- JSON, same shape
  weld_count_estimated              INT,
  weld_count_actual                 INT,
  flange_count_estimated             INT,
  flange_count_actual                INT,
  mto_weight_estimated_lb            DOUBLE,
  mto_weight_actual_lb               DOUBLE,
  mto_cost_estimated_usd             DECIMAL(12,2),
  mto_cost_actual_usd                DECIMAL(12,2),
  isometric_drawing_ref              STRING,
  pid_ref                          STRING,
  performed_by                     STRING,
  performed_at                      TIMESTAMP,
  confirmed_by                     STRING,
  confirmed_at                      TIMESTAMP
) USING DELTA
COMMENT 'Baseline-vs-actual true-up reconciliation, CDC''d from Lakebase.';

CREATE TABLE IF NOT EXISTS css_fevm.burns_piping_poc.live_change_log (
  change_id         STRING  NOT NULL,
  true_up_id        STRING,
  line_id           STRING,
  reason_category   STRING,   -- DESIGN_CHANGE | CONSTRUCTABILITY | ESTIMATING_ERROR | OTHER
  reason_text       STRING,
  changed_by        STRING,
  changed_at        TIMESTAMP
) USING DELTA
COMMENT 'Reconciliation change/reason entries per true-up, CDC''d from Lakebase.';

CREATE TABLE IF NOT EXISTS css_fevm.burns_piping_poc.live_user_project_role (
  user_email    STRING  NOT NULL,
  project_id    STRING  NOT NULL,
  role          STRING,   -- Estimator | Lead Engineer | Design Lead | Admin
  assigned_by   STRING,
  assigned_at   TIMESTAMP
) USING DELTA
COMMENT 'Per-project role assignments, CDC''d from Lakebase. No historical counterpart.';
