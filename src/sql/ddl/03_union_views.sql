-- ============================================================================
-- Union views over LIVE + HISTORICAL, adding a literal data_origin column.
-- These are what the gold layer, ML feature pipeline, Genie views, and
-- (indirectly, via gold_*) the dashboard all read.
--
-- The LIVE half is computed directly from the lb_*_history CDC landing
-- tables (populated by Lakehouse Sync from Lakebase) — NOT from the
-- batch-refreshed live_* tables. Confirmed live (see ARCHITECTURE.md,
-- "Dashboard freshness: query CDC directly instead of waiting on a batch
-- job"): Lakehouse Sync lands a change in lb_*_history within the same
-- second it's written to Lakebase, so a view computing "latest row per
-- primary key by _pg_lsn" directly over that CDC table is correct and
-- fresh to within a couple of seconds — no dependency on refresh_silver_gold
-- (or any other batch job) ever running. Same "latest per PK, deletes
-- excluded" logic as that job's own live_*-table MERGE (which still exists,
-- independently, for ml_batch_inference's direct live_lines/live_projects
-- reads — see that job's updated description).
--
-- HISTORICAL is unaffected — those tables are static synthetic data, never
-- touched by CDC, written once by generate_historical_projects.py.
--
-- Column comments below are applied via COMMENT ON COLUMN rather than inline
-- in the SELECT (Databricks SQL views don't support inline per-column
-- COMMENT on a SELECT *-based CREATE VIEW without naming every output
-- column) and are re-stated here (not just inherited from the live_*/
-- historical_* base tables) because Genie and UC search read a column's own
-- comment on the exact object being queried, not the lineage it came from —
-- and these views (not the base tables) are what gold_*/vw_genie_* and
-- Genie agents actually query.
-- ============================================================================

CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.v_projects
COMMENT 'All projects (LIVE, computed from Lakebase CDC at query time, UNION ALL historical). See data_origin.'
AS
WITH live_cdc AS (
  SELECT * EXCEPT (_pg_change_type, _pg_lsn, _pg_xid, _timestamp, _sort_by, _rn)
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY _pg_lsn DESC) AS _rn
    FROM css_fevm.burns_piping_poc.lb_projects_history
    WHERE _pg_change_type IN ('insert', 'update_postimage', 'delete')
  )
  WHERE _rn = 1 AND _pg_change_type != 'delete'
)
SELECT *, 'LIVE' AS data_origin FROM live_cdc
UNION ALL
SELECT *, 'SYNTHETIC_HISTORICAL' AS data_origin FROM css_fevm.burns_piping_poc.historical_projects;

COMMENT ON COLUMN css_fevm.burns_piping_poc.v_projects.project_id IS 'Unique project identifier (e.g. BM-L-001). Primary key.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_projects.project_name IS 'Human-readable project name.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_projects.client_name IS 'End client the project is being executed for.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_projects.site_location IS 'Physical site/plant location where the piping is installed.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_projects.project_type IS 'EPC project category (e.g. grassroots, revamp, maintenance).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_projects.status IS 'ACTIVE (live, in-flight) or CLOSED (complete).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_projects.target_line_count IS 'Planned total number of piping lines in the project''s scope.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_projects.created_at IS 'Timestamp the project was opened.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_projects.closed_at IS 'Timestamp the project was closed out; NULL while ACTIVE.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_projects.data_origin IS 'LIVE (computed from Lakebase CDC at query time) or SYNTHETIC_HISTORICAL (static ML training data).';

CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.v_lines
COMMENT 'All piping lines, current snapshot (LIVE, computed from Lakebase CDC at query time, UNION ALL historical). See data_origin.'
AS
WITH live_cdc AS (
  SELECT * EXCEPT (_pg_change_type, _pg_lsn, _pg_xid, _timestamp, _sort_by, _rn)
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY line_id ORDER BY _pg_lsn DESC) AS _rn
    FROM css_fevm.burns_piping_poc.lb_lines_history
    WHERE _pg_change_type IN ('insert', 'update_postimage', 'delete')
  )
  WHERE _rn = 1 AND _pg_change_type != 'delete'
)
SELECT *, 'LIVE' AS data_origin FROM live_cdc
UNION ALL
SELECT *, 'SYNTHETIC_HISTORICAL' AS data_origin FROM css_fevm.burns_piping_poc.historical_lines;

COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.line_id IS 'Unique piping line identifier. Primary key.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.project_id IS 'Project this line belongs to. Foreign key to v_projects.project_id.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.line_no IS 'Line-list number as shown on the P&ID/isometric (e.g. L-001).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.service IS 'Process service the line carries (e.g. Cooling Water, Steam, Crude Oil).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.origin_tag IS 'Equipment/line tag the line originates from.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.destination_tag IS 'Equipment/line tag the line terminates at.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.area_package_zone IS 'Plant area, unit, or package the line is routed through.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.line_class_spec IS 'Piping line class / specification governing materials and ratings.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.nominal_size_in IS 'Nominal pipe size, in inches (NPS).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.schedule_thickness IS 'Pipe wall schedule or thickness designation (e.g. SCH 40, XS).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.material IS 'Pipe material of construction (e.g. CS, SS316, Hastelloy).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.design_pressure_psig IS 'Design pressure, in psig.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.design_temperature_f IS 'Design temperature, in degrees Fahrenheit.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.operating_pressure_psig IS 'Normal operating pressure, in psig.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.operating_temperature_f IS 'Normal operating temperature, in degrees Fahrenheit.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.corrosion_allowance_in IS 'Corrosion allowance built into the wall thickness, in inches.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.insulation_type IS 'Insulation type (e.g. none, hot, cold, personnel protection).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.insulation_thickness_in IS 'Insulation thickness, in inches.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.heat_tracing_flag IS 'Whether the line requires heat tracing.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.heat_tracing_spec IS 'Heat tracing specification/type, populated when heat_tracing_flag is true.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.end_connections IS 'End connection type (e.g. flanged, welded, threaded).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.flange_rating IS 'Flange pressure class/rating (e.g. 150#, 300#).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.pid_reference IS 'P&ID drawing number this line appears on.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.isometric_drawing_no IS 'Isometric drawing number for this line.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.estimated_centerline_length_ft IS 'Estimator''s initial centerline length estimate, in feet, entered at Initial Data Entry — the baseline the true-up stages compare the S3D-routed actual length against.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.special_notes IS 'Free-text notes entered by the Estimator.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.current_stage IS 'Current workflow stage, 1-6, denormalized from the latest stage-history event for fast Kanban reads.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.is_complete IS 'True once the line has passed stage 6 (Engineer Final Confirmation).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.created_by IS 'Email of the Estimator who created this line.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.created_at IS 'Timestamp the line was first entered.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.updated_at IS 'Timestamp of the line''s most recent write.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_lines.data_origin IS 'LIVE (computed from Lakebase CDC at query time) or SYNTHETIC_HISTORICAL (static ML training data).';

-- Note: CDC table is lb_stage_events_history (Postgres side: "stage_events")
-- but the live/union side keeps the "stage_history" name throughout (Delta
-- side) — same naming split already established by refresh_silver_gold.py's
-- REFRESH_MAP.
CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.v_stage_history
COMMENT 'Append-only stage-transition audit trail (LIVE, computed from Lakebase CDC at query time, UNION ALL historical). See data_origin.'
AS
WITH live_cdc AS (
  SELECT * EXCEPT (_pg_change_type, _pg_lsn, _pg_xid, _timestamp, _sort_by, _rn)
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY _pg_lsn DESC) AS _rn
    FROM css_fevm.burns_piping_poc.lb_stage_events_history
    WHERE _pg_change_type IN ('insert', 'update_postimage', 'delete')
  )
  WHERE _rn = 1 AND _pg_change_type != 'delete'
)
SELECT *, 'LIVE' AS data_origin FROM live_cdc
UNION ALL
SELECT *, 'SYNTHETIC_HISTORICAL' AS data_origin FROM css_fevm.burns_piping_poc.historical_stage_history;

COMMENT ON COLUMN css_fevm.burns_piping_poc.v_stage_history.event_id IS 'Unique stage-event identifier. Primary key.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_stage_history.line_id IS 'Line this event belongs to. Foreign key to v_lines.line_id.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_stage_history.project_id IS 'Project this event belongs to (denormalized for convenient filtering).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_stage_history.stage_number IS 'Workflow stage number, 1-6, that this event represents.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_stage_history.stage_name IS 'Human-readable name of the stage (e.g. Preliminary True-Up Complete).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_stage_history.event_type IS 'Canonical action code for this event: INITIAL_DATA_ENTRY | INITIAL_ENGINEER_CONFIRMATION | PRELIM_TRUE_UP_COMPLETE | ENGINEER_PRELIM_TRUE_UP_CONFIRMATION | FINAL_TRUE_UP_COMPLETE | ENGINEER_FINAL_CONFIRMATION.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_stage_history.actor_email IS 'Email of the user who performed this action.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_stage_history.actor_role IS 'Role the actor held when performing this action: Estimator, Lead Engineer, or Design Lead.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_stage_history.event_timestamp IS 'When this stage action was performed.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_stage_history.notes IS 'Free-text notes entered with this action, if any.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_stage_history.data_origin IS 'LIVE (computed from Lakebase CDC at query time) or SYNTHETIC_HISTORICAL (static ML training data).';

CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.v_true_up_records
COMMENT 'Baseline-vs-actual true-up reconciliation records (LIVE, computed from Lakebase CDC at query time, UNION ALL historical). See data_origin.'
AS
WITH live_cdc AS (
  SELECT * EXCEPT (_pg_change_type, _pg_lsn, _pg_xid, _timestamp, _sort_by, _rn)
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY true_up_id ORDER BY _pg_lsn DESC) AS _rn
    FROM css_fevm.burns_piping_poc.lb_true_up_records_history
    WHERE _pg_change_type IN ('insert', 'update_postimage', 'delete')
  )
  WHERE _rn = 1 AND _pg_change_type != 'delete'
)
SELECT *, 'LIVE' AS data_origin FROM live_cdc
UNION ALL
SELECT *, 'SYNTHETIC_HISTORICAL' AS data_origin FROM css_fevm.burns_piping_poc.historical_true_up_records;

COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.true_up_id IS 'Unique true-up record identifier. Primary key.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.line_id IS 'Line this true-up applies to. Foreign key to v_lines.line_id.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.project_id IS 'Project this true-up belongs to (denormalized for convenient filtering).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.true_up_type IS 'PRELIMINARY (first routing pass) or FINAL (as-built).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.estimated_centerline_length_ft IS 'Centerline length estimated at Initial Data Entry — the baseline for this true-up''s variance calculation.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.actual_centerline_length_ft IS 'Actual routed centerline length. For LIVE rows this is sourced from S3D 3D design/routing but entered manually today (no live S3D data connection — see ARCHITECTURE.md); for SYNTHETIC_HISTORICAL rows it is a synthetic stand-in.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.length_variance_pct IS 'Percent variance of actual vs. estimated centerline length.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.fitting_detail IS 'JSON array of fitting takeoff detail: [{type, size, estimated_qty, actual_qty}, ...].';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.valve_detail IS 'JSON array of valve takeoff detail, same shape as fitting_detail.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.support_detail IS 'JSON array of pipe support takeoff detail, same shape as fitting_detail.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.weld_count_estimated IS 'Estimated weld count.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.weld_count_actual IS 'Actual weld count from the routed design.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.flange_count_estimated IS 'Estimated flange count.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.flange_count_actual IS 'Actual flange count from the routed design.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.mto_weight_estimated_lb IS 'Estimated material take-off weight, in pounds.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.mto_weight_actual_lb IS 'Actual material take-off weight, in pounds.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.mto_cost_estimated_usd IS 'Estimated material take-off cost, in USD.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.mto_cost_actual_usd IS 'Actual material take-off cost, in USD.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.isometric_drawing_ref IS 'Isometric drawing number this true-up reconciles against.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.pid_ref IS 'P&ID drawing number this true-up reconciles against.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.performed_by IS 'Email of the Design Lead who performed this true-up.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.performed_at IS 'Timestamp the true-up was performed.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.confirmed_by IS 'Email of the Lead Engineer who confirmed this true-up.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.confirmed_at IS 'Timestamp the true-up was confirmed; NULL until confirmed.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_true_up_records.data_origin IS 'LIVE (computed from Lakebase CDC at query time) or SYNTHETIC_HISTORICAL (static ML training data).';

CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.v_change_log
COMMENT 'Reconciliation change/reason entries per true-up (LIVE, computed from Lakebase CDC at query time, UNION ALL historical). See data_origin.'
AS
WITH live_cdc AS (
  SELECT * EXCEPT (_pg_change_type, _pg_lsn, _pg_xid, _timestamp, _sort_by, _rn)
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY change_id ORDER BY _pg_lsn DESC) AS _rn
    FROM css_fevm.burns_piping_poc.lb_change_log_history
    WHERE _pg_change_type IN ('insert', 'update_postimage', 'delete')
  )
  WHERE _rn = 1 AND _pg_change_type != 'delete'
)
SELECT *, 'LIVE' AS data_origin FROM live_cdc
UNION ALL
SELECT *, 'SYNTHETIC_HISTORICAL' AS data_origin FROM css_fevm.burns_piping_poc.historical_change_log;

COMMENT ON COLUMN css_fevm.burns_piping_poc.v_change_log.change_id IS 'Unique change-log entry identifier. Primary key.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_change_log.true_up_id IS 'True-up record this change explains. Foreign key to v_true_up_records.true_up_id.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_change_log.line_id IS 'Line this change applies to (denormalized for convenient filtering).';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_change_log.reason_category IS 'Reason category: DESIGN_CHANGE | CONSTRUCTABILITY | ESTIMATING_ERROR | OTHER.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_change_log.reason_text IS 'Free-text explanation of the variance.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_change_log.changed_by IS 'Email of the user who logged this change entry.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_change_log.changed_at IS 'Timestamp this change entry was logged.';
COMMENT ON COLUMN css_fevm.burns_piping_poc.v_change_log.data_origin IS 'LIVE (computed from Lakebase CDC at query time) or SYNTHETIC_HISTORICAL (static ML training data).';
