-- ============================================================================
-- HISTORICAL Delta tables — populated ONCE by
-- src/notebooks/synthetic/generate_historical_projects.py (20-30 closed
-- projects). Identical column shape to 01_live_tables.sql (minus
-- user_project_role, which has no historical counterpart), so ML training
-- features and the union views in 03_union_views.sql are trivial.
--
-- Never written to by refresh_silver_gold.py, simulate_new_data, or reset_poc —
-- these are static training fixtures, structurally isolated from the live/CDC
-- surface by being physically separate tables.
-- ============================================================================

CREATE TABLE IF NOT EXISTS css_fevm.burns_piping_poc.historical_projects (
  project_id            STRING  NOT NULL,
  project_name          STRING,
  client_name           STRING,
  site_location         STRING,
  project_type          STRING,
  status                STRING,   -- always CLOSED
  target_line_count     INT,
  created_at            TIMESTAMP,
  closed_at             TIMESTAMP
) USING DELTA
COMMENT 'Synthetic closed piping projects (20-30), used only to train the ML model.';

CREATE TABLE IF NOT EXISTS css_fevm.burns_piping_poc.historical_lines (
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
  current_stage                    INT,       -- always 6 (complete)
  is_complete                      BOOLEAN,   -- always true
  created_by                       STRING,
  created_at                       TIMESTAMP,
  updated_at                       TIMESTAMP
) USING DELTA
COMMENT 'Synthetic historical line-list records, final state (all lines complete).';

CREATE TABLE IF NOT EXISTS css_fevm.burns_piping_poc.historical_stage_history (
  event_id          STRING  NOT NULL,
  line_id           STRING,
  project_id        STRING,
  stage_number      INT,
  stage_name        STRING,
  event_type        STRING,
  actor_email       STRING,
  actor_role        STRING,
  event_timestamp   TIMESTAMP,
  notes             STRING
) USING DELTA
COMMENT 'Synthetic full stage-transition history per historical line — this is the ML training signal (stage_entry/exit timestamps).';

CREATE TABLE IF NOT EXISTS css_fevm.burns_piping_poc.historical_true_up_records (
  true_up_id                       STRING  NOT NULL,
  line_id                          STRING,
  project_id                       STRING,
  true_up_type                     STRING,
  estimated_centerline_length_ft    DOUBLE,
  actual_centerline_length_ft       DOUBLE,
  length_variance_pct               DOUBLE,
  fitting_detail                   STRING,
  valve_detail                     STRING,
  support_detail                   STRING,
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
COMMENT 'Synthetic historical true-up reconciliation records.';

CREATE TABLE IF NOT EXISTS css_fevm.burns_piping_poc.historical_change_log (
  change_id         STRING  NOT NULL,
  true_up_id        STRING,
  line_id           STRING,
  reason_category   STRING,
  reason_text       STRING,
  changed_by        STRING,
  changed_at        TIMESTAMP
) USING DELTA
COMMENT 'Synthetic historical reconciliation change/reason entries.';
