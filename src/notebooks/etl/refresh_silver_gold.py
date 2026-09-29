# Databricks notebook source
# MAGIC %md
# MAGIC # Refresh live_* (from Lakebase CDC) and gold_* tables
# MAGIC
# MAGIC Dedups the `lb_*_history` CDC landing tables (populated by Lakehouse Sync from
# MAGIC Lakebase) into the `live_*` Delta tables — latest state per primary key,
# MAGIC ordered by `_pg_lsn`, with deletes actually removed via
# MAGIC `whenNotMatchedBySourceDelete` — then fully rebuilds the gold layer
# MAGIC (`gold_line_status`, `gold_project_rollup`) from `v_lines`/`v_stage_history`/
# MAGIC `v_true_up_records`.
# MAGIC
# MAGIC Chained after `simulate_new_data` (Phase 8) and safe to run standalone/
# MAGIC repeatedly — every step here is idempotent (MERGE, CREATE OR REPLACE).
# MAGIC Historical tables are never read or written by this notebook.

# COMMAND ----------

dbutils.widgets.text("catalog", "css_fevm", "Catalog")
dbutils.widgets.text("schema", "burns_piping_poc", "Schema")

CATALOG = dbutils.widgets.get("catalog")
SCHEMA = dbutils.widgets.get("schema")

spark.sql(f"USE CATALOG {CATALOG}")
spark.sql(f"USE SCHEMA {SCHEMA}")

# COMMAND ----------

from delta.tables import DeltaTable
from pyspark.sql import functions as F
from pyspark.sql.window import Window

CDC_META_COLS = ["_pg_change_type", "_pg_lsn", "_pg_xid", "_timestamp", "_sort_by"]

# (cdc history table, live target table, primary key columns)
REFRESH_MAP = [
    ("lb_projects_history", "live_projects", ["project_id"]),
    ("lb_lines_history", "live_lines", ["line_id"]),
    ("lb_stage_events_history", "live_stage_history", ["event_id"]),
    ("lb_true_up_records_history", "live_true_up_records", ["true_up_id"]),
    ("lb_change_log_history", "live_change_log", ["change_id"]),
    ("lb_user_project_role_history", "live_user_project_role", ["user_email", "project_id"]),
]


def latest_state(cdc_table: str, pk_cols: list[str]):
    """Current-state dataframe: latest row per PK by _pg_lsn, deletes excluded.
    Mirrors the dedup query in the databricks-lakebase skill's lakehouse-sync
    reference exactly, just expressed as a DataFrame window instead of SQL."""
    df = spark.table(cdc_table).where(
        F.col("_pg_change_type").isin("insert", "update_postimage", "delete")
    )
    w = Window.partitionBy(*pk_cols).orderBy(F.col("_pg_lsn").desc())
    df = df.withColumn("rn", F.row_number().over(w))
    df = df.where((F.col("rn") == 1) & (F.col("_pg_change_type") != "delete"))
    return df.drop("rn", *CDC_META_COLS)


def refresh_live_table(cdc_table: str, live_table: str, pk_cols: list[str]):
    source_df = latest_state(cdc_table, pk_cols)
    target = DeltaTable.forName(spark, live_table)
    merge_condition = " AND ".join([f"t.{c} = s.{c}" for c in pk_cols])
    (
        target.alias("t")
        .merge(source_df.alias("s"), merge_condition)
        .whenMatchedUpdateAll()
        .whenNotMatchedInsertAll()
        .whenNotMatchedBySourceDelete()
        .execute()
    )
    n = spark.table(live_table).count()
    print(f"{live_table}: refreshed from {cdc_table} -> {n} rows")


for cdc_table, live_table, pk_cols in REFRESH_MAP:
    refresh_live_table(cdc_table, live_table, pk_cols)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Rebuild gold_line_status
# MAGIC One row per line: `v_lines` + latest `v_stage_history` event + true-up
# MAGIC variance summary (preliminary and final, whichever exist so far).

# COMMAND ----------

spark.sql(f"""
CREATE OR REPLACE TABLE {CATALOG}.{SCHEMA}.gold_line_status AS
WITH latest_event AS (
  SELECT *
  FROM (
    SELECT sh.*, ROW_NUMBER() OVER (PARTITION BY sh.line_id ORDER BY sh.stage_number DESC) AS rn
    FROM {CATALOG}.{SCHEMA}.v_stage_history sh
  )
  WHERE rn = 1
),
prelim_tu AS (
  SELECT line_id, length_variance_pct AS prelim_length_variance_pct
  FROM {CATALOG}.{SCHEMA}.v_true_up_records WHERE true_up_type = 'PRELIMINARY'
),
final_tu AS (
  SELECT line_id, length_variance_pct AS final_length_variance_pct
  FROM {CATALOG}.{SCHEMA}.v_true_up_records WHERE true_up_type = 'FINAL'
)
SELECT
  l.line_id, l.project_id, l.line_no, l.service, l.line_class_spec, l.nominal_size_in,
  l.material, l.estimated_centerline_length_ft, l.current_stage,
  CASE l.current_stage
    WHEN 1 THEN 'Initial Data Entry' WHEN 2 THEN 'Initial Engineer Confirmation'
    WHEN 3 THEN 'Preliminary True-Up Complete' WHEN 4 THEN 'Engineer Prelim True-Up Confirmation'
    WHEN 5 THEN 'Final True-Up Complete' WHEN 6 THEN 'Engineer Final Confirmation'
  END AS current_stage_name,
  l.is_complete,
  e.event_type AS latest_event_type, e.actor_email AS latest_event_actor_email,
  e.actor_role AS latest_event_actor_role, e.event_timestamp AS latest_event_timestamp,
  p.prelim_length_variance_pct, f.final_length_variance_pct,
  l.data_origin
FROM {CATALOG}.{SCHEMA}.v_lines l
LEFT JOIN latest_event e ON e.line_id = l.line_id
LEFT JOIN prelim_tu p ON p.line_id = l.line_id
LEFT JOIN final_tu f ON f.line_id = l.line_id
""")
print(f"gold_line_status: {spark.table(f'{CATALOG}.{SCHEMA}.gold_line_status').count()} rows")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Rebuild gold_project_rollup
# MAGIC Mode/min stage among **incomplete** lines only (see ARCHITECTURE.md rollup
# MAGIC design) — projects with zero incomplete lines default to stage 6.

# COMMAND ----------

spark.sql(f"""
CREATE OR REPLACE TABLE {CATALOG}.{SCHEMA}.gold_project_rollup AS
WITH counts AS (
  SELECT project_id, COUNT(*) AS total_lines, COUNT(*) FILTER (WHERE is_complete) AS lines_complete
  FROM {CATALOG}.{SCHEMA}.gold_line_status
  GROUP BY project_id
),
stage_stats AS (
  -- Spark SQL's mode() is a plain aggregate (no Postgres-style
  -- WITHIN GROUP (ORDER BY ...) needed) — confirmed directly against this
  -- warehouse before relying on it here.
  SELECT project_id,
         MODE(current_stage) AS mode_stage,
         MIN(current_stage) AS min_stage,
         AVG(DATEDIFF(CURRENT_TIMESTAMP(), latest_event_timestamp)) AS avg_days_in_current_stage
  FROM {CATALOG}.{SCHEMA}.gold_line_status
  WHERE NOT is_complete
  GROUP BY project_id
)
SELECT
  p.project_id, p.project_name, p.client_name,
  c.total_lines, c.lines_complete,
  CAST(c.lines_complete AS DOUBLE) / c.total_lines AS pct_lines_complete,
  COALESCE(s.mode_stage, 6) AS mode_stage,
  COALESCE(s.min_stage, 6) AS min_stage,
  COALESCE(s.avg_days_in_current_stage, 0.0) AS avg_days_in_current_stage,
  p.data_origin
FROM {CATALOG}.{SCHEMA}.v_projects p
JOIN counts c ON c.project_id = p.project_id
LEFT JOIN stage_stats s ON s.project_id = p.project_id
""")
print(f"gold_project_rollup: {spark.table(f'{CATALOG}.{SCHEMA}.gold_project_rollup').count()} rows")
