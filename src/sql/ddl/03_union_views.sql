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
-- ============================================================================

CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.v_projects AS
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

CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.v_lines AS
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

-- Note: CDC table is lb_stage_events_history (Postgres side: "stage_events")
-- but the live/union side keeps the "stage_history" name throughout (Delta
-- side) — same naming split already established by refresh_silver_gold.py's
-- REFRESH_MAP.
CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.v_stage_history AS
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

CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.v_true_up_records AS
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

CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.v_change_log AS
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
