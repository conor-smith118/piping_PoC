"""Builds the serialized_space JSON for one project's Genie agent.

Usage: python3 build_agent_config.py BM-L-001 > BM-L-001.geniespace.json
       python3 build_agent_config.py BM-L-001 --catalog my_cat --schema my_schema > ...

Designed once (against BM-L-001, discover-schema'd + validated via CLI),
then templated across all 5 live projects by this script — only the
project_id and the view-name suffix change; column_configs, sample
questions, example SQL shapes, and benchmark question *text* are identical
across projects (the SQL embeds the project's own view names, so results
are naturally scoped).

IDs are deterministic (uuid5 keyed off project_id + a stable label) so
re-running this script for the same project doesn't need a diff to see
what changed, and so ids stay unique across the 5 agents in case they're
ever combined/compared.

--catalog/--schema default to this reference deployment's values. If you're
deploying under a different catalog/schema (see SETUP.md), pass them here —
the fully-qualified view identifiers below get baked directly into the
checked-in *.geniespace.json files (Genie space JSON isn't processed by
DABs variable substitution, same reason the dashboard IDs in app.yaml are
plain literals, not ${resources...} references), so this script must be
re-run (for all 5 projects) and its output re-committed whenever the
catalog/schema changes.
"""
import argparse
import json
import uuid

NAMESPACE = uuid.UUID("6f6e6531-6c69-6e65-706f-632067656e69")  # arbitrary fixed namespace


def genie_id(project_id: str, label: str) -> str:
    return uuid.uuid5(NAMESPACE, f"{project_id}:{label}").hex


def view_suffix(project_id: str) -> str:
    # BM-L-001 -> bm_l_001 (matches src/sql/ddl/05_genie_project_views.sql)
    return project_id.lower().replace("-", "_")


def build(project_id: str, catalog: str, schema: str) -> dict:
    suf = view_suffix(project_id)
    lines_view = f"{catalog}.{schema}.vw_genie_{suf}_lines"
    history_view = f"{catalog}.{schema}.vw_genie_{suf}_stage_history"
    trueup_view = f"{catalog}.{schema}.vw_genie_{suf}_true_up"
    pred_view = f"{catalog}.{schema}.vw_genie_{suf}_predictions"
    # FROM/JOIN clauses use the fully-qualified identifier throughout — this
    # skill's own documented example (create-genie-agent.md) qualifies
    # example_question_sqls this way (`FROM catalog.ops.gold_otp_summary`),
    # unlike the Lakeview-dashboard convention of bare names + separate
    # catalog/schema flags. Column references stay bare for single-table
    # queries (unambiguous) and use short aliases for joins.
    lines_tbl, history_tbl, trueup_tbl, pred_tbl = (
        lines_view,
        history_view,
        trueup_view,
        pred_view,
    )

    # ---- data_sources / column_configs ------------------------------------
    lines_cc = sorted(
        [
            {"column_name": "line_id", "description": ["Internal surrogate key for the line. Join to stage_history/true_up on this."]},
            {"column_name": "project_id", "description": ["Project identifier. This agent is scoped to a single project, so this column is always the same value."]},
            {"column_name": "line_no", "description": ["Human-readable line number (e.g. L-001) — the primary way users refer to a specific line."], "synonyms": ["line number"], "enable_entity_matching": True, "enable_format_assistance": True},
            {"column_name": "service", "description": ["Process service/fluid carried by the line (e.g. Fuel Gas, Cooling Water)."], "synonyms": ["fluid", "process service"], "enable_entity_matching": True, "enable_format_assistance": True},
            {"column_name": "line_class_spec", "description": ["Piping class/spec, e.g. 'Class 300 CS'."], "synonyms": ["pipe class", "line class", "spec"], "enable_entity_matching": True},
            {"column_name": "nominal_size_in", "description": ["Nominal pipe size in inches (NPS)."], "synonyms": ["pipe size", "NPS", "diameter"]},
            {"column_name": "material", "description": ["Pipe material, e.g. Carbon Steel, Stainless 316."], "synonyms": ["pipe material"], "enable_entity_matching": True, "enable_format_assistance": True},
            {"column_name": "estimated_centerline_length_ft", "description": ["Estimator's baseline centerline pipe length in feet, before routing — the value true-ups reconcile against."], "synonyms": ["estimated length", "baseline length"]},
            {"column_name": "current_stage", "description": ["Numeric stage 1-6 the line is currently at in the estimate -> confirm -> true-up workflow."], "synonyms": ["stage number"]},
            {"column_name": "current_stage_name", "description": ["Human-readable name of the line's current workflow stage: Initial Data Entry, Initial Engineer Confirmation, Preliminary True-Up Complete, Engineer Prelim True-Up Confirmation, Final True-Up Complete, or Engineer Final Confirmation."], "synonyms": ["stage", "status", "workflow stage"], "enable_entity_matching": True, "enable_format_assistance": True},
            {"column_name": "is_complete", "description": ["True once the line has passed Engineer Final Confirmation (stage 6)."], "synonyms": ["done", "finished", "complete"]},
            {"column_name": "latest_event_type", "exclude": True},
            {"column_name": "latest_event_actor_email", "description": ["Email of whoever performed the most recent action on this line."], "synonyms": ["last actor", "who last touched this"]},
            {"column_name": "latest_event_actor_role", "description": ["Role (Estimator, Lead Engineer, or Design Lead) of whoever performed the most recent action."], "enable_entity_matching": True},
            {"column_name": "latest_event_timestamp", "description": ["When the most recent stage action was completed. Use this to find lines that have been sitting the longest in their current stage (oldest timestamp = longest wait)."], "synonyms": ["last updated", "last action time"]},
            {"column_name": "prelim_length_variance_pct", "description": ["Percent variance between estimated and actual centerline length at the PRELIMINARY true-up: (actual - estimated) / estimated * 100. NULL until the line reaches stage 3."], "synonyms": ["prelim variance", "preliminary true-up variance"]},
            {"column_name": "final_length_variance_pct", "description": ["Percent variance between estimated and actual centerline length at the FINAL true-up. NULL until the line reaches stage 5."], "synonyms": ["final variance"]},
            {"column_name": "data_origin", "exclude": True},
        ],
        key=lambda c: c["column_name"],
    )

    history_cc = sorted(
        [
            {"column_name": "event_id", "exclude": True},
            {"column_name": "line_id", "description": ["Which line this event belongs to."]},
            {"column_name": "project_id", "description": ["Project identifier — always the same value in this agent."]},
            {"column_name": "stage_number", "description": ["1-6, the stage this event completed."], "synonyms": ["stage"]},
            {"column_name": "stage_name", "description": ["Human-readable name of the stage this event completed."], "enable_entity_matching": True},
            {"column_name": "event_type", "exclude": True},
            {"column_name": "actor_email", "description": ["Who performed this action."], "synonyms": ["who did this", "performed by"]},
            {"column_name": "actor_role", "description": ["Role of whoever performed this action: Estimator, Lead Engineer, or Design Lead."], "enable_entity_matching": True},
            {"column_name": "event_timestamp", "description": ["When this stage action was completed. Use for audit-trail / 'who confirmed X and when' questions."], "synonyms": ["when", "timestamp", "date"]},
            {"column_name": "notes", "description": ["Optional free-text notes attached to the action (usually empty)."]},
            {"column_name": "data_origin", "exclude": True},
        ],
        key=lambda c: c["column_name"],
    )

    trueup_cc = sorted(
        [
            {"column_name": "true_up_id", "exclude": True},
            {"column_name": "line_id", "description": ["Which line this true-up round belongs to."]},
            {"column_name": "project_id", "description": ["Project identifier — always the same value in this agent."]},
            {"column_name": "true_up_type", "description": ["PRELIMINARY (after Basic Routing) or FINAL (after Full Routing) true-up round."], "synonyms": ["prelim or final", "true-up round"], "enable_entity_matching": True},
            {"column_name": "estimated_centerline_length_ft", "description": ["Baseline centerline pipe length in feet for this true-up round."], "synonyms": ["estimated length"]},
            {"column_name": "actual_centerline_length_ft", "description": ["As-routed centerline pipe length in feet for this true-up round."], "synonyms": ["actual length", "routed length"]},
            {"column_name": "length_variance_pct", "description": ["Percent variance: (actual - estimated) / estimated * 100. Positive means the actual routed length came in longer than estimated."], "synonyms": ["variance", "length variance", "how far off"]},
            {"column_name": "fitting_detail", "exclude": True},
            {"column_name": "valve_detail", "exclude": True},
            {"column_name": "support_detail", "exclude": True},
            {"column_name": "weld_count_estimated", "description": ["Estimated weld count for this true-up round."], "synonyms": ["weld count"]},
            {"column_name": "weld_count_actual", "description": ["Actual weld count for this true-up round."], "synonyms": ["weld count"]},
            {"column_name": "flange_count_estimated", "description": ["Estimated flange count for this true-up round."], "synonyms": ["flange count"]},
            {"column_name": "flange_count_actual", "description": ["Actual flange count for this true-up round."], "synonyms": ["flange count"]},
            {"column_name": "mto_weight_estimated_lb", "description": ["Material takeoff (MTO) weight in pounds, estimated."], "synonyms": ["MTO weight", "pipe weight"]},
            {"column_name": "mto_weight_actual_lb", "description": ["Material takeoff (MTO) weight in pounds, actual."], "synonyms": ["MTO weight", "pipe weight"]},
            {"column_name": "mto_cost_estimated_usd", "description": ["Material takeoff (MTO) cost in USD, estimated."], "synonyms": ["MTO cost", "material cost"]},
            {"column_name": "mto_cost_actual_usd", "description": ["Material takeoff (MTO) cost in USD, actual."], "synonyms": ["MTO cost", "material cost"]},
            {"column_name": "isometric_drawing_ref", "description": ["Reference to the isometric drawing for this line/true-up."], "synonyms": ["isometric", "iso drawing"]},
            {"column_name": "pid_ref", "description": ["Reference to the P&ID for this line/true-up."], "synonyms": ["P&ID", "PID reference"]},
            {"column_name": "performed_by", "description": ["Who (Design Lead) performed this true-up."]},
            {"column_name": "performed_at", "description": ["When this true-up was performed."]},
            {"column_name": "confirmed_by", "description": ["Who (Lead Engineer) confirmed this true-up. NULL if not yet confirmed."], "synonyms": ["who confirmed"]},
            {"column_name": "confirmed_at", "description": ["When this true-up was confirmed. NULL if not yet confirmed."], "synonyms": ["confirmation date"]},
            {"column_name": "data_origin", "exclude": True},
            {"column_name": "reason_category", "description": ["Category of why a reconciliation change occurred: DESIGN_CHANGE, CONSTRUCTABILITY, ESTIMATING_ERROR, or OTHER. NULL if no change was logged for this true-up."], "synonyms": ["reason", "why the change", "change category"], "enable_entity_matching": True},
            {"column_name": "reason_text", "description": ["Free-text explanation of the change, if logged."], "synonyms": ["reason details"]},
            {"column_name": "changed_by", "description": ["Who logged the change/reason entry."]},
            {"column_name": "changed_at", "description": ["When the change/reason entry was logged."]},
        ],
        key=lambda c: c["column_name"],
    )

    pred_cc = sorted(
        [
            {"column_name": "project_id", "description": ["Project identifier — always the same value in this agent."]},
            {"column_name": "line_id", "description": ["Which line this prediction is for."]},
            {"column_name": "current_stage", "description": ["The stage the line was at when this prediction was made."]},
            {"column_name": "predicted_remaining_hours", "description": ["Model-predicted hours remaining until this line reaches Engineer Final Confirmation (stage 6)."], "synonyms": ["time remaining", "ETA", "how much longer"]},
            {"column_name": "predicted_completion_ts", "description": ["Model-predicted date/time this line will reach full completion."], "synonyms": ["estimated completion date", "when will this finish"]},
            {"column_name": "model_version", "exclude": True},
            {"column_name": "scored_at", "description": ["When this prediction was generated — predictions refresh periodically, not in real time."], "synonyms": ["prediction date", "last scored"]},
        ],
        key=lambda c: c["column_name"],
    )

    data_sources = {
        "tables": sorted(
            [
                {"identifier": lines_view, "column_configs": lines_cc},
                {"identifier": history_view, "column_configs": history_cc},
                {"identifier": trueup_view, "column_configs": trueup_cc},
                {"identifier": pred_view, "column_configs": pred_cc},
            ],
            key=lambda t: t["identifier"],
        )
    }

    # ---- sample questions (UI-facing) -------------------------------------
    sample_qs = [
        "How many lines are still in Initial Data Entry?",
        "Which lines have the largest true-up variance, and what was the reason?",
        "Who confirmed the final true-up for a given line, and when?",
        "Which lines have been sitting longest in their current stage?",
        "What's the estimated time remaining for a given line?",
    ]
    config = {
        "sample_questions": sorted(
            [{"id": genie_id(project_id, f"sq:{q}"), "question": [q]} for q in sample_qs],
            key=lambda x: x["id"],
        )
    }

    # ---- example SQL (teaches query shapes) -------------------------------
    # FROM/JOIN always use the fully-qualified identifier; every column
    # reference uses an explicit short alias (l/h/t/p) — never an implicit
    # "last segment as alias", which is the one place this could get
    # ambiguous. Every one of these is validated against the real warehouse
    # before the space is created (see the validation step in the plan).
    examples = [
        (
            "How many lines are still in Initial Data Entry?",
            f"SELECT COUNT(*) AS n FROM {lines_tbl} l WHERE l.current_stage_name = 'Initial Data Entry'",
        ),
        (
            "Which line has the largest preliminary true-up variance?",
            f"SELECT l.line_no, l.prelim_length_variance_pct FROM {lines_tbl} l "
            f"WHERE l.prelim_length_variance_pct IS NOT NULL "
            f"ORDER BY ABS(l.prelim_length_variance_pct) DESC LIMIT 1",
        ),
        (
            "Which line's final true-up was most recently confirmed, and by whom?",
            f"SELECT l.line_no, t.confirmed_by, t.confirmed_at FROM {trueup_tbl} t "
            f"JOIN {lines_tbl} l ON l.line_id = t.line_id "
            f"WHERE t.true_up_type = 'FINAL' AND t.confirmed_by IS NOT NULL "
            f"ORDER BY t.confirmed_at DESC LIMIT 1",
        ),
        (
            "Which line has been sitting longest in its current stage?",
            f"SELECT l.line_no, l.current_stage_name, l.latest_event_timestamp "
            f"FROM {lines_tbl} l WHERE NOT l.is_complete "
            f"ORDER BY l.latest_event_timestamp ASC LIMIT 1",
        ),
        (
            "Which line has the longest estimated time remaining, and how long?",
            f"SELECT l.line_no, p.predicted_remaining_hours, p.predicted_completion_ts FROM {pred_tbl} p "
            f"JOIN {lines_tbl} l ON l.line_id = p.line_id ORDER BY p.predicted_remaining_hours DESC LIMIT 1",
        ),
    ]
    example_question_sqls = sorted(
        [{"id": genie_id(project_id, f"ex:{q}"), "question": [q], "sql": [sql]} for q, sql in examples],
        key=lambda x: x["id"],
    )

    # ---- text instructions (last resort — only global, non-structural rules)
    text_instructions = [
        {
            "id": genie_id(project_id, "text_instructions"),
            "content": [
                "## PURPOSE",
                f"- Answer questions about piping project {project_id}'s line list, stage progress, and true-up reconciliation.",
                "- Users are EPC project team members (Estimator/Lead Engineer/Design Lead/Admin) fluent in piping terminology.",
                "",
                "## DATA QUALITY NOTES",
                f"- {lines_tbl}.prelim_length_variance_pct and final_length_variance_pct are NULL until the line reaches stage 3 / stage 5 respectively — not a data error.",
                f"- {trueup_tbl}.confirmed_by/confirmed_at are NULL for true-ups awaiting Lead Engineer confirmation — not a data error.",
                f"- {pred_tbl} may be empty between batch-scoring runs; state that predictions are unavailable rather than treating an empty result as zero lines.",
                "",
                "## CONSTRAINTS",
                f"- Never guess at rows not present in {lines_tbl}, {history_tbl}, {trueup_tbl}, or {pred_tbl} — this agent only has data for project "
                f"{project_id}.",
            ],
        }
    ]

    # ---- benchmarks (>=30 items, checked SQL, single_sql_answer strategy) -
    benchmarks_raw = [
        ("How many lines are in Initial Data Entry?", f"SELECT COUNT(*) FROM {lines_tbl} WHERE current_stage_name = 'Initial Data Entry'"),
        ("How many lines are in Initial Engineer Confirmation?", f"SELECT COUNT(*) FROM {lines_tbl} WHERE current_stage_name = 'Initial Engineer Confirmation'"),
        ("How many lines are in Preliminary True-Up Complete?", f"SELECT COUNT(*) FROM {lines_tbl} WHERE current_stage_name = 'Preliminary True-Up Complete'"),
        ("How many lines are fully complete?", f"SELECT COUNT(*) FROM {lines_tbl} WHERE is_complete = true"),
        ("What stage is line L-005 at?", f"SELECT current_stage_name FROM {lines_tbl} WHERE line_no = 'L-005'"),
        ("What stage is line L-010 at?", f"SELECT current_stage_name FROM {lines_tbl} WHERE line_no = 'L-010'"),
        ("Which line has the largest preliminary true-up variance?", f"SELECT line_no, prelim_length_variance_pct FROM {lines_tbl} WHERE prelim_length_variance_pct IS NOT NULL ORDER BY ABS(prelim_length_variance_pct) DESC LIMIT 1"),
        ("Which line has the largest final true-up variance?", f"SELECT line_no, final_length_variance_pct FROM {lines_tbl} WHERE final_length_variance_pct IS NOT NULL ORDER BY ABS(final_length_variance_pct) DESC LIMIT 1"),
        ("What is the average preliminary length variance across all lines?", f"SELECT AVG(prelim_length_variance_pct) FROM {lines_tbl}"),
        ("Which lines have a preliminary variance greater than 5 percent in magnitude?", f"SELECT line_no, prelim_length_variance_pct FROM {lines_tbl} WHERE ABS(prelim_length_variance_pct) > 5"),
        ("Which line's final true-up was most recently confirmed, and by whom?", f"SELECT l.line_no, t.confirmed_by, t.confirmed_at FROM {trueup_tbl} t JOIN {lines_tbl} l ON l.line_id = t.line_id WHERE t.true_up_type = 'FINAL' AND t.confirmed_by IS NOT NULL ORDER BY t.confirmed_at DESC LIMIT 1"),
        ("Which line's preliminary true-up was most recently performed, and by whom?", f"SELECT l.line_no, t.performed_by, t.performed_at FROM {trueup_tbl} t JOIN {lines_tbl} l ON l.line_id = t.line_id WHERE t.true_up_type = 'PRELIMINARY' ORDER BY t.performed_at DESC LIMIT 1"),
        ("Which lines have true-ups that are not yet confirmed?", f"SELECT l.line_no, t.true_up_type FROM {trueup_tbl} t JOIN {lines_tbl} l ON l.line_id = t.line_id WHERE t.confirmed_by IS NULL"),
        ("Which line has been sitting longest in its current stage?", f"SELECT line_no, current_stage_name, latest_event_timestamp FROM {lines_tbl} WHERE NOT is_complete ORDER BY latest_event_timestamp ASC LIMIT 1"),
        ("Which lines have been in their current stage for more than 5 days?", f"SELECT line_no, current_stage_name FROM {lines_tbl} WHERE NOT is_complete AND datediff(current_timestamp(), latest_event_timestamp) > 5"),
        ("Who is the most recent actor to touch this project, and when?", f"SELECT latest_event_actor_email, latest_event_timestamp FROM {lines_tbl} ORDER BY latest_event_timestamp DESC LIMIT 1"),
        ("How many lines were last touched by the Design Lead?", f"SELECT COUNT(*) FROM {lines_tbl} WHERE latest_event_actor_role = 'Design Lead'"),
        ("Which line has the shortest estimated time remaining?", f"SELECT l.line_no, p.predicted_remaining_hours FROM {pred_tbl} p JOIN {lines_tbl} l ON l.line_id = p.line_id ORDER BY p.predicted_remaining_hours ASC LIMIT 1"),
        ("Which line has the longest predicted remaining time?", f"SELECT l.line_no, p.predicted_remaining_hours FROM {pred_tbl} p JOIN {lines_tbl} l ON l.line_id = p.line_id ORDER BY p.predicted_remaining_hours DESC LIMIT 1"),
        ("What is line L-001's material and nominal size?", f"SELECT material, nominal_size_in FROM {lines_tbl} WHERE line_no = 'L-001'"),
        ("Which lines use Stainless 316?", f"SELECT line_no FROM {lines_tbl} WHERE material = 'Stainless 316'"),
        ("Which lines have a design-change reason logged?", f"SELECT DISTINCT l.line_no FROM {trueup_tbl} t JOIN {lines_tbl} l ON l.line_id = t.line_id WHERE t.reason_category = 'DESIGN_CHANGE'"),
        ("What reasons have been logged for true-up changes, and how many of each?", f"SELECT reason_category, COUNT(*) FROM {trueup_tbl} WHERE reason_category IS NOT NULL GROUP BY reason_category"),
        ("What is the total MTO cost variance across all true-ups?", f"SELECT SUM(mto_cost_actual_usd - mto_cost_estimated_usd) FROM {trueup_tbl}"),
        ("Which line had the biggest MTO cost overrun?", f"SELECT l.line_no, (t.mto_cost_actual_usd - t.mto_cost_estimated_usd) AS overrun FROM {trueup_tbl} t JOIN {lines_tbl} l ON l.line_id = t.line_id ORDER BY overrun DESC LIMIT 1"),
        ("How many stage transitions has line L-002 gone through?", f"SELECT COUNT(*) FROM {history_tbl} h JOIN {lines_tbl} l ON l.line_id = h.line_id WHERE l.line_no = 'L-002'"),
        ("Who was the Estimator who entered line L-001's initial data?", f"SELECT h.actor_email FROM {history_tbl} h JOIN {lines_tbl} l ON l.line_id = h.line_id WHERE l.line_no = 'L-001' AND h.stage_number = 1"),
        ("What's the P&ID reference for the most recently performed true-up?", f"SELECT l.line_no, t.pid_ref FROM {trueup_tbl} t JOIN {lines_tbl} l ON l.line_id = t.line_id ORDER BY t.performed_at DESC LIMIT 1"),
        ("What's the isometric drawing reference for the most recently performed true-up?", f"SELECT l.line_no, t.isometric_drawing_ref FROM {trueup_tbl} t JOIN {lines_tbl} l ON l.line_id = t.line_id ORDER BY t.performed_at DESC LIMIT 1"),
        ("How many lines have not yet started their preliminary true-up (stage less than 3)?", f"SELECT COUNT(*) FROM {lines_tbl} WHERE current_stage < 3"),
        ("What's the total estimated centerline length across all lines in this project?", f"SELECT SUM(estimated_centerline_length_ft) FROM {lines_tbl}"),
        ("How many distinct services are represented in this project's line list?", f"SELECT COUNT(DISTINCT service) FROM {lines_tbl}"),
    ]
    benchmarks = {
        "questions": sorted(
            [
                {
                    "id": genie_id(project_id, f"bm:{q}"),
                    "question": [q],
                    "answer": [{"format": "SQL", "content": [sql]}],
                }
                for q, sql in benchmarks_raw
            ],
            key=lambda x: x["id"],
        )
    }

    return {
        "version": 2,
        "config": config,
        "data_sources": data_sources,
        "instructions": {
            "example_question_sqls": example_question_sqls,
            "text_instructions": text_instructions,
        },
        "benchmarks": benchmarks,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("project_id")
    parser.add_argument("--catalog", default="css_fevm")
    parser.add_argument("--schema", default="burns_piping_poc")
    args = parser.parse_args()
    print(json.dumps(build(args.project_id, args.catalog, args.schema), indent=2))
