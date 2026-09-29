# Databricks notebook source
# MAGIC %md
# MAGIC # Batch-score stage-duration predictions for live in-flight lines
# MAGIC
# MAGIC For every live, not-yet-complete line: predicts how much longer its
# MAGIC *current* open stage-transition will take, then iteratively predicts every
# MAGIC *remaining* stage's duration (holding the line's own attributes fixed,
# MAGIC varying only `stage_number`) to roll up an estimated full-completion
# MAGIC timestamp. Writes `gold_ml_predictions`, overwritten per run.
# MAGIC
# MAGIC Loaded via `mlflow.pyfunc.load_model` (plain driver-side pandas, not
# MAGIC `spark_udf`) — at this PoC's scale (dozens of in-flight lines) there's no
# MAGIC reason to distribute, and the per-line "sum several hypothetical future
# MAGIC stages" logic is far simpler to write row-wise than as a Spark UDF.

# COMMAND ----------

# MAGIC %pip install --quiet xgboost

# COMMAND ----------

dbutils.library.restartPython()

# COMMAND ----------

dbutils.widgets.text("catalog", "css_fevm", "Catalog")
dbutils.widgets.text("schema", "burns_piping_poc", "Schema")

CATALOG = dbutils.widgets.get("catalog")
SCHEMA = dbutils.widgets.get("schema")
MODEL_NAME = f"{CATALOG}.{SCHEMA}.stage_duration_model"

spark.sql(f"USE CATALOG {CATALOG}")
spark.sql(f"USE SCHEMA {SCHEMA}")

# COMMAND ----------

import json
import mlflow
import numpy as np
import pandas as pd
from datetime import timedelta

mlflow.set_registry_uri("databricks-uc")
model = mlflow.pyfunc.load_model(f"models:/{MODEL_NAME}@prod")

feature_columns = json.loads(
    spark.sql(
        f"SELECT value FROM {CATALOG}.{SCHEMA}._ml_model_metadata "
        f"WHERE model_name = '{MODEL_NAME}' AND key = 'feature_columns' "
        f"ORDER BY updated_at DESC LIMIT 1"
    ).first()["value"]
)
print(f"Loaded model {MODEL_NAME}@prod with {len(feature_columns)} feature columns.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Load in-flight lines and build the hypothetical future-stage rows

# COMMAND ----------

lines_pdf = spark.sql(f"""
  SELECT l.line_id, l.project_id, l.current_stage, gls.latest_event_timestamp,
         l.nominal_size_in, l.material, l.line_class_spec, l.service, l.insulation_type,
         l.heat_tracing_flag, l.estimated_centerline_length_ft,
         p.target_line_count AS num_lines_in_project, p.project_type
  FROM {CATALOG}.{SCHEMA}.live_lines l
  JOIN {CATALOG}.{SCHEMA}.gold_line_status gls ON gls.line_id = l.line_id
  JOIN {CATALOG}.{SCHEMA}.live_projects p ON p.project_id = l.project_id
  WHERE NOT l.is_complete
""").toPandas()
print(f"In-flight live lines to score: {len(lines_pdf)}")

CATEGORICAL_COLS = ["material", "line_class_spec", "service", "insulation_type", "project_type"]
NUMERIC_COLS = ["stage_number", "nominal_size_in", "estimated_centerline_length_ft", "num_lines_in_project"]
BOOL_COLS = ["heat_tracing_flag"]


def predict_duration_hours(rows: pd.DataFrame) -> np.ndarray:
    """rows must have all of CATEGORICAL_COLS/NUMERIC_COLS/BOOL_COLS + stage_number."""
    enc = pd.get_dummies(rows[CATEGORICAL_COLS + NUMERIC_COLS + BOOL_COLS], columns=CATEGORICAL_COLS)
    enc = enc.reindex(columns=feature_columns, fill_value=0)
    # reindex's fill_value=0 lands newly-added (absent-in-this-batch) one-hot
    # columns as int64, while genuinely-present ones stay the bool dtype
    # get_dummies produced — a per-column dtype mismatch the model's strict
    # schema enforcement rejects outright (hit this for real: every
    # dummy column NOT matching this batch's actual category value failed).
    # Training never hit this because get_dummies ran once over the full
    # training set, where every category appears somewhere — no reindex
    # fill-in was ever needed there.
    onehot_cols = [c for c in feature_columns if c not in NUMERIC_COLS + BOOL_COLS]
    enc[onehot_cols] = enc[onehot_cols].astype("bool")
    log_hours = model.predict(enc)
    return np.exp(log_hours)


# COMMAND ----------

# MAGIC %md
# MAGIC ## Score: current open transition + every remaining hypothetical stage

# COMMAND ----------

now = pd.Timestamp.utcnow().tz_localize(None)
results = []

for _, row in lines_pdf.iterrows():
    current_stage = int(row["current_stage"])
    remaining_stage_numbers = list(range(current_stage + 1, 7))  # e.g. current_stage=2 -> [3,4,5,6]
    if not remaining_stage_numbers:
        continue  # shouldn't happen (is_complete would be true at stage 6), but be defensive

    # `row` comes from lines_pdf.iterrows(), which collapses each row to a
    # single-dtype (object) Series regardless of the source columns' real
    # types — reconstructing a DataFrame from repeated rows then re-infers
    # per-column dtypes from scratch, which lands INT columns on int64, not
    # the int32 the model's schema was trained on (Spark INT via
    # .toPandas()). Must match exactly or mlflow's strict schema enforcement
    # rejects the input outright (hit this for real: stage_number tripped it
    # first, num_lines_in_project would have been next).
    hypothetical = pd.DataFrame([row] * len(remaining_stage_numbers))
    hypothetical["stage_number"] = pd.array(remaining_stage_numbers, dtype="int32")
    hypothetical["num_lines_in_project"] = hypothetical["num_lines_in_project"].astype("int32")
    hypothetical["nominal_size_in"] = hypothetical["nominal_size_in"].astype("float64")
    hypothetical["estimated_centerline_length_ft"] = hypothetical["estimated_centerline_length_ft"].astype("float64")
    hypothetical["heat_tracing_flag"] = hypothetical["heat_tracing_flag"].astype("bool")
    predicted_hours = predict_duration_hours(hypothetical)

    hours_elapsed_in_current = max(
        0.0, (now - pd.Timestamp(row["latest_event_timestamp"])).total_seconds() / 3600.0
    )
    remaining_current = max(0.0, float(predicted_hours[0]) - hours_elapsed_in_current)
    remaining_future = float(np.sum(predicted_hours[1:])) if len(predicted_hours) > 1 else 0.0
    # xgboost predictions are numpy.float32 — timedelta() rejects that type
    # for its `hours` kwarg outright (needs a plain Python float/int).
    predicted_remaining_hours = float(remaining_current + remaining_future)

    results.append(
        {
            "project_id": row["project_id"],
            "line_id": row["line_id"],
            "current_stage": current_stage,
            "predicted_remaining_hours": round(predicted_remaining_hours, 1),
            "predicted_completion_ts": now + timedelta(hours=predicted_remaining_hours),
            "model_version": mlflow.MlflowClient(registry_uri="databricks-uc")
            .get_model_version_by_alias(MODEL_NAME, "prod")
            .version,
            "scored_at": now,
        }
    )

predictions_pdf = pd.DataFrame(results)
# Same int32-vs-int64 class of issue as the model schema fix above, this
# time on the Delta write: gold_ml_predictions.current_stage is INT (32-bit,
# see src/sql/ddl/04_gold_tables.sql), but a plain Python int in a dict
# defaults to int64 once pandas infers this column's dtype.
predictions_pdf["current_stage"] = predictions_pdf["current_stage"].astype("int32")
print(f"Scored {len(predictions_pdf)} in-flight lines.")
print(predictions_pdf.head())

# COMMAND ----------

spark.createDataFrame(predictions_pdf).write.mode("overwrite").saveAsTable(
    f"{CATALOG}.{SCHEMA}.gold_ml_predictions"
)
print(f"gold_ml_predictions: {spark.table(f'{CATALOG}.{SCHEMA}.gold_ml_predictions').count()} rows")
