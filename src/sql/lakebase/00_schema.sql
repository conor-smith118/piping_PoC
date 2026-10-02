-- ============================================================================
-- Lakebase Postgres schema for the Burns & McDonnell Piping PoC (LIVE data only)
--
-- Runs once against the `production` branch / `databricks_postgres` database of
-- the `burns-piping-poc` Lakebase project:
--   databricks psql --project burns-piping-poc --profile <your-profile> -f 00_schema.sql
--
-- IMPORTANT — column types are restricted to what Lakehouse Sync (Lakebase -> UC
-- CDC, Beta) can replicate: bool, int2, int4, int8, text, varchar, bpchar, jsonb,
-- numeric, date, timestamp, timestamptz, real, float4, float8, and enums.
-- Notably NOT supported: uuid. All primary/foreign keys below are therefore `text`
-- (app-generated IDs), never native `uuid`.
--
-- Every CREATE TABLE is immediately followed by its own
-- `ALTER TABLE ... REPLICA IDENTITY FULL;` — a hard prerequisite for CDC — so no
-- table can exist here without being sync-ready.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
CREATE TABLE projects (
    project_id                 text PRIMARY KEY,
    project_name                text NOT NULL,
    client_name                 text NOT NULL,
    site_location                text,
    project_type                text,
    status                      text NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | CLOSED
    target_line_count           int4,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    closed_at                   timestamptz
);
ALTER TABLE projects REPLICA IDENTITY FULL;

-- ---------------------------------------------------------------------------
-- user_project_role  (per-project role assignment; PK enforces one role/user/project)
-- ---------------------------------------------------------------------------
CREATE TABLE user_project_role (
    user_email                  text NOT NULL,
    project_id                  text NOT NULL REFERENCES projects(project_id),
    role                        text NOT NULL,   -- Estimator | Lead Engineer | Design Lead | Admin
    assigned_by                 text,
    assigned_at                 timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_email, project_id)
);
ALTER TABLE user_project_role REPLICA IDENTITY FULL;

-- ---------------------------------------------------------------------------
-- lines  (the line-list master record; current snapshot per line)
-- ---------------------------------------------------------------------------
CREATE TABLE lines (
    line_id                      text PRIMARY KEY,
    project_id                   text NOT NULL REFERENCES projects(project_id),
    line_no                      text NOT NULL,          -- e.g. "L-001", unique within project
    service                      text,                   -- e.g. "Fuel Gas"
    origin_tag                   text,
    destination_tag              text,
    area_package_zone            text,
    line_class_spec               text,                  -- e.g. "Class 300 CS"
    nominal_size_in                numeric,               -- NPS, inches
    schedule_thickness             text,                  -- e.g. "SCH 40", "XS"
    material                     text,
    design_pressure_psig           numeric,
    design_temperature_f           numeric,
    operating_pressure_psig        numeric,
    operating_temperature_f        numeric,
    corrosion_allowance_in         numeric,
    insulation_type               text,
    insulation_thickness_in        numeric,
    heat_tracing_flag             bool NOT NULL DEFAULT false,
    heat_tracing_spec             text,
    end_connections               text,
    flange_rating                 text,
    pid_reference                 text,
    isometric_drawing_no            text,
    estimated_centerline_length_ft  numeric,
    special_notes                 text,
    current_stage                 int4 NOT NULL DEFAULT 1,   -- 1-6, denormalized
    is_complete                   bool NOT NULL DEFAULT false,
    created_by                    text,
    created_at                    timestamptz NOT NULL DEFAULT now(),
    updated_at                    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE lines REPLICA IDENTITY FULL;

-- ---------------------------------------------------------------------------
-- stage_events  (append-only audit/confirmation log of every stage transition)
-- ---------------------------------------------------------------------------
CREATE TABLE stage_events (
    event_id                     text PRIMARY KEY,
    line_id                      text NOT NULL REFERENCES lines(line_id),
    project_id                   text NOT NULL REFERENCES projects(project_id),
    stage_number                 int4 NOT NULL,   -- 1-6
    stage_name                   text NOT NULL,
    event_type                   text NOT NULL,   -- INITIAL_DATA_ENTRY | INITIAL_ENGINEER_CONFIRMATION |
                                                   -- PRELIM_TRUE_UP_COMPLETE | ENGINEER_PRELIM_TRUE_UP_CONFIRMATION |
                                                   -- FINAL_TRUE_UP_COMPLETE | ENGINEER_FINAL_CONFIRMATION
    actor_email                  text NOT NULL,
    actor_role                   text NOT NULL,
    event_timestamp               timestamptz NOT NULL DEFAULT now(),
    notes                        text
);
ALTER TABLE stage_events REPLICA IDENTITY FULL;

-- ---------------------------------------------------------------------------
-- true_up_records  (baseline-vs-actual reconciliation; PRELIMINARY + FINAL rounds)
-- ---------------------------------------------------------------------------
CREATE TABLE true_up_records (
    true_up_id                    text PRIMARY KEY,
    line_id                       text NOT NULL REFERENCES lines(line_id),
    project_id                    text NOT NULL REFERENCES projects(project_id),
    true_up_type                  text NOT NULL,   -- PRELIMINARY | FINAL
    estimated_centerline_length_ft numeric,
    actual_centerline_length_ft    numeric,
    length_variance_pct            numeric,
    fitting_detail                jsonb,   -- [{type,size,estimated_qty,actual_qty}, ...]
    valve_detail                  jsonb,   -- same shape
    support_detail                jsonb,   -- same shape
    weld_count_estimated           int4,
    weld_count_actual              int4,
    flange_count_estimated         int4,
    flange_count_actual            int4,
    mto_weight_estimated_lb        numeric,
    mto_weight_actual_lb           numeric,
    mto_cost_estimated_usd         numeric,
    mto_cost_actual_usd            numeric,
    isometric_drawing_ref          text,
    pid_ref                       text,
    performed_by                  text,
    performed_at                   timestamptz,
    confirmed_by                  text,
    confirmed_at                   timestamptz
);
ALTER TABLE true_up_records REPLICA IDENTITY FULL;

-- ---------------------------------------------------------------------------
-- change_log  (0..N reconciliation reason entries per true-up)
-- ---------------------------------------------------------------------------
CREATE TABLE change_log (
    change_id                    text PRIMARY KEY,
    true_up_id                   text NOT NULL REFERENCES true_up_records(true_up_id),
    line_id                      text NOT NULL REFERENCES lines(line_id),
    reason_category               text NOT NULL,   -- DESIGN_CHANGE | CONSTRUCTABILITY | ESTIMATING_ERROR | OTHER
    reason_text                  text,
    changed_by                   text,
    changed_at                   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE change_log REPLICA IDENTITY FULL;

-- ---------------------------------------------------------------------------
-- Verification: confirm all 6 tables have replica identity FULL before this
-- script is considered complete (also re-checked independently by
-- src/notebooks/setup/01_create_cdf_config.py before CDF is enabled in Phase 4).
-- ---------------------------------------------------------------------------
SELECT c.relname AS table_name,
       CASE c.relreplident WHEN 'f' THEN 'full' ELSE 'NOT FULL -- FIX ME' END AS replica_identity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname = 'public'
ORDER BY c.relname;
