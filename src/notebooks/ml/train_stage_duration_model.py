# Databricks notebook source
# MAGIC %md
# MAGIC # Train the stage-duration prediction model
# MAGIC
# MAGIC Builds `ml_stage_transition_features` from the historical (closed) projects'
# MAGIC full stage-transition history, trains an XGBoost regressor on
# MAGIC `log(duration_hours)`, and registers it to UC with a `@prod` alias.
# MAGIC
# MAGIC **Training grain:** line x stage-transition (~5,300 rows from 25 historical
# MAGIC projects x ~35 lines x 6 stages), not project — see ARCHITECTURE.md "ML
# MAGIC pipeline". Only fully-completed historical transitions are used (no
# MAGIC censoring needed since historical projects are closed); live in-flight rows
# MAGIC are written to the same feature table by this notebook for inspection, but
# MAGIC excluded from training (`is_complete_transition = false`).
# MAGIC
# MAGIC No Feature Store — none of its triggers (training/serving skew, point-in-time
# MAGIC joins, <10ms online serving, cross-model sharing) apply to a PoC at this
# MAGIC scale. Plain UC table.

# COMMAND ----------

# MAGIC %pip install --quiet optuna xgboost

# COMMAND ----------

dbutils.library.restartPython()

# COMMAND ----------

dbutils.widgets.text("catalog", "css_fevm", "Catalog")
dbutils.widgets.text("schema", "burns_piping_poc", "Schema")

CATALOG = dbutils.widgets.get("catalog")
SCHEMA = dbutils.widgets.get("schema")

spark.sql(f"USE CATALOG {CATALOG}")
spark.sql(f"USE SCHEMA {SCHEMA}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Build `ml_stage_transition_features`
# MAGIC
# MAGIC One row per line x stage-transition, for **both** historical and live lines
# MAGIC (live rows are in-flight / unlabeled — kept here so the batch-inference
# MAGIC notebook has a single feature table to read, not a second pipeline).
# MAGIC `duration_hours` is the gap from the previous stage's completion (or the
# MAGIC line's `created_at` for stage 1) to this stage's completion; `NULL` /
# MAGIC `is_complete_transition = false` for the one open (not-yet-completed) stage
# MAGIC of an in-flight line.

# COMMAND ----------

spark.sql(f"""
CREATE OR REPLACE TABLE {CATALOG}.{SCHEMA}.ml_stage_transition_features AS
WITH events AS (
  SELECT sh.line_id, sh.project_id, sh.stage_number, sh.stage_name, sh.event_timestamp,
         LAG(sh.event_timestamp) OVER (PARTITION BY sh.line_id ORDER BY sh.stage_number) AS prev_event_ts
  FROM {CATALOG}.{SCHEMA}.v_stage_history sh
),
completed_transitions AS (
  SELECT e.line_id, e.project_id, e.stage_number, e.stage_name,
         COALESCE(e.prev_event_ts, l.created_at) AS stage_entry_ts,
         e.event_timestamp AS stage_exit_ts,
         (unix_timestamp(e.event_timestamp) - unix_timestamp(COALESCE(e.prev_event_ts, l.created_at))) / 3600.0
           AS duration_hours,
         true AS is_complete_transition
  FROM events e
  JOIN {CATALOG}.{SCHEMA}.v_lines l ON l.line_id = e.line_id
),
-- the one OPEN transition per in-flight line: stage_number = current_stage + 1,
-- entry_ts = the latest recorded event (there is no exit yet)
open_transitions AS (
  SELECT l.line_id, l.project_id, l.current_stage + 1 AS stage_number,
         CASE l.current_stage + 1
           WHEN 2 THEN 'Initial Engineer Confirmation' WHEN 3 THEN 'Preliminary True-Up Complete'
           WHEN 4 THEN 'Engineer Prelim True-Up Confirmation' WHEN 5 THEN 'Final True-Up Complete'
           WHEN 6 THEN 'Engineer Final Confirmation'
         END AS stage_name,
         gls.latest_event_timestamp AS stage_entry_ts,
         CAST(NULL AS TIMESTAMP) AS stage_exit_ts,
         CAST(NULL AS DOUBLE) AS duration_hours,
         false AS is_complete_transition
  FROM {CATALOG}.{SCHEMA}.v_lines l
  JOIN {CATALOG}.{SCHEMA}.gold_line_status gls ON gls.line_id = l.line_id
  WHERE NOT l.is_complete
),
all_transitions AS (
  SELECT * FROM completed_transitions
  UNION ALL
  SELECT * FROM open_transitions
)
SELECT
  t.project_id, t.line_id, t.stage_number, t.stage_name, t.stage_entry_ts, t.stage_exit_ts,
  t.duration_hours, t.is_complete_transition,
  l.nominal_size_in, l.material, l.line_class_spec, l.service, l.insulation_type,
  l.heat_tracing_flag, l.estimated_centerline_length_ft,
  p.target_line_count AS num_lines_in_project, p.project_type,
  l.data_origin
FROM all_transitions t
JOIN {CATALOG}.{SCHEMA}.v_lines l ON l.line_id = t.line_id
JOIN {CATALOG}.{SCHEMA}.v_projects p ON p.project_id = t.project_id
""")
n = spark.table(f"{CATALOG}.{SCHEMA}.ml_stage_transition_features").count()
print(f"ml_stage_transition_features: {n} rows")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Load training data (completed historical transitions only)

# COMMAND ----------

import pandas as pd
import numpy as np

train_pdf = spark.sql(f"""
  SELECT stage_number, nominal_size_in, material, line_class_spec, service, insulation_type,
         heat_tracing_flag, estimated_centerline_length_ft, num_lines_in_project, project_type,
         duration_hours
  FROM {CATALOG}.{SCHEMA}.ml_stage_transition_features
  WHERE is_complete_transition AND data_origin = 'SYNTHETIC_HISTORICAL'
""").toPandas()

print(f"Training rows: {len(train_pdf)}")
print(train_pdf["duration_hours"].describe())

# COMMAND ----------

# MAGIC %md
# MAGIC ## Feature encoding + train/test split

# COMMAND ----------

CATEGORICAL_COLS = ["material", "line_class_spec", "service", "insulation_type", "project_type"]
NUMERIC_COLS = ["stage_number", "nominal_size_in", "estimated_centerline_length_ft", "num_lines_in_project"]
BOOL_COLS = ["heat_tracing_flag"]

train_pdf[CATEGORICAL_COLS] = train_pdf[CATEGORICAL_COLS].fillna("Unknown")
X = pd.get_dummies(train_pdf[CATEGORICAL_COLS + NUMERIC_COLS + BOOL_COLS], columns=CATEGORICAL_COLS)
y = np.log(train_pdf["duration_hours"].clip(lower=0.1))

from sklearn.model_selection import train_test_split

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
print(f"Train: {X_train.shape}, Test: {X_test.shape}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Train (Optuna + XGBoost) and register the best run to UC

# COMMAND ----------

import mlflow
import mlflow.xgboost
import optuna
from mlflow.tracking import MlflowClient
from xgboost import XGBRegressor
from sklearn.metrics import mean_absolute_error, r2_score

mlflow.set_registry_uri("databricks-uc")

# set_experiment does NOT auto-create the parent folder — pre-create it.
EXPERIMENT_DIR = "/Users/conor.smith@databricks.com/burns_piping_poc"
from databricks.sdk import WorkspaceClient

WorkspaceClient().workspace.mkdirs(EXPERIMENT_DIR)
mlflow.set_experiment(f"{EXPERIMENT_DIR}/stage_duration_model")

MODEL_NAME = f"{CATALOG}.{SCHEMA}.stage_duration_model"


# Manual logging (params/metrics/model), not autolog — each Optuna trial is
# a short-lived nested run and we only want the single best-params retrain
# registered as a UC model version (autolog + registered_model_name would
# register every trial).
def objective(trial):
    params = {
        "n_estimators": trial.suggest_int("n_estimators", 50, 300),
        "max_depth": trial.suggest_int("max_depth", 2, 8),
        "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
        "subsample": trial.suggest_float("subsample", 0.6, 1.0),
    }
    with mlflow.start_run(nested=True):
        m = XGBRegressor(**params, random_state=42).fit(X_train, y_train)
        preds = m.predict(X_test)
        mae = mean_absolute_error(y_test, preds)
        mlflow.log_params(params)
        mlflow.log_metric("val_mae_log_hours", mae)
        return mae


with mlflow.start_run(run_name="hpo") as parent_run:
    study = optuna.create_study(direction="minimize")
    study.optimize(objective, n_trials=20)
    print(f"Best params: {study.best_params}, best MAE (log hours): {study.best_value:.4f}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Retrain best params on full train set, evaluate, register

# COMMAND ----------

with mlflow.start_run(run_name="best"):
    best_model = XGBRegressor(**study.best_params, random_state=42).fit(X_train, y_train)
    preds_log = best_model.predict(X_test)
    preds_hours = np.exp(preds_log)
    actual_hours = np.exp(y_test)

    mae_log = mean_absolute_error(y_test, preds_log)
    mae_hours = mean_absolute_error(actual_hours, preds_hours)
    r2 = r2_score(y_test, preds_log)

    mlflow.log_params(study.best_params)
    mlflow.log_metric("val_mae_log_hours", mae_log)
    mlflow.log_metric("val_mae_hours", mae_hours)
    mlflow.log_metric("val_r2_log_hours", r2)
    print(f"MAE (hours): {mae_hours:.1f}, MAE (log hours): {mae_log:.4f}, R2 (log scale): {r2:.3f}")

    info = mlflow.xgboost.log_model(
        best_model,
        name="model",
        registered_model_name=MODEL_NAME,
        input_example=X_train.head(5),
    )

client = MlflowClient(registry_uri="databricks-uc")
client.set_registered_model_alias(MODEL_NAME, "prod", info.registered_model_version)
print(f"Registered {MODEL_NAME} version {info.registered_model_version}, aliased @prod")

# COMMAND ----------

# Persist the exact training column order — batch inference must reproduce
# an identical one-hot layout. get_dummies on live data alone would silently
# produce different/missing columns whenever a category doesn't appear in
# whatever's currently in-flight (e.g. no live line happens to use Chrome
# Moly right now), so this can't just be recomputed at scoring time. No UC
# Volume is provisioned for this PoC, so a tiny metadata table is the
# simplest persistence mechanism — this table holds config, not data, and is
# intentionally excluded from ARCHITECTURE.md's table inventory.
import json
from pyspark.sql import functions as F

spark.sql(f"""
CREATE TABLE IF NOT EXISTS {CATALOG}.{SCHEMA}._ml_model_metadata (
  model_name STRING COMMENT 'UC Model Registry model name this metadata row belongs to (e.g. css_fevm.burns_piping_poc.stage_duration_model).',
  key STRING COMMENT 'Metadata key, e.g. feature_columns.',
  value STRING COMMENT 'Metadata value. For key=feature_columns: a JSON array of the exact one-hot-encoded column order used at training time, which batch_score_predictions.py must reproduce identically at scoring time.',
  updated_at TIMESTAMP COMMENT 'Timestamp this metadata row was written (each training run deletes and re-inserts its model''s row).'
) USING DELTA
COMMENT 'Small internal config table (not line/project data) persisting training-time artifacts — currently just the one-hot feature-column order — that batch inference must reproduce exactly. Intentionally excluded from ARCHITECTURE.md''s table inventory as it is config, not a data table.'
""")
spark.sql(
    f"DELETE FROM {CATALOG}.{SCHEMA}._ml_model_metadata "
    f"WHERE model_name = '{MODEL_NAME}' AND key = 'feature_columns'"
)
spark.createDataFrame(
    [(MODEL_NAME, "feature_columns", json.dumps(list(X.columns)))],
    ["model_name", "key", "value"],
).withColumn("updated_at", F.current_timestamp()).write.mode("append").saveAsTable(
    f"{CATALOG}.{SCHEMA}._ml_model_metadata"
)
print(f"Saved {len(X.columns)} feature columns to _ml_model_metadata for batch inference to reuse.")
