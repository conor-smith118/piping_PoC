# Databricks notebook source
# MAGIC %md
# MAGIC # Simulate new activity on the 5 live projects
# MAGIC
# MAGIC Connects to Lakebase **the same way the app does conceptually** — an OAuth
# MAGIC database credential (`w.postgres.generate_database_credential`) over
# MAGIC psycopg2 — and writes new stage-1 lines plus stage advances for a sample of
# MAGIC existing in-flight lines, using the exact same write shape as each of the
# MAGIC app's 6 stage-action routes (`ARCHITECTURE.md`'s "Mapping the 6 stage
# MAGIC actions to exact writes" table). Deliberately goes through Lakebase, not
# MAGIC straight to Delta, so every run exercises the real CDC path end to end —
# MAGIC that's the point of this job, not just data volume.
# MAGIC
# MAGIC Manual-trigger only (no `schedule`/`trigger` block on the job) so a demo
# MAGIC controls exactly when new activity appears. Chained with
# MAGIC `refresh_silver_gold` + `ml_batch_inference` via `run_job_task` in
# MAGIC `resources/jobs.simulate_new_data.yml`, so a single job run leaves the
# MAGIC dashboard/Genie/ML surfaces already caught up — no separate manual step.

# COMMAND ----------

# MAGIC %pip install --quiet psycopg2-binary

# COMMAND ----------

dbutils.library.restartPython()

# COMMAND ----------

dbutils.widgets.text("lakebase_project_id", "burns-piping-poc", "Lakebase project")
dbutils.widgets.text("lakebase_branch_id", "production", "Lakebase branch")
dbutils.widgets.text("lakebase_endpoint_id", "primary", "Lakebase endpoint")

PROJECT_ID = dbutils.widgets.get("lakebase_project_id")
BRANCH_ID = dbutils.widgets.get("lakebase_branch_id")
ENDPOINT_ID = dbutils.widgets.get("lakebase_endpoint_id")
ENDPOINT_PATH = f"projects/{PROJECT_ID}/branches/{BRANCH_ID}/endpoints/{ENDPOINT_ID}"

# COMMAND ----------

import random
import json
import uuid
from datetime import datetime, timezone

import psycopg2
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()

# Direct-connection pattern (databricks-lakebase skill, "Pattern 1: Direct
# Connection (Scripts/Notebooks)") — a fresh token for a one-shot batch job,
# no refresh loop needed (well within the 1-hour token lifetime). Runs as
# whichever identity owns/triggers this job (no run_as override configured,
# same as the other jobs in this repo) — on this reference deployment that's
# whoever ran `databricks bundle deploy` (the identity that created the
# Lakebase project), who therefore already owns the `public` schema, so no
# additional GRANT is needed here (unlike the app's service principal, which
# needed src/sql/lakebase/01_grant_app_access.sql). If a different identity
# deploys the bundle than the one that created the Lakebase project, grant
# that deploying identity the same access 01_grant_app_access.sql grants the
# app's SP (see SETUP.md).
endpoint = w.postgres.get_endpoint(name=ENDPOINT_PATH)
host = endpoint.status.hosts.host
token = w.postgres.generate_database_credential(endpoint=endpoint.name).token
username = w.current_user.me().user_name

conn = psycopg2.connect(host=host, port=5432, dbname="databricks_postgres", user=username, password=token, sslmode="require")
conn.autocommit = False
cur = conn.cursor()
print(f"Connected to {host} as {username}.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Reference data — same shape as generate_live_seed.py (duplicated
# MAGIC intentionally: this job runs standalone in the workspace and doesn't
# MAGIC import from that local-only generator script).

# COMMAND ----------

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
AREAS = ["Unit 100", "Unit 200", "Unit 300", "Tank Farm", "Pipe Rack A", "Pipe Rack B", "Utilities"]
REASON_CATEGORIES = [("DESIGN_CHANGE", 0.40), ("CONSTRUCTABILITY", 0.30),
                      ("ESTIMATING_ERROR", 0.20), ("OTHER", 0.10)]

STAGE_META = {
    2: {"event_type": "INITIAL_ENGINEER_CONFIRMATION", "name": "Initial Engineer Confirmation", "role": "Lead Engineer"},
    3: {"event_type": "PRELIM_TRUE_UP_COMPLETE", "name": "Preliminary True-Up Complete", "role": "Design Lead"},
    4: {"event_type": "ENGINEER_PRELIM_TRUE_UP_CONFIRMATION", "name": "Engineer Prelim True-Up Confirmation", "role": "Lead Engineer"},
    5: {"event_type": "FINAL_TRUE_UP_COMPLETE", "name": "Final True-Up Complete", "role": "Design Lead"},
    6: {"event_type": "ENGINEER_FINAL_CONFIRMATION", "name": "Engineer Final Confirmation", "role": "Lead Engineer"},
}


def weighted_choice(pairs):
    values, weights = zip(*pairs)
    return random.choices(values, weights=weights, k=1)[0]


def actor_email(role, project_id):
    return f"{role.lower().replace(' ', '_')}.{project_id.lower()}@example-epc.com"


def now():
    return datetime.now(timezone.utc)


def new_id(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:10]}"

# COMMAND ----------

# MAGIC %md
# MAGIC ## Pull current live state

# COMMAND ----------

cur.execute("""
    SELECT line_id, project_id, current_stage, is_complete, estimated_centerline_length_ft, nominal_size_in
    FROM lines
    WHERE NOT is_complete
""")
in_flight = cur.fetchall()
cur.execute("SELECT project_id FROM projects")
all_project_ids = [r[0] for r in cur.fetchall()]
print(f"In-flight lines: {len(in_flight)} across {len(all_project_ids)} projects.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Advance a random sample of in-flight lines by exactly one stage
# MAGIC Same write shape as the app's stage-action routes — see
# MAGIC ARCHITECTURE.md's "Mapping the 6 stage actions to exact writes" table.

# COMMAND ----------

random.seed()  # real randomness for each run — this job is meant to vary demo-to-demo

SAMPLE_SIZE = min(10, max(1, len(in_flight) // 4))
sample = random.sample(in_flight, SAMPLE_SIZE) if in_flight else []
advanced_counts = {}

for line_id, project_id, current_stage, _is_complete, est_len, nominal_size in sample:
    to_stage = current_stage + 1
    meta = STAGE_META[to_stage]
    event_id = f"{line_id}-EVT{to_stage}-SIM{uuid.uuid4().hex[:6]}"
    event_ts = now()

    if to_stage in (3, 5):
        true_up_type = "PRELIMINARY" if to_stage == 3 else "FINAL"
        est_len = float(est_len) if est_len is not None else 50.0
        variance_pct = round(max(-20.0, min(40.0, random.gauss(4, 8))), 1)
        actual_len = round(est_len * (1 + variance_pct / 100), 1)
        n_fit_est = max(1, int(est_len / 20) + random.randint(0, 2))
        n_fit_act = max(1, n_fit_est + int(round(n_fit_est * variance_pct / 100)))
        n_sup_est = max(1, int(est_len / 15))
        n_sup_act = max(1, n_sup_est + int(round(n_sup_est * variance_pct / 100)))
        mto_weight_est = round(est_len * 10, 1)
        mto_weight_act = round(actual_len * 10, 1)
        fitting_detail = json.dumps([
            {"type": t, "size": float(nominal_size or 2), "estimated_qty": max(0, n_fit_est // 3), "actual_qty": max(0, n_fit_act // 3)}
            for t in FITTING_TYPES
        ])
        valve_detail = json.dumps([
            {"type": random.choice(VALVE_TYPES), "size": float(nominal_size or 2), "estimated_qty": 1, "actual_qty": 1}
            for _ in range(random.randint(1, 4))
        ])
        support_detail = json.dumps([
            {"type": "Hanger", "size": float(nominal_size or 2), "estimated_qty": n_sup_est, "actual_qty": n_sup_act}
        ])
        true_up_id = new_id(f"{line_id}-TU-{true_up_type[:3]}")
        cur.execute(
            """
            INSERT INTO true_up_records (
                true_up_id, line_id, project_id, true_up_type,
                estimated_centerline_length_ft, actual_centerline_length_ft, length_variance_pct,
                fitting_detail, valve_detail, support_detail,
                weld_count_estimated, weld_count_actual, flange_count_estimated, flange_count_actual,
                mto_weight_estimated_lb, mto_weight_actual_lb, mto_cost_estimated_usd, mto_cost_actual_usd,
                performed_by, performed_at
            ) VALUES (%s,%s,%s,%s, %s,%s,%s, %s,%s,%s, %s,%s,%s,%s, %s,%s,%s,%s, %s,%s)
            """,
            (
                true_up_id, line_id, project_id, true_up_type,
                est_len, actual_len, variance_pct,
                fitting_detail, valve_detail, support_detail,
                n_fit_est * 2, n_fit_act * 2, 2, 2,
                mto_weight_est, mto_weight_act, round(mto_weight_est * 3.0, 2), round(mto_weight_act * 3.0, 2),
                actor_email("Design Lead", project_id), event_ts,
            ),
        )
        if random.random() < 0.35:
            cur.execute(
                """
                INSERT INTO change_log (change_id, true_up_id, line_id, reason_category, reason_text, changed_by, changed_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                """,
                (new_id(f"{true_up_id}-CH"), true_up_id, line_id, weighted_choice(REASON_CATEGORIES),
                 "Simulated true-up reconciliation note.", actor_email("Design Lead", project_id), event_ts),
            )
    elif to_stage in (4, 6):
        true_up_type = "PRELIMINARY" if to_stage == 4 else "FINAL"
        cur.execute(
            """
            UPDATE true_up_records SET confirmed_by = %s, confirmed_at = %s
            WHERE line_id = %s AND true_up_type = %s AND confirmed_by IS NULL
            """,
            (actor_email("Lead Engineer", project_id), event_ts, line_id, true_up_type),
        )
        if to_stage == 6:
            cur.execute("UPDATE lines SET is_complete = true WHERE line_id = %s", (line_id,))

    cur.execute(
        """
        INSERT INTO stage_events (event_id, line_id, project_id, stage_number, stage_name, event_type, actor_email, actor_role, event_timestamp, notes)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        (event_id, line_id, project_id, to_stage, meta["name"], meta["event_type"],
         actor_email(meta["role"], project_id), meta["role"], event_ts, "Simulated by simulate_new_data."),
    )
    cur.execute("UPDATE lines SET current_stage = %s, updated_at = %s WHERE line_id = %s", (to_stage, event_ts, line_id))

    advanced_counts[to_stage] = advanced_counts.get(to_stage, 0) + 1

print(f"Advanced {len(sample)} lines: " + ", ".join(f"-> stage {k}: {v}" for k, v in sorted(advanced_counts.items())) or "none")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Insert a handful of new stage-1 lines (fresh Estimator entries)

# COMMAND ----------

N_NEW_LINES = random.randint(3, 8)
new_lines_by_project = {}

for _ in range(N_NEW_LINES):
    project_id = random.choice(all_project_ids)
    cur.execute("SELECT COUNT(*) FROM lines WHERE project_id = %s", (project_id,))
    line_seq = cur.fetchone()[0] + 1
    line_id = f"{project_id}-L{line_seq:04d}-SIM{uuid.uuid4().hex[:4]}"
    material = weighted_choice(MATERIALS)
    is_non_metallic = material in NON_METALLIC
    nominal_size_in = weighted_choice(NPS_SIZES)
    insulation_type = weighted_choice(INSULATION_TYPES)
    heat_tracing = random.random() < 0.15
    estimated_length = round(random.lognormvariate(4.0, 0.5), 1)
    line_class = (
        f"Class {'150' if nominal_size_in < 8 else random.choice(['300', '600'])} "
        f"{'NM' if is_non_metallic else ('SS' if 'Stainless' in material else ('CM' if 'Chrome' in material else 'CS'))}"
    )
    design_pressure = round(random.uniform(75, 150) if "150" in line_class else random.uniform(200, 600), 1)
    design_temp = round(random.uniform(80, 650), 1)
    created_at = now()

    cur.execute(
        """
        INSERT INTO lines (
            line_id, project_id, line_no, service, origin_tag, destination_tag, area_package_zone,
            line_class_spec, nominal_size_in, schedule_thickness, material,
            design_pressure_psig, design_temperature_f, operating_pressure_psig, operating_temperature_f,
            corrosion_allowance_in, insulation_type, insulation_thickness_in, heat_tracing_flag, heat_tracing_spec,
            end_connections, flange_rating, pid_reference, isometric_drawing_no,
            estimated_centerline_length_ft, current_stage, is_complete, created_by, created_at, updated_at
        ) VALUES (%s,%s,%s,%s,%s,%s,%s, %s,%s,%s,%s, %s,%s,%s,%s, %s,%s,%s,%s,%s, %s,%s,%s,%s, %s,%s,%s,%s,%s,%s)
        """,
        (
            line_id, project_id, f"L-{line_seq:03d}", random.choice(SERVICES),
            f"{random.choice(['P','V','T','E'])}-{random.randint(100,499)}",
            f"{random.choice(['P','V','T','E'])}-{random.randint(500,899)}",
            random.choice(AREAS), line_class, nominal_size_in, random.choice(SCHEDULES), material,
            design_pressure, design_temp, round(design_pressure * random.uniform(0.6, 0.9), 1),
            round(design_temp * random.uniform(0.6, 0.9), 1), round(random.uniform(0.03, 0.125), 3),
            insulation_type, round(random.uniform(1, 4), 1) if insulation_type else None,
            heat_tracing, "Self-regulating, 10W/ft" if heat_tracing else None,
            random.choice(END_CONNECTIONS), None if is_non_metallic else random.choice(FLANGE_RATINGS),
            f"P&ID-{project_id[-3:]}-{(line_seq % 12) + 1:02d}", f"ISO-{project_id[-3:]}-{line_seq:04d}",
            estimated_length, 1, False, actor_email("Estimator", project_id), created_at, created_at,
        ),
    )
    cur.execute(
        """
        INSERT INTO stage_events (event_id, line_id, project_id, stage_number, stage_name, event_type, actor_email, actor_role, event_timestamp, notes)
        VALUES (%s,%s,%s,1,'Initial Data Entry','INITIAL_DATA_ENTRY',%s,'Estimator',%s,'Simulated by simulate_new_data.')
        """,
        (f"{line_id}-EVT1", line_id, project_id, actor_email("Estimator", project_id), created_at),
    )
    new_lines_by_project[project_id] = new_lines_by_project.get(project_id, 0) + 1

print(f"Inserted {N_NEW_LINES} new stage-1 lines: {new_lines_by_project}")

# COMMAND ----------

conn.commit()
cur.close()
conn.close()
print("Committed. Lakehouse Sync will pick up these changes on its own schedule; "
      "run/wait for refresh_silver_gold (chained automatically by this job) to see them in Delta.")

summary = (
    f"simulate_new_data: advanced {len(sample)} in-flight lines "
    f"({', '.join(f'stage {k}: {v}' for k, v in sorted(advanced_counts.items())) or 'none'}); "
    f"inserted {N_NEW_LINES} new stage-1 lines across {len(new_lines_by_project)} projects "
    f"({new_lines_by_project}). Committed straight to Lakebase Postgres (same path the app itself "
    f"writes through) — real CDC propagation, not a simulated/mocked write."
)
print(summary)
dbutils.notebook.exit(summary)
