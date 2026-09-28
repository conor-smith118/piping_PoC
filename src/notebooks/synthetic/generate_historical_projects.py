# Databricks notebook source
# MAGIC %md
# MAGIC # Generate synthetic historical (closed) piping projects
# MAGIC
# MAGIC Writes 20-30 fully-completed historical projects — with realistic S3D/line-list
# MAGIC fields, a full 6-stage lifecycle per line, and true-up reconciliation records —
# MAGIC into `historical_projects` / `historical_lines` / `historical_stage_history` /
# MAGIC `historical_true_up_records` / `historical_change_log`. This is the ONLY job that
# MAGIC writes to these tables; `simulate_new_data` and `reset_poc` never touch them.
# MAGIC
# MAGIC **Story built into the data (this is what the ML model should learn and the
# MAGIC dashboard should be able to surface):** large-bore (>=8") lines in exotic
# MAGIC materials (stainless, chrome-moly) take meaningfully longer at the two true-up
# MAGIC stages (routing reconciliation) AND have wider estimate-vs-actual variance. A
# MAGIC further ~8% "problem line" subset (skewed toward that same large/exotic
# MAGIC population) blows both duration and variance out further — a realistic
# MAGIC "this one was a nightmare" tail.
# MAGIC
# MAGIC Scale (~8-10K total rows across 5 tables) is well within the range the
# MAGIC `databricks-synthetic-data-gen` skill sanctions for local-Python generation
# MAGIC (<10K rows) rather than distributed Spark generation — this keeps the
# MAGIC cross-table coherence (project -> lines -> stage timestamps -> true-ups ->
# MAGIC change log, all derived from each other) simple to read and reason about.
# MAGIC Spark is used only for the final write to Delta.

# COMMAND ----------

dbutils.widgets.text("catalog", "css_fevm", "Catalog")
dbutils.widgets.text("schema", "burns_piping_poc", "Schema")
dbutils.widgets.text("num_projects", "25", "Number of historical projects")
dbutils.widgets.text("seed", "42", "Random seed")

CATALOG = dbutils.widgets.get("catalog")
SCHEMA = dbutils.widgets.get("schema")
N_PROJECTS = int(dbutils.widgets.get("num_projects"))
SEED = int(dbutils.widgets.get("seed"))

# COMMAND ----------

import random
import numpy as np
from datetime import datetime, timedelta

random.seed(SEED)
np.random.seed(SEED)

# ---------------------------------------------------------------------------
# Master data pools — fictional but EPC-flavored (no real company names)
# ---------------------------------------------------------------------------
CLIENTS = [
    "Meridian Energy Partners", "Cascade Petrochemical", "Prairie Power & Light",
    "Gulfstream Refining Co.", "Highland Gas Processing", "Bayview LNG",
    "Summit Ethylene Corp", "Redrock Water Authority", "Northfield Industrial Gases",
    "Trailhead Midstream", "Ashland Chemical Works", "Ironbridge Utilities",
]
SITE_LOCATIONS = [
    "Beaumont, TX", "Baton Rouge, LA", "Corpus Christi, TX", "Lake Charles, LA",
    "Tulsa, OK", "Kansas City, MO", "Freeport, TX", "Port Arthur, TX",
    "Deer Park, TX", "Billings, MT", "Wood River, IL", "Convent, LA",
]
PROJECT_TYPES = [
    "Refinery Expansion", "LNG Terminal", "Gas Processing Plant",
    "Petrochemical Unit", "Power Plant Piping", "Water Treatment Facility",
    "Ethylene Plant", "Pipeline Interconnect",
]
SERVICES = [
    "Fuel Gas", "Cooling Water", "Process Water", "Steam", "Condensate",
    "Crude Oil", "Produced Water", "Instrument Air", "Nitrogen", "Flare Gas",
    "Natural Gas Liquids", "Boiler Feedwater", "Sour Water", "Amine",
]
AREAS = ["Unit 100", "Unit 200", "Unit 300", "Tank Farm", "Pipe Rack A", "Pipe Rack B", "Utilities"]

# (material, weight) — skewed toward carbon steel
MATERIALS = [
    ("Carbon Steel", 0.55), ("Stainless 304", 0.15), ("Stainless 316", 0.15),
    ("Chrome Moly (P11)", 0.05), ("Chrome Moly (P22)", 0.03),
    ("HDPE", 0.04), ("PVC", 0.03),
]
EXOTIC_MATERIALS = {"Stainless 316", "Chrome Moly (P11)", "Chrome Moly (P22)"}
NON_METALLIC = {"HDPE", "PVC"}

# (NPS inches, weight) — skewed toward small bore
NPS_SIZES = [
    (0.5, .05), (0.75, .05), (1, .08), (1.5, .10), (2, .12), (3, .12),
    (4, .12), (6, .10), (8, .08), (10, .06), (12, .05), (16, .03), (20, .02), (24, .02),
]
LARGE_BORE_THRESHOLD = 8

SCHEDULES = ["SCH 40", "SCH 80", "SCH 160", "XS", "STD", "XXS"]
END_CONNECTIONS = ["Flanged", "Butt-Weld", "Threaded", "Socket-Weld"]
FLANGE_RATINGS = ["150#", "300#", "600#", "900#"]
INSULATION_TYPES = [(None, 0.55), ("Mineral Wool", 0.20), ("Calcium Silicate", 0.15), ("Foam Glass", 0.10)]

# rough SCH-40 CS weight (lb/ft) by NPS — illustrative, not an engineering reference
WEIGHT_PER_FT = {0.5: 0.85, 0.75: 1.13, 1: 1.68, 1.5: 2.72, 2: 3.65, 3: 7.58, 4: 10.79,
                 6: 18.97, 8: 28.55, 10: 40.48, 12: 53.52, 16: 82.77, 20: 104.13, 24: 125.49}
MATERIAL_WEIGHT_FACTOR = {"Carbon Steel": 1.0, "Stainless 304": 1.02, "Stainless 316": 1.02,
                          "Chrome Moly (P11)": 1.01, "Chrome Moly (P22)": 1.01, "HDPE": 0.30, "PVC": 0.35}
COST_PER_LB = {"Carbon Steel": 2.50, "Stainless 304": 8.00, "Stainless 316": 9.00,
               "Chrome Moly (P11)": 6.50, "Chrome Moly (P22)": 7.00, "HDPE": 3.00, "PVC": 2.00}

FITTING_TYPES = ["90 Elbow", "45 Elbow", "Tee", "Reducer", "Cap"]
VALVE_TYPES = ["Gate", "Globe", "Check", "Ball", "Control"]

STAGES = [
    {"stage_number": 1, "stage_name": "Initial Data Entry", "event_type": "INITIAL_DATA_ENTRY",
     "role": "Estimator", "base_median_hours": 6},
    {"stage_number": 2, "stage_name": "Initial Engineer Confirmation", "event_type": "INITIAL_ENGINEER_CONFIRMATION",
     "role": "Lead Engineer", "base_median_hours": 10},
    {"stage_number": 3, "stage_name": "Preliminary True-Up Complete", "event_type": "PRELIM_TRUE_UP_COMPLETE",
     "role": "Design Lead", "base_median_hours": 48},
    {"stage_number": 4, "stage_name": "Engineer Prelim True-Up Confirmation", "event_type": "ENGINEER_PRELIM_TRUE_UP_CONFIRMATION",
     "role": "Lead Engineer", "base_median_hours": 14},
    {"stage_number": 5, "stage_name": "Final True-Up Complete", "event_type": "FINAL_TRUE_UP_COMPLETE",
     "role": "Design Lead", "base_median_hours": 60},
    {"stage_number": 6, "stage_name": "Engineer Final Confirmation", "event_type": "ENGINEER_FINAL_CONFIRMATION",
     "role": "Lead Engineer", "base_median_hours": 12},
]
TRUE_UP_STAGES = {3, 5}  # stages where complexity/outlier multipliers apply

REASON_CATEGORIES = [
    ("DESIGN_CHANGE", 0.40), ("CONSTRUCTABILITY", 0.30),
    ("ESTIMATING_ERROR", 0.20), ("OTHER", 0.10),
]


def weighted_choice(pairs):
    values, weights = zip(*pairs)
    return random.choices(values, weights=weights, k=1)[0]


def make_actor_email(role, project_id):
    slug = role.lower().replace(" ", "_")
    return f"{slug}.{project_id.lower()}@example-epc.com"

# COMMAND ----------

# ---------------------------------------------------------------------------
# 1. historical_projects
# ---------------------------------------------------------------------------
project_rows = []
for i in range(1, N_PROJECTS + 1):
    project_id = f"BM-H-{i:03d}"
    created_at = datetime(2023, 1, 1) + timedelta(days=random.randint(0, 620))
    target_line_count = int(np.clip(np.random.triangular(20, 32, 60), 20, 60))
    project_rows.append({
        "project_id": project_id,
        "project_name": f"{random.choice(PROJECT_TYPES)} - {random.choice(AREAS)}",
        "client_name": random.choice(CLIENTS),
        "site_location": random.choice(SITE_LOCATIONS),
        "project_type": random.choice(PROJECT_TYPES),
        "status": "CLOSED",
        "target_line_count": target_line_count,
        "created_at": created_at,
        # closed_at filled in once we know each line's stage-6 exit timestamp
    })

# COMMAND ----------

# ---------------------------------------------------------------------------
# 2. historical_lines + historical_stage_history (generated together: a
#    line's stage timestamps are a direct function of its own attributes)
# ---------------------------------------------------------------------------
line_rows = []
stage_event_rows = []
true_up_rows = []
change_log_rows = []

for proj in project_rows:
    project_id = proj["project_id"]
    n_lines = proj["target_line_count"]
    project_closed_candidates = []

    for line_seq in range(1, n_lines + 1):
        line_id = f"{project_id}-L{line_seq:04d}"
        material = weighted_choice(MATERIALS)
        nominal_size_in = weighted_choice(NPS_SIZES)
        is_large_bore = nominal_size_in >= LARGE_BORE_THRESHOLD
        is_exotic = material in EXOTIC_MATERIALS
        is_non_metallic = material in NON_METALLIC

        # "problem line" tail — skewed toward large-bore + exotic
        problem_prob = 0.05 + (0.25 if (is_large_bore and is_exotic) else 0.0)
        is_problem_line = random.random() < problem_prob

        complexity_mult = 1.0 + (0.5 if is_large_bore else 0.0) + (0.4 if is_exotic else 0.0)

        line_class = (
            f"Class {'150' if not is_large_bore else random.choice(['300','600'])} "
            f"{'NM' if is_non_metallic else ('SS' if 'Stainless' in material else ('CM' if 'Chrome' in material else 'CS'))}"
        )
        design_pressure = round(np.random.uniform(75, 150) if line_class.split()[1] == "150"
                                 else np.random.uniform(200, 600), 1)
        design_temp = round(np.random.uniform(80, 650), 1)
        insulation_type = weighted_choice(INSULATION_TYPES)
        heat_tracing = random.random() < 0.15
        estimated_length = float(np.round(np.random.lognormal(4.0, 0.5), 1))  # median ~55 ft

        line_created_at = proj["created_at"] + timedelta(days=random.randint(0, 10))

        line_rows.append({
            "line_id": line_id, "project_id": project_id, "line_no": f"L-{line_seq:03d}",
            "service": random.choice(SERVICES),
            "origin_tag": f"{random.choice(['P','V','T','E'])}-{random.randint(100,499)}",
            "destination_tag": f"{random.choice(['P','V','T','E'])}-{random.randint(500,899)}",
            "area_package_zone": random.choice(AREAS),
            "line_class_spec": line_class,
            "nominal_size_in": float(nominal_size_in),
            "schedule_thickness": random.choice(SCHEDULES),
            "material": material,
            "design_pressure_psig": design_pressure,
            "design_temperature_f": design_temp,
            "operating_pressure_psig": round(design_pressure * np.random.uniform(0.6, 0.9), 1),
            "operating_temperature_f": round(design_temp * np.random.uniform(0.6, 0.9), 1),
            "corrosion_allowance_in": round(np.random.uniform(0.03, 0.125), 3),
            "insulation_type": insulation_type,
            "insulation_thickness_in": (round(np.random.uniform(1, 4), 1) if insulation_type else None),
            "heat_tracing_flag": heat_tracing,
            "heat_tracing_spec": ("Self-regulating, 10W/ft" if heat_tracing else None),
            "end_connections": random.choice(END_CONNECTIONS),
            "flange_rating": (None if is_non_metallic else random.choice(FLANGE_RATINGS)),
            "pid_reference": f"P&ID-{proj['project_id'][-3:]}-{(line_seq % 12) + 1:02d}",
            "isometric_drawing_no": f"ISO-{proj['project_id'][-3:]}-{line_seq:04d}",
            "estimated_centerline_length_ft": estimated_length,
            "special_notes": ("Problem line — see change log" if is_problem_line else None),
            "current_stage": 6,
            "is_complete": True,
            "created_by": make_actor_email("Estimator", project_id),
            "created_at": line_created_at,
            # updated_at filled in once stage 6 timestamp is known
        })

        # --- stage_history: cumulative walk through the 6 stages ---
        t = line_created_at
        stage_exit_ts_by_stage = {}
        for stage in STAGES:
            mult = 1.0
            if stage["stage_number"] in TRUE_UP_STAGES:
                mult *= complexity_mult
                if is_problem_line:
                    mult *= 2.5
            # log-normal duration: exp(normal) has median = exp(mu)
            mu = np.log(stage["base_median_hours"] * mult)
            duration_hours = float(np.random.lognormal(mu, 0.35))
            entry_ts = t
            exit_ts = entry_ts + timedelta(hours=duration_hours)
            stage_exit_ts_by_stage[stage["stage_number"]] = exit_ts

            stage_event_rows.append({
                "event_id": f"{line_id}-EVT{stage['stage_number']}",
                "line_id": line_id, "project_id": project_id,
                "stage_number": stage["stage_number"], "stage_name": stage["stage_name"],
                "event_type": stage["event_type"],
                "actor_email": make_actor_email(stage["role"], project_id),
                "actor_role": stage["role"],
                "event_timestamp": exit_ts,
                "notes": None,
            })
            t = exit_ts

        line_rows[-1]["updated_at"] = stage_exit_ts_by_stage[6]
        project_closed_candidates.append(stage_exit_ts_by_stage[6])

        # --- true_up_records + change_log (PRELIMINARY @ stage 3/4, FINAL @ stage 5/6) ---
        variance_mean = 0.15 if is_problem_line else 0.04
        variance_sd = 0.15 if is_problem_line else 0.08

        for true_up_type, perform_stage, confirm_stage in [("PRELIMINARY", 3, 4), ("FINAL", 5, 6)]:
            variance_pct = round(float(np.clip(np.random.normal(variance_mean * 100, variance_sd * 100), -20, 60)), 1)
            actual_length = round(estimated_length * (1 + variance_pct / 100), 1)

            n_fittings_est = max(1, int(estimated_length / 20) + random.randint(0, 2))
            n_fittings_act = max(1, n_fittings_est + int(round(n_fittings_est * variance_pct / 100)) + random.randint(-1, 1))
            n_valves_est = random.randint(1, 4)
            n_valves_act = max(0, n_valves_est + (1 if is_problem_line and random.random() < 0.3 else 0))
            n_supports_est = max(1, int(estimated_length / 15))
            n_supports_act = max(1, n_supports_est + int(round(n_supports_est * variance_pct / 100)))

            weight_per_ft = WEIGHT_PER_FT[nominal_size_in] * MATERIAL_WEIGHT_FACTOR[material]
            mto_weight_est = round(estimated_length * weight_per_ft, 1)
            mto_weight_act = round(actual_length * weight_per_ft, 1)
            cost_per_lb = COST_PER_LB[material]
            mto_cost_est = round(mto_weight_est * cost_per_lb, 2)
            mto_cost_act = round(mto_weight_act * cost_per_lb, 2)

            true_up_id = f"{line_id}-TU-{true_up_type[:3]}"
            fitting_detail = [
                {"type": t_, "size": nominal_size_in,
                 "estimated_qty": max(0, n_fittings_est // len(FITTING_TYPES[:3]) + random.randint(0, 1)),
                 "actual_qty": max(0, n_fittings_act // len(FITTING_TYPES[:3]) + random.randint(0, 1))}
                for t_ in FITTING_TYPES[:3]
            ]
            valve_detail = [
                {"type": random.choice(VALVE_TYPES), "size": nominal_size_in,
                 "estimated_qty": 1, "actual_qty": 1}
                for _ in range(n_valves_est)
            ]
            support_detail = [
                {"type": "Hanger", "size": nominal_size_in,
                 "estimated_qty": n_supports_est, "actual_qty": n_supports_act}
            ]

            true_up_rows.append({
                "true_up_id": true_up_id, "line_id": line_id, "project_id": project_id,
                "true_up_type": true_up_type,
                "estimated_centerline_length_ft": estimated_length,
                "actual_centerline_length_ft": actual_length,
                "length_variance_pct": variance_pct,
                "fitting_detail": fitting_detail, "valve_detail": valve_detail, "support_detail": support_detail,
                "weld_count_estimated": n_fittings_est * 2, "weld_count_actual": n_fittings_act * 2,
                "flange_count_estimated": n_valves_est * 2, "flange_count_actual": n_valves_act * 2,
                "mto_weight_estimated_lb": mto_weight_est, "mto_weight_actual_lb": mto_weight_act,
                "mto_cost_estimated_usd": mto_cost_est, "mto_cost_actual_usd": mto_cost_act,
                "isometric_drawing_ref": line_rows[-1]["isometric_drawing_no"],
                "pid_ref": line_rows[-1]["pid_reference"],
                "performed_by": make_actor_email("Design Lead", project_id),
                "performed_at": stage_exit_ts_by_stage[perform_stage],
                "confirmed_by": make_actor_email("Lead Engineer", project_id),
                "confirmed_at": stage_exit_ts_by_stage[confirm_stage],
            })

            n_changes = np.random.choice([0, 1, 2, 3], p=[0.60, 0.25, 0.10, 0.05])
            if is_problem_line:
                n_changes = max(n_changes, np.random.choice([1, 2, 3], p=[0.3, 0.4, 0.3]))
            for c in range(int(n_changes)):
                change_log_rows.append({
                    "change_id": f"{true_up_id}-CH{c+1}",
                    "true_up_id": true_up_id, "line_id": line_id,
                    "reason_category": weighted_choice(REASON_CATEGORIES),
                    "reason_text": "See true-up notes for detail.",
                    "changed_by": make_actor_email("Design Lead", project_id),
                    "changed_at": stage_exit_ts_by_stage[perform_stage],
                })

    proj["closed_at"] = max(project_closed_candidates)

print(f"projects={len(project_rows)} lines={len(line_rows)} stage_events={len(stage_event_rows)} "
      f"true_ups={len(true_up_rows)} change_log={len(change_log_rows)}")

# COMMAND ----------

import pandas as pd
import json as _json
from pyspark.sql import functions as F

spark.sql(f"USE CATALOG {CATALOG}")
spark.sql(f"USE SCHEMA {SCHEMA}")


def cast_cols(df, int_cols=(), decimal_cols=()):
    # pandas int64 -> Spark LongType by default, which Delta's schema
    # enforcement rejects against a table declared INT; DECIMAL likewise needs
    # an explicit cast down from the DoubleType Spark infers. Do this once,
    # here, rather than hand-writing a full StructType per table.
    for c in int_cols:
        df = df.withColumn(c, F.col(c).cast("int"))
    for c in decimal_cols:
        df = df.withColumn(c, F.col(c).cast("decimal(12,2)"))
    return df


# projects
pdf = pd.DataFrame(project_rows)
df = cast_cols(spark.createDataFrame(pdf), int_cols=["target_line_count"])
df.write.mode("overwrite").saveAsTable("historical_projects")

# lines
pdf = pd.DataFrame(line_rows)
df = cast_cols(spark.createDataFrame(pdf), int_cols=["current_stage"])
df.write.mode("overwrite").saveAsTable("historical_lines")

# stage_history
pdf = pd.DataFrame(stage_event_rows)
df = cast_cols(spark.createDataFrame(pdf), int_cols=["stage_number"])
df.write.mode("overwrite").saveAsTable("historical_stage_history")

# true_up_records — JSON-encode the *_detail struct columns (stored as STRING in Delta,
# matching the shape Lakehouse Sync would produce for the live jsonb columns)
pdf = pd.DataFrame(true_up_rows)
for col in ["fitting_detail", "valve_detail", "support_detail"]:
    pdf[col] = pdf[col].apply(_json.dumps)
df = cast_cols(
    spark.createDataFrame(pdf),
    int_cols=["weld_count_estimated", "weld_count_actual", "flange_count_estimated", "flange_count_actual"],
    decimal_cols=["mto_cost_estimated_usd", "mto_cost_actual_usd"],
)
df.write.mode("overwrite").saveAsTable("historical_true_up_records")

# change_log
if change_log_rows:
    pdf = pd.DataFrame(change_log_rows)
    spark.createDataFrame(pdf).write.mode("overwrite").saveAsTable("historical_change_log")
else:
    print("No change_log rows generated (unexpected for N_PROJECTS >= 20).")

print("Historical synthetic data written.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Quick validation

# COMMAND ----------

display(spark.sql(f"""
  SELECT 'projects' AS tbl, COUNT(*) AS n FROM {CATALOG}.{SCHEMA}.historical_projects
  UNION ALL SELECT 'lines', COUNT(*) FROM {CATALOG}.{SCHEMA}.historical_lines
  UNION ALL SELECT 'stage_history', COUNT(*) FROM {CATALOG}.{SCHEMA}.historical_stage_history
  UNION ALL SELECT 'true_up_records', COUNT(*) FROM {CATALOG}.{SCHEMA}.historical_true_up_records
  UNION ALL SELECT 'change_log', COUNT(*) FROM {CATALOG}.{SCHEMA}.historical_change_log
"""))

# COMMAND ----------

# Sanity check the core "story": large-bore + exotic lines should show longer
# true-up stage durations than small-bore carbon-steel lines. (unix_timestamp
# diff, not timestamp subtraction, to avoid relying on Spark's interval/EXTRACT
# support for sub-day precision.)
display(spark.sql(f"""
  WITH stage_gaps AS (
    SELECT sh.line_id, sh.stage_number,
           (unix_timestamp(sh.event_timestamp)
             - unix_timestamp(LAG(sh.event_timestamp) OVER (PARTITION BY sh.line_id ORDER BY sh.stage_number))
           ) / 3600.0 AS gap_hours
    FROM {CATALOG}.{SCHEMA}.historical_stage_history sh
  )
  SELECT l.nominal_size_in >= 8 AS large_bore,
         l.material IN ('Stainless 316','Chrome Moly (P11)','Chrome Moly (P22)') AS exotic_material,
         ROUND(AVG(s.gap_hours), 1) AS avg_true_up_stage_hours,
         COUNT(*) AS n
  FROM stage_gaps s JOIN {CATALOG}.{SCHEMA}.historical_lines l ON s.line_id = l.line_id
  WHERE s.stage_number IN (3,5)
  GROUP BY 1, 2
  ORDER BY 1, 2
"""))
