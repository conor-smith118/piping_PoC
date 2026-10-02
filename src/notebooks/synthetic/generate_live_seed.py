"""Generate the frozen live-data seed for the 5 live piping projects.

Unlike generate_historical_projects.py (a Databricks notebook run as a Lakeflow
Job, writing straight to Delta), this is a LOCAL generator: Lakebase seeding is
fundamentally "produce SQL, apply it via `databricks psql`" — the same pattern
already used for src/sql/lakebase/00_schema.sql in Phase 0. Running this locally
avoids needing psycopg2 + OAuth-token plumbing inside a remote notebook for what
is a one-time, deterministic operation.

Usage:
    python3 src/notebooks/synthetic/generate_live_seed.py > src/sql/lakebase/seed_live_data.sql
    databricks psql --project <your-lakebase-project> --profile <your-profile> -- -f src/sql/lakebase/seed_live_data.sql

The generated file is checked into the repo and is exactly the "frozen seed
snapshot" reset_poc replays — it is NOT re-run with a different random seed
on reset; the seed value below is fixed for reproducibility.

Story: 5 ACTIVE projects, lines spread across all 6 stages in a funnel shape
(most lines early, a few fully through) so the Kanban board has cards in every
column and the dashboard shows a mix of complete/in-flight work from the first
run — this is what a customer sees before ever clicking "simulate new data".

--test-user-email: the one real per-project role assignment described below
(projects 1-3, one non-admin role each) is written for this email, so that
user can exercise the Databricks RBAC "assume role" demo flow (see
ARCHITECTURE.md) without needing the in-app "view as" switcher. Defaults to
this reference deployment's test identity; pass your own test user's email
here, then re-run this script and re-apply the regenerated
seed_live_data.sql (see SETUP.md) before using a different test user.
"""
import argparse
import random
import numpy as np
import json
from datetime import datetime, timedelta

random.seed(777)
np.random.seed(777)

parser = argparse.ArgumentParser()
parser.add_argument("--test-user-email", default="conor.smith@databricks.com")
args = parser.parse_args()
TEST_USER_EMAIL = args.test_user_email

N_PROJECTS = 5

CLIENTS = ["Meridian Energy Partners", "Cascade Petrochemical", "Prairie Power & Light",
           "Gulfstream Refining Co.", "Highland Gas Processing"]
SITE_LOCATIONS = ["Beaumont, TX", "Baton Rouge, LA", "Corpus Christi, TX", "Lake Charles, LA", "Tulsa, OK"]
PROJECT_TYPES = ["Refinery Expansion", "LNG Terminal", "Gas Processing Plant",
                 "Petrochemical Unit", "Power Plant Piping"]
AREAS = ["Unit 100", "Unit 200", "Unit 300", "Tank Farm", "Pipe Rack A", "Pipe Rack B", "Utilities"]
SERVICES = ["Fuel Gas", "Cooling Water", "Process Water", "Steam", "Condensate",
            "Crude Oil", "Produced Water", "Instrument Air", "Nitrogen", "Flare Gas"]

MATERIALS = [("Carbon Steel", 0.55), ("Stainless 304", 0.15), ("Stainless 316", 0.15),
             ("Chrome Moly (P11)", 0.05), ("Chrome Moly (P22)", 0.03), ("HDPE", 0.04), ("PVC", 0.03)]
NON_METALLIC = {"HDPE", "PVC"}
NPS_SIZES = [(0.5, .05), (0.75, .05), (1, .08), (1.5, .10), (2, .12), (3, .12), (4, .12),
             (6, .10), (8, .08), (10, .06), (12, .05), (16, .03), (20, .02), (24, .02)]
SCHEDULES = ["SCH 40", "SCH 80", "SCH 160", "XS", "STD", "XXS"]
END_CONNECTIONS = ["Flanged", "Butt-Weld", "Threaded", "Socket-Weld"]
FLANGE_RATINGS = ["150#", "300#", "600#", "900#"]
INSULATION_TYPES = [(None, 0.55), ("Mineral Wool", 0.20), ("Calcium Silicate", 0.15), ("Foam Glass", 0.10)]
FITTING_TYPES = ["90 Elbow", "45 Elbow", "Tee"]
VALVE_TYPES = ["Gate", "Globe", "Check", "Ball", "Control"]
REASON_CATEGORIES = [("DESIGN_CHANGE", 0.40), ("CONSTRUCTABILITY", 0.30),
                      ("ESTIMATING_ERROR", 0.20), ("OTHER", 0.10)]

STAGES = [
    {"n": 1, "name": "Initial Data Entry", "event_type": "INITIAL_DATA_ENTRY", "role": "Estimator", "hours": 6},
    {"n": 2, "name": "Initial Engineer Confirmation", "event_type": "INITIAL_ENGINEER_CONFIRMATION", "role": "Lead Engineer", "hours": 10},
    {"n": 3, "name": "Preliminary True-Up Complete", "event_type": "PRELIM_TRUE_UP_COMPLETE", "role": "Design Lead", "hours": 48},
    {"n": 4, "name": "Engineer Prelim True-Up Confirmation", "event_type": "ENGINEER_PRELIM_TRUE_UP_CONFIRMATION", "role": "Lead Engineer", "hours": 14},
    {"n": 5, "name": "Final True-Up Complete", "event_type": "FINAL_TRUE_UP_COMPLETE", "role": "Design Lead", "hours": 60},
    {"n": 6, "name": "Engineer Final Confirmation", "event_type": "ENGINEER_FINAL_CONFIRMATION", "role": "Lead Engineer", "hours": 12},
]
# Funnel: most lines still early-stage, a few fully through — gives the Kanban
# board cards in every column on day one.
STAGE_WEIGHTS = [0.28, 0.22, 0.18, 0.14, 0.10, 0.08]


def weighted_choice(pairs):
    values, weights = zip(*pairs)
    return random.choices(values, weights=weights, k=1)[0]


def sql_str(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def sql_ts(v):
    if v is None:
        return "NULL"
    return "'" + v.strftime("%Y-%m-%d %H:%M:%S") + "'"


def sql_bool(v):
    return "TRUE" if v else "FALSE"


def sql_num(v):
    return "NULL" if v is None else str(v)


def sql_json(v):
    return "NULL" if v is None else "'" + json.dumps(v).replace("'", "''") + "'::jsonb"


def make_actor_email(role, project_id):
    return f"{role.lower().replace(' ', '_')}.{project_id.lower()}@example-epc.com"


lines_out = []
projects_out = []
roles_out = []
events_out = []
trueups_out = []
changes_out = []

NOW = datetime(2026, 9, 28, 12, 0, 0)

for i in range(1, N_PROJECTS + 1):
    project_id = f"BM-L-{i:03d}"
    created_at = NOW - timedelta(days=random.randint(20, 75))
    n_lines = random.randint(15, 25)
    projects_out.append(
        f"INSERT INTO projects (project_id, project_name, client_name, site_location, project_type, "
        f"status, target_line_count, created_at) VALUES ("
        f"{sql_str(project_id)}, {sql_str(random.choice(PROJECT_TYPES) + ' - ' + random.choice(AREAS))}, "
        f"{sql_str(random.choice(CLIENTS))}, {sql_str(random.choice(SITE_LOCATIONS))}, "
        f"{sql_str(random.choice(PROJECT_TYPES))}, 'ACTIVE', {n_lines}, {sql_ts(created_at)});"
    )

    # role assignments: TEST_USER_EMAIL gets exactly one real per-project
    # assignment per non-admin role, spread across the first 3 projects —
    # NOT a blanket 'Admin' row on every project. Admin access never needs
    # an explicit row here (getEffectiveRole's fallback rule grants it to
    # anyone eligible for Admin with no row at all — see roles.ts), so a
    # normal, full-group-membership session still sees every project
    # regardless. What DID need real rows: a Databricks RBAC "assume role"
    # session narrowed to exactly one non-admin role (see ARCHITECTURE.md's
    # "assume role" investigation) has nothing to see without one — a
    # blanket 'Admin' row doesn't help a session narrowed to just
    # 'Estimator', since getEffectiveRole only honors an assignment whose
    # role is also currently eligible. Projects 4-5 deliberately get no
    # TEST_USER_EMAIL row at all: a narrowed session correctly sees nothing
    # there (no assignment = no access), which is the whole point of the
    # eligibility/assignment reconciliation rule, not a gap to fill.
    test_user_role_by_index = {1: "Estimator", 2: "Lead Engineer", 3: "Design Lead"}
    if i in test_user_role_by_index:
        roles_out.append(
            f"INSERT INTO user_project_role (user_email, project_id, role, assigned_by) VALUES "
            f"({sql_str(TEST_USER_EMAIL)}, {sql_str(project_id)}, "
            f"{sql_str(test_user_role_by_index[i])}, 'system');"
        )
    # plus one synthetic Estimator / Lead Engineer / Design Lead per project
    # so the audit trail has believable, distinct actors.
    for role in ["Estimator", "Lead Engineer", "Design Lead"]:
        roles_out.append(
            f"INSERT INTO user_project_role (user_email, project_id, role, assigned_by) VALUES "
            f"({sql_str(make_actor_email(role, project_id))}, {sql_str(project_id)}, {sql_str(role)}, 'system');"
        )

    for line_seq in range(1, n_lines + 1):
        line_id = f"{project_id}-L{line_seq:04d}"
        material = weighted_choice(MATERIALS)
        nominal_size_in = weighted_choice(NPS_SIZES)
        is_non_metallic = material in NON_METALLIC
        current_stage = random.choices([1, 2, 3, 4, 5, 6], weights=STAGE_WEIGHTS, k=1)[0]
        is_complete = current_stage == 6

        line_class = (
            f"Class {'150' if nominal_size_in < 8 else random.choice(['300', '600'])} "
            f"{'NM' if is_non_metallic else ('SS' if 'Stainless' in material else ('CM' if 'Chrome' in material else 'CS'))}"
        )
        design_pressure = round(np.random.uniform(75, 150) if line_class.split()[1] == "150" else np.random.uniform(200, 600), 1)
        design_temp = round(np.random.uniform(80, 650), 1)
        insulation_type = weighted_choice(INSULATION_TYPES)
        heat_tracing = random.random() < 0.15
        estimated_length = float(np.round(np.random.lognormal(4.0, 0.5), 1))
        line_created_at = created_at + timedelta(days=random.randint(0, 10))

        lines_out.append(
            "INSERT INTO lines (line_id, project_id, line_no, service, origin_tag, destination_tag, "
            "area_package_zone, line_class_spec, nominal_size_in, schedule_thickness, material, "
            "design_pressure_psig, design_temperature_f, operating_pressure_psig, operating_temperature_f, "
            "corrosion_allowance_in, insulation_type, insulation_thickness_in, heat_tracing_flag, "
            "heat_tracing_spec, end_connections, flange_rating, pid_reference, isometric_drawing_no, "
            "estimated_centerline_length_ft, special_notes, current_stage, is_complete, created_by, created_at, updated_at) "
            "VALUES (" + ", ".join([
                sql_str(line_id), sql_str(project_id), sql_str(f"L-{line_seq:03d}"), sql_str(random.choice(SERVICES)),
                sql_str(f"{random.choice(['P','V','T','E'])}-{random.randint(100,499)}"),
                sql_str(f"{random.choice(['P','V','T','E'])}-{random.randint(500,899)}"),
                sql_str(random.choice(AREAS)), sql_str(line_class), sql_num(nominal_size_in),
                sql_str(random.choice(SCHEDULES)), sql_str(material), sql_num(design_pressure), sql_num(design_temp),
                sql_num(round(design_pressure * np.random.uniform(0.6, 0.9), 1)),
                sql_num(round(design_temp * np.random.uniform(0.6, 0.9), 1)),
                sql_num(round(np.random.uniform(0.03, 0.125), 3)), sql_str(insulation_type),
                sql_num(round(np.random.uniform(1, 4), 1)) if insulation_type else "NULL",
                sql_bool(heat_tracing), sql_str("Self-regulating, 10W/ft") if heat_tracing else "NULL",
                sql_str(random.choice(END_CONNECTIONS)), sql_str(None if is_non_metallic else random.choice(FLANGE_RATINGS)),
                sql_str(f"P&ID-{project_id[-3:]}-{(line_seq % 12) + 1:02d}"),
                sql_str(f"ISO-{project_id[-3:]}-{line_seq:04d}"), sql_num(estimated_length), "NULL",
                str(current_stage), sql_bool(is_complete), sql_str(make_actor_email("Estimator", project_id)),
                sql_ts(line_created_at), sql_ts(line_created_at),  # updated_at fixed below once known
            ]) + ");"
        )

        t = line_created_at
        stage_ts = {}
        for stage in STAGES:
            if stage["n"] > current_stage:
                break
            stage_n = stage["n"]
            duration_hours = float(np.random.lognormal(np.log(stage["hours"]), 0.35))
            entry_ts = t
            exit_ts = entry_ts + timedelta(hours=duration_hours)
            stage_ts[stage_n] = exit_ts
            event_id = f"{line_id}-EVT{stage_n}"
            events_out.append(
                f"INSERT INTO stage_events (event_id, line_id, project_id, stage_number, stage_name, "
                f"event_type, actor_email, actor_role, event_timestamp) VALUES ("
                f"{sql_str(event_id)}, {sql_str(line_id)}, {sql_str(project_id)}, "
                f"{stage_n}, {sql_str(stage['name'])}, {sql_str(stage['event_type'])}, "
                f"{sql_str(make_actor_email(stage['role'], project_id))}, {sql_str(stage['role'])}, {sql_ts(exit_ts)});"
            )
            t = exit_ts

        # fix the line's updated_at to the latest event actually reached
        last_ts = stage_ts[current_stage]
        lines_out[-1] = lines_out[-1].rsplit(",", 1)[0] + f", {sql_ts(last_ts)});"

        variance_pct = round(float(np.clip(np.random.normal(4, 8), -20, 40)), 1)
        actual_length = round(estimated_length * (1 + variance_pct / 100), 1)

        for true_up_type, perform_stage, confirm_stage in [("PRELIMINARY", 3, 4), ("FINAL", 5, 6)]:
            if current_stage < perform_stage:
                continue
            true_up_id = f"{line_id}-TU-{true_up_type[:3]}"
            n_fittings_est = max(1, int(estimated_length / 20) + random.randint(0, 2))
            n_fittings_act = max(1, n_fittings_est + int(round(n_fittings_est * variance_pct / 100)))
            n_valves_est = random.randint(1, 4)
            n_supports_est = max(1, int(estimated_length / 15))
            n_supports_act = max(1, n_supports_est + int(round(n_supports_est * variance_pct / 100)))
            mto_weight_est = round(estimated_length * 10, 1)  # coarse — full weight model lives in historical generator
            mto_weight_act = round(actual_length * 10, 1)
            mto_cost_est = round(mto_weight_est * 3.0, 2)
            mto_cost_act = round(mto_weight_act * 3.0, 2)

            confirmed = current_stage >= confirm_stage
            fitting_detail = [{"type": t_, "size": nominal_size_in,
                                "estimated_qty": max(0, n_fittings_est // 3), "actual_qty": max(0, n_fittings_act // 3)}
                               for t_ in FITTING_TYPES]
            valve_detail = [{"type": random.choice(VALVE_TYPES), "size": nominal_size_in, "estimated_qty": 1, "actual_qty": 1}
                            for _ in range(n_valves_est)]
            support_detail = [{"type": "Hanger", "size": nominal_size_in,
                                "estimated_qty": n_supports_est, "actual_qty": n_supports_act}]

            trueups_out.append(
                "INSERT INTO true_up_records (true_up_id, line_id, project_id, true_up_type, "
                "estimated_centerline_length_ft, actual_centerline_length_ft, length_variance_pct, "
                "fitting_detail, valve_detail, support_detail, weld_count_estimated, weld_count_actual, "
                "flange_count_estimated, flange_count_actual, mto_weight_estimated_lb, mto_weight_actual_lb, "
                "mto_cost_estimated_usd, mto_cost_actual_usd, isometric_drawing_ref, pid_ref, "
                "performed_by, performed_at, confirmed_by, confirmed_at) VALUES (" + ", ".join([
                    sql_str(true_up_id), sql_str(line_id), sql_str(project_id), sql_str(true_up_type),
                    sql_num(estimated_length), sql_num(actual_length), sql_num(variance_pct),
                    sql_json(fitting_detail), sql_json(valve_detail), sql_json(support_detail),
                    str(n_fittings_est * 2), str(n_fittings_act * 2), str(n_valves_est * 2),
                    str(n_valves_est * 2), sql_num(mto_weight_est), sql_num(mto_weight_act),
                    sql_num(mto_cost_est), sql_num(mto_cost_act),
                    sql_str(f"ISO-{project_id[-3:]}-{line_seq:04d}"), sql_str(f"P&ID-{project_id[-3:]}-{(line_seq % 12) + 1:02d}"),
                    sql_str(make_actor_email("Design Lead", project_id)), sql_ts(stage_ts[perform_stage]),
                    sql_str(make_actor_email("Lead Engineer", project_id)) if confirmed else "NULL",
                    sql_ts(stage_ts.get(confirm_stage)) if confirmed else "NULL",
                ]) + ");"
            )

            if random.random() < 0.35:
                changes_out.append(
                    f"INSERT INTO change_log (change_id, true_up_id, line_id, reason_category, reason_text, "
                    f"changed_by, changed_at) VALUES ({sql_str(true_up_id + '-CH1')}, {sql_str(true_up_id)}, "
                    f"{sql_str(line_id)}, {sql_str(weighted_choice(REASON_CATEGORIES))}, "
                    f"'See true-up notes for detail.', {sql_str(make_actor_email('Design Lead', project_id))}, "
                    f"{sql_ts(stage_ts[perform_stage])});"
                )

print("-- Frozen live-data seed (5 ACTIVE projects). Generated by generate_live_seed.py, seed=777.")
print("-- Applied once at initial setup; reset_poc replays this file verbatim (never regenerated with a new seed).")
print("BEGIN;")
print("\n".join(projects_out))
print("\n".join(roles_out))
print("\n".join(lines_out))
print("\n".join(events_out))
print("\n".join(trueups_out))
print("\n".join(changes_out))
print("COMMIT;")
