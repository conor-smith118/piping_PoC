-- ============================================================================
-- Comments for the lb_*_history CDC landing tables.
--
-- Unlike every other file in this directory, this one does not CREATE
-- anything: lb_*_history tables are auto-created by Lakehouse Sync
-- (`databricks postgres create-cdf-config`) the first time it replicates
-- each Lakebase table, not by any DDL in this repo. They already exist by
-- the time this file is ever run, so it's COMMENT ON TABLE only — re-run
-- safely any time (idempotent).
--
-- Column-level comments are deliberately not applied here: _pg_change_type/
-- _pg_lsn/_pg_xid/_timestamp/_sort_by are Lakehouse Sync's own technical
-- metadata columns (not authored by this repo), and the real business
-- columns on each table are 1:1 with their Lakebase/live_* counterpart,
-- already fully commented in 01_live_tables.sql. Nothing downstream queries
-- these tables directly except the v_*.sql views (03_union_views.sql),
-- which is where a human or Genie would actually encounter this data.
-- ============================================================================
--
-- NOTE: all object names below are bare (not catalog.schema-qualified) --
-- run `USE CATALOG <catalog>; USE SCHEMA <schema>;` first (or let the
-- apply_catalog_schema_ddl job do it for you; see SETUP.md). This is what
-- makes this file portable to any catalog/schema with zero find-and-replace.
-- ============================================================================

COMMENT ON TABLE lb_projects_history IS 'Lakehouse Sync CDC landing table for Lakebase''s projects table — append-only change feed (_pg_change_type/_pg_lsn/_pg_xid/_timestamp/_sort_by). Consumed at query time by v_projects and in batch by refresh_silver_gold (for live_projects).';
COMMENT ON TABLE lb_lines_history IS 'Lakehouse Sync CDC landing table for Lakebase''s lines table — append-only change feed. Consumed at query time by v_lines and in batch by refresh_silver_gold (for live_lines).';
COMMENT ON TABLE lb_stage_events_history IS 'Lakehouse Sync CDC landing table for Lakebase''s stage_events table — append-only change feed. Consumed at query time by v_stage_history (note the Delta-side name) and in batch by refresh_silver_gold (for live_stage_history).';
COMMENT ON TABLE lb_true_up_records_history IS 'Lakehouse Sync CDC landing table for Lakebase''s true_up_records table — append-only change feed. Consumed at query time by v_true_up_records and in batch by refresh_silver_gold (for live_true_up_records).';
COMMENT ON TABLE lb_change_log_history IS 'Lakehouse Sync CDC landing table for Lakebase''s change_log table — append-only change feed. Consumed at query time by v_change_log and in batch by refresh_silver_gold (for live_change_log).';
COMMENT ON TABLE lb_user_project_role_history IS 'Lakehouse Sync CDC landing table for Lakebase''s user_project_role table — append-only change feed. No v_* counterpart (role assignments have no historical/synthetic side); consumed in batch by refresh_silver_gold (for live_user_project_role).';
