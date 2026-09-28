-- ============================================================================
-- Union views over LIVE + HISTORICAL, adding a literal data_origin column.
-- These are what the gold layer, ML feature pipeline, and (indirectly, via
-- gold_*) the dashboard/Genie views read — never the raw live_*/historical_*
-- tables directly, except refresh_silver_gold.py and the historical generator
-- which write to them.
-- ============================================================================

CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.v_projects AS
SELECT *, 'LIVE' AS data_origin FROM css_fevm.burns_piping_poc.live_projects
UNION ALL
SELECT *, 'SYNTHETIC_HISTORICAL' AS data_origin FROM css_fevm.burns_piping_poc.historical_projects;

CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.v_lines AS
SELECT *, 'LIVE' AS data_origin FROM css_fevm.burns_piping_poc.live_lines
UNION ALL
SELECT *, 'SYNTHETIC_HISTORICAL' AS data_origin FROM css_fevm.burns_piping_poc.historical_lines;

CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.v_stage_history AS
SELECT *, 'LIVE' AS data_origin FROM css_fevm.burns_piping_poc.live_stage_history
UNION ALL
SELECT *, 'SYNTHETIC_HISTORICAL' AS data_origin FROM css_fevm.burns_piping_poc.historical_stage_history;

CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.v_true_up_records AS
SELECT *, 'LIVE' AS data_origin FROM css_fevm.burns_piping_poc.live_true_up_records
UNION ALL
SELECT *, 'SYNTHETIC_HISTORICAL' AS data_origin FROM css_fevm.burns_piping_poc.historical_true_up_records;

CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.v_change_log AS
SELECT *, 'LIVE' AS data_origin FROM css_fevm.burns_piping_poc.live_change_log
UNION ALL
SELECT *, 'SYNTHETIC_HISTORICAL' AS data_origin FROM css_fevm.burns_piping_poc.historical_change_log;
