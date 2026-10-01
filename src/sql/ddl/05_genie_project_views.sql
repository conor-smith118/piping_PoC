-- ============================================================================
-- Per-project views for Genie agents (Phase 7).
--
-- Genie agents run under a shared space identity, not per-asking-user OBO —
-- unlike the app's dynamic current_user()-based authorization, per-project
-- isolation here must be STATIC, literal-project_id views. One set of 4 per
-- live project (BM-L-001..005) = 20 objects, comfortably under Genie's
-- per-agent object guidance (each agent only points at its own project's 4).
--
-- Deliberately broader than the dashboard's tables per the stakeholder's ask
-- ("broader tables ... appropriately scoped to each project") — full stage
-- history (who/when/role) and true-up + change-log detail, not just the
-- dashboard's aggregated gold_line_status/gold_project_rollup.
--
-- Each view below is commented at the table level only (what it is, which
-- source view it filters, which project). Column-level comments are not
-- duplicated 20x here — each view is a plain `SELECT * FROM <source>
-- WHERE project_id = ...` passthrough of a view that already carries full
-- column comments (gold_line_status, v_stage_history, v_true_up_records/
-- v_change_log, gold_ml_predictions — see 03_union_views.sql/
-- 04_gold_tables.sql), so Genie resolves column semantics from there.
-- ============================================================================

CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.vw_genie_bm_l_001_lines
COMMENT 'Genie-scoped lines view for project BM-L-001 — gold_line_status filtered to this project only.'
AS SELECT * FROM css_fevm.burns_piping_poc.gold_line_status WHERE project_id = 'BM-L-001';
CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.vw_genie_bm_l_001_stage_history
COMMENT 'Genie-scoped stage-history view for project BM-L-001 — v_stage_history filtered to this project only.'
AS SELECT * FROM css_fevm.burns_piping_poc.v_stage_history WHERE project_id = 'BM-L-001';
CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.vw_genie_bm_l_001_true_up
COMMENT 'Genie-scoped true-up + change-log view for project BM-L-001 — v_true_up_records joined to v_change_log, filtered to this project only.'
AS SELECT t.*, c.reason_category, c.reason_text, c.changed_by, c.changed_at
FROM css_fevm.burns_piping_poc.v_true_up_records t
LEFT JOIN css_fevm.burns_piping_poc.v_change_log c ON c.true_up_id = t.true_up_id
WHERE t.project_id = 'BM-L-001';
CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.vw_genie_bm_l_001_predictions
COMMENT 'Genie-scoped ML predictions view for project BM-L-001 — gold_ml_predictions filtered to this project only.'
AS SELECT * FROM css_fevm.burns_piping_poc.gold_ml_predictions WHERE project_id = 'BM-L-001';

CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.vw_genie_bm_l_002_lines
COMMENT 'Genie-scoped lines view for project BM-L-002 — gold_line_status filtered to this project only.'
AS SELECT * FROM css_fevm.burns_piping_poc.gold_line_status WHERE project_id = 'BM-L-002';
CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.vw_genie_bm_l_002_stage_history
COMMENT 'Genie-scoped stage-history view for project BM-L-002 — v_stage_history filtered to this project only.'
AS SELECT * FROM css_fevm.burns_piping_poc.v_stage_history WHERE project_id = 'BM-L-002';
CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.vw_genie_bm_l_002_true_up
COMMENT 'Genie-scoped true-up + change-log view for project BM-L-002 — v_true_up_records joined to v_change_log, filtered to this project only.'
AS SELECT t.*, c.reason_category, c.reason_text, c.changed_by, c.changed_at
FROM css_fevm.burns_piping_poc.v_true_up_records t
LEFT JOIN css_fevm.burns_piping_poc.v_change_log c ON c.true_up_id = t.true_up_id
WHERE t.project_id = 'BM-L-002';
CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.vw_genie_bm_l_002_predictions
COMMENT 'Genie-scoped ML predictions view for project BM-L-002 — gold_ml_predictions filtered to this project only.'
AS SELECT * FROM css_fevm.burns_piping_poc.gold_ml_predictions WHERE project_id = 'BM-L-002';

CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.vw_genie_bm_l_003_lines
COMMENT 'Genie-scoped lines view for project BM-L-003 — gold_line_status filtered to this project only.'
AS SELECT * FROM css_fevm.burns_piping_poc.gold_line_status WHERE project_id = 'BM-L-003';
CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.vw_genie_bm_l_003_stage_history
COMMENT 'Genie-scoped stage-history view for project BM-L-003 — v_stage_history filtered to this project only.'
AS SELECT * FROM css_fevm.burns_piping_poc.v_stage_history WHERE project_id = 'BM-L-003';
CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.vw_genie_bm_l_003_true_up
COMMENT 'Genie-scoped true-up + change-log view for project BM-L-003 — v_true_up_records joined to v_change_log, filtered to this project only.'
AS SELECT t.*, c.reason_category, c.reason_text, c.changed_by, c.changed_at
FROM css_fevm.burns_piping_poc.v_true_up_records t
LEFT JOIN css_fevm.burns_piping_poc.v_change_log c ON c.true_up_id = t.true_up_id
WHERE t.project_id = 'BM-L-003';
CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.vw_genie_bm_l_003_predictions
COMMENT 'Genie-scoped ML predictions view for project BM-L-003 — gold_ml_predictions filtered to this project only.'
AS SELECT * FROM css_fevm.burns_piping_poc.gold_ml_predictions WHERE project_id = 'BM-L-003';

CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.vw_genie_bm_l_004_lines
COMMENT 'Genie-scoped lines view for project BM-L-004 — gold_line_status filtered to this project only.'
AS SELECT * FROM css_fevm.burns_piping_poc.gold_line_status WHERE project_id = 'BM-L-004';
CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.vw_genie_bm_l_004_stage_history
COMMENT 'Genie-scoped stage-history view for project BM-L-004 — v_stage_history filtered to this project only.'
AS SELECT * FROM css_fevm.burns_piping_poc.v_stage_history WHERE project_id = 'BM-L-004';
CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.vw_genie_bm_l_004_true_up
COMMENT 'Genie-scoped true-up + change-log view for project BM-L-004 — v_true_up_records joined to v_change_log, filtered to this project only.'
AS SELECT t.*, c.reason_category, c.reason_text, c.changed_by, c.changed_at
FROM css_fevm.burns_piping_poc.v_true_up_records t
LEFT JOIN css_fevm.burns_piping_poc.v_change_log c ON c.true_up_id = t.true_up_id
WHERE t.project_id = 'BM-L-004';
CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.vw_genie_bm_l_004_predictions
COMMENT 'Genie-scoped ML predictions view for project BM-L-004 — gold_ml_predictions filtered to this project only.'
AS SELECT * FROM css_fevm.burns_piping_poc.gold_ml_predictions WHERE project_id = 'BM-L-004';

CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.vw_genie_bm_l_005_lines
COMMENT 'Genie-scoped lines view for project BM-L-005 — gold_line_status filtered to this project only.'
AS SELECT * FROM css_fevm.burns_piping_poc.gold_line_status WHERE project_id = 'BM-L-005';
CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.vw_genie_bm_l_005_stage_history
COMMENT 'Genie-scoped stage-history view for project BM-L-005 — v_stage_history filtered to this project only.'
AS SELECT * FROM css_fevm.burns_piping_poc.v_stage_history WHERE project_id = 'BM-L-005';
CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.vw_genie_bm_l_005_true_up
COMMENT 'Genie-scoped true-up + change-log view for project BM-L-005 — v_true_up_records joined to v_change_log, filtered to this project only.'
AS SELECT t.*, c.reason_category, c.reason_text, c.changed_by, c.changed_at
FROM css_fevm.burns_piping_poc.v_true_up_records t
LEFT JOIN css_fevm.burns_piping_poc.v_change_log c ON c.true_up_id = t.true_up_id
WHERE t.project_id = 'BM-L-005';
CREATE OR REPLACE VIEW css_fevm.burns_piping_poc.vw_genie_bm_l_005_predictions
COMMENT 'Genie-scoped ML predictions view for project BM-L-005 — gold_ml_predictions filtered to this project only.'
AS SELECT * FROM css_fevm.burns_piping_poc.gold_ml_predictions WHERE project_id = 'BM-L-005';
