-- ============================================================================
-- LIVE Delta tables — populated by src/notebooks/etl/refresh_silver_gold.py
-- from the Lakebase CDC history tables (lb_*_history), never written directly
-- by synthetic/historical jobs. Column shape mirrors src/sql/lakebase/00_schema.sql
-- and the historical counterparts in 02_historical_tables.sql exactly, so
-- v_*.sql union views are trivial UNION ALLs.
--
-- Every table and column below carries a COMMENT — this is the authoritative
-- source of column-level semantics for the whole catalog: v_*/gold_*/
-- vw_genie_* views read from these tables (directly or via the CDC-table
-- equivalent) and are commented separately, closer to their own definitions,
-- but the wording always traces back to here. See ARCHITECTURE.md's "Data
-- architecture" section.
--
-- NOTE: these CREATE TABLE IF NOT EXISTS statements only apply inline column
-- comments to a *fresh* deployment. The 6 tables below already exist in this
-- live catalog, so the comments here were additionally back-filled onto the
-- existing tables via ALTER TABLE ... ALTER COLUMN ... COMMENT (run once,
-- not a repo file — a fresh deploy gets them for free from this file alone).
-- ============================================================================
--
-- NOTE: all object names below are bare (not catalog.schema-qualified) --
-- run `USE CATALOG <catalog>; USE SCHEMA <schema>;` first (or let the
-- apply_catalog_schema_ddl job do it for you; see SETUP.md). This is what
-- makes this file portable to any catalog/schema with zero find-and-replace.
-- ============================================================================

CREATE TABLE IF NOT EXISTS live_projects (
  project_id            STRING  NOT NULL COMMENT 'Unique project identifier (e.g. BM-L-001). Primary key.',
  project_name          STRING  COMMENT 'Human-readable project name.',
  client_name           STRING  COMMENT 'End client the project is being executed for.',
  site_location         STRING  COMMENT 'Physical site/plant location where the piping is installed.',
  project_type          STRING  COMMENT 'EPC project category (e.g. grassroots, revamp, maintenance).',
  status                STRING  COMMENT 'ACTIVE (live, in-flight) or CLOSED (complete).',
  target_line_count     INT     COMMENT 'Planned total number of piping lines in the project''s scope.',
  created_at            TIMESTAMP COMMENT 'Timestamp the project was opened.',
  closed_at             TIMESTAMP COMMENT 'Timestamp the project was closed out; NULL while ACTIVE.'
) USING DELTA
COMMENT 'Live piping projects, CDC''d from Lakebase (5 to start).';

CREATE TABLE IF NOT EXISTS live_lines (
  line_id                         STRING  NOT NULL COMMENT 'Unique piping line identifier. Primary key.',
  project_id                      STRING  COMMENT 'Project this line belongs to. Foreign key to live_projects.project_id.',
  line_no                         STRING  COMMENT 'Line-list number as shown on the P&ID/isometric (e.g. L-001).',
  service                         STRING  COMMENT 'Process service the line carries (e.g. Cooling Water, Steam, Crude Oil).',
  origin_tag                      STRING  COMMENT 'Equipment/line tag the line originates from.',
  destination_tag                 STRING  COMMENT 'Equipment/line tag the line terminates at.',
  area_package_zone               STRING  COMMENT 'Plant area, unit, or package the line is routed through.',
  line_class_spec                  STRING  COMMENT 'Piping line class / specification governing materials and ratings.',
  nominal_size_in                  DOUBLE  COMMENT 'Nominal pipe size, in inches (NPS).',
  schedule_thickness                STRING  COMMENT 'Pipe wall schedule or thickness designation (e.g. SCH 40, XS).',
  material                        STRING  COMMENT 'Pipe material of construction (e.g. CS, SS316, Hastelloy).',
  design_pressure_psig              DOUBLE  COMMENT 'Design pressure, in psig.',
  design_temperature_f              DOUBLE  COMMENT 'Design temperature, in degrees Fahrenheit.',
  operating_pressure_psig           DOUBLE  COMMENT 'Normal operating pressure, in psig.',
  operating_temperature_f           DOUBLE  COMMENT 'Normal operating temperature, in degrees Fahrenheit.',
  corrosion_allowance_in            DOUBLE  COMMENT 'Corrosion allowance built into the wall thickness, in inches.',
  insulation_type                  STRING  COMMENT 'Insulation type (e.g. none, hot, cold, personnel protection).',
  insulation_thickness_in           DOUBLE  COMMENT 'Insulation thickness, in inches.',
  heat_tracing_flag                BOOLEAN COMMENT 'Whether the line requires heat tracing.',
  heat_tracing_spec                STRING  COMMENT 'Heat tracing specification/type, populated when heat_tracing_flag is true.',
  end_connections                  STRING  COMMENT 'End connection type (e.g. flanged, welded, threaded).',
  flange_rating                    STRING  COMMENT 'Flange pressure class/rating (e.g. 150#, 300#).',
  pid_reference                    STRING  COMMENT 'P&ID drawing number this line appears on.',
  isometric_drawing_no               STRING  COMMENT 'Isometric drawing number for this line.',
  estimated_centerline_length_ft     DOUBLE  COMMENT 'Estimator''s initial centerline length estimate, in feet, entered at Initial Data Entry — the baseline the true-up stages compare the S3D-routed actual length against.',
  special_notes                    STRING  COMMENT 'Free-text notes entered by the Estimator.',
  current_stage                    INT     COMMENT 'Current workflow stage, 1-6, denormalized from the latest live_stage_history event for fast Kanban reads.',
  is_complete                      BOOLEAN COMMENT 'True once the line has passed stage 6 (Engineer Final Confirmation).',
  created_by                       STRING  COMMENT 'Email of the Estimator who created this line.',
  created_at                       TIMESTAMP COMMENT 'Timestamp the line was first entered.',
  updated_at                       TIMESTAMP COMMENT 'Timestamp of the line''s most recent write.'
) USING DELTA
COMMENT 'Live line-list master record, current snapshot per line, CDC''d from Lakebase.';

CREATE TABLE IF NOT EXISTS live_stage_history (
  event_id          STRING  NOT NULL COMMENT 'Unique stage-event identifier. Primary key.',
  line_id           STRING  COMMENT 'Line this event belongs to. Foreign key to live_lines.line_id.',
  project_id        STRING  COMMENT 'Project this event belongs to (denormalized for convenient filtering).',
  stage_number      INT     COMMENT 'Workflow stage number, 1-6, that this event represents.',
  stage_name        STRING  COMMENT 'Human-readable name of the stage (e.g. Preliminary True-Up Complete).',
  event_type        STRING  COMMENT 'Canonical action code for this event: INITIAL_DATA_ENTRY | INITIAL_ENGINEER_CONFIRMATION | PRELIM_TRUE_UP_COMPLETE | ENGINEER_PRELIM_TRUE_UP_CONFIRMATION | FINAL_TRUE_UP_COMPLETE | ENGINEER_FINAL_CONFIRMATION.',
  actor_email       STRING  COMMENT 'Email of the user who performed this action.',
  actor_role        STRING  COMMENT 'Role the actor held when performing this action: Estimator, Lead Engineer, or Design Lead.',
  event_timestamp   TIMESTAMP COMMENT 'When this stage action was performed.',
  notes             STRING  COMMENT 'Free-text notes entered with this action, if any.'
) USING DELTA
COMMENT 'Append-only audit/confirmation log of every stage transition, CDC''d from Lakebase.';

CREATE TABLE IF NOT EXISTS live_true_up_records (
  true_up_id                       STRING  NOT NULL COMMENT 'Unique true-up record identifier. Primary key.',
  line_id                          STRING  COMMENT 'Line this true-up applies to. Foreign key to live_lines.line_id.',
  project_id                       STRING  COMMENT 'Project this true-up belongs to (denormalized for convenient filtering).',
  true_up_type                     STRING  COMMENT 'PRELIMINARY (first routing pass) or FINAL (as-built).',
  estimated_centerline_length_ft    DOUBLE  COMMENT 'Centerline length estimated at Initial Data Entry — the baseline for this true-up''s variance calculation.',
  actual_centerline_length_ft       DOUBLE  COMMENT 'Actual routed centerline length, sourced from S3D 3D design/routing. No live S3D data connection today — entered manually by the Design Lead (see ARCHITECTURE.md).',
  length_variance_pct               DOUBLE  COMMENT 'Percent variance of actual vs. estimated centerline length.',
  fitting_detail                   STRING  COMMENT 'JSON array of fitting takeoff detail: [{type, size, estimated_qty, actual_qty}, ...].',
  valve_detail                     STRING  COMMENT 'JSON array of valve takeoff detail, same shape as fitting_detail.',
  support_detail                   STRING  COMMENT 'JSON array of pipe support takeoff detail, same shape as fitting_detail.',
  weld_count_estimated              INT     COMMENT 'Estimated weld count.',
  weld_count_actual                 INT     COMMENT 'Actual weld count from the routed design.',
  flange_count_estimated             INT     COMMENT 'Estimated flange count.',
  flange_count_actual                INT     COMMENT 'Actual flange count from the routed design.',
  mto_weight_estimated_lb            DOUBLE  COMMENT 'Estimated material take-off weight, in pounds.',
  mto_weight_actual_lb               DOUBLE  COMMENT 'Actual material take-off weight, in pounds.',
  mto_cost_estimated_usd             DECIMAL(12,2) COMMENT 'Estimated material take-off cost, in USD.',
  mto_cost_actual_usd                DECIMAL(12,2) COMMENT 'Actual material take-off cost, in USD.',
  isometric_drawing_ref              STRING  COMMENT 'Isometric drawing number this true-up reconciles against.',
  pid_ref                          STRING  COMMENT 'P&ID drawing number this true-up reconciles against.',
  performed_by                     STRING  COMMENT 'Email of the Design Lead who performed this true-up.',
  performed_at                      TIMESTAMP COMMENT 'Timestamp the true-up was performed.',
  confirmed_by                     STRING  COMMENT 'Email of the Lead Engineer who confirmed this true-up.',
  confirmed_at                      TIMESTAMP COMMENT 'Timestamp the true-up was confirmed; NULL until confirmed.'
) USING DELTA
COMMENT 'Baseline-vs-actual true-up reconciliation, CDC''d from Lakebase.';

CREATE TABLE IF NOT EXISTS live_change_log (
  change_id         STRING  NOT NULL COMMENT 'Unique change-log entry identifier. Primary key.',
  true_up_id        STRING  COMMENT 'True-up record this change explains. Foreign key to live_true_up_records.true_up_id.',
  line_id           STRING  COMMENT 'Line this change applies to (denormalized for convenient filtering).',
  reason_category   STRING  COMMENT 'Reason category: DESIGN_CHANGE | CONSTRUCTABILITY | ESTIMATING_ERROR | OTHER.',
  reason_text       STRING  COMMENT 'Free-text explanation of the variance.',
  changed_by        STRING  COMMENT 'Email of the user who logged this change entry.',
  changed_at        TIMESTAMP COMMENT 'Timestamp this change entry was logged.'
) USING DELTA
COMMENT 'Reconciliation change/reason entries per true-up, CDC''d from Lakebase.';

CREATE TABLE IF NOT EXISTS live_user_project_role (
  user_email    STRING  NOT NULL COMMENT 'Email of the user granted this role.',
  project_id    STRING  NOT NULL COMMENT 'Project the role grant applies to. Foreign key to live_projects.project_id.',
  role          STRING  COMMENT 'Granted role: Estimator | Lead Engineer | Design Lead | Admin.',
  assigned_by   STRING  COMMENT 'Email of the Admin who made this assignment.',
  assigned_at   TIMESTAMP COMMENT 'Timestamp the assignment was made.'
) USING DELTA
COMMENT 'Per-project role assignments, CDC''d from Lakebase. No historical counterpart.';
