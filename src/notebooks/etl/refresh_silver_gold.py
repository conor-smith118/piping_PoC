# Databricks notebook source
# MAGIC %md
# MAGIC # Refresh live_* tables (from Lakebase CDC)
# MAGIC
# MAGIC Dedups the `lb_*_history` CDC landing tables (populated by Lakehouse Sync from
# MAGIC Lakebase) into the `live_*` Delta tables — latest state per primary key,
# MAGIC ordered by `_pg_lsn`, with deletes actually removed via
# MAGIC `whenNotMatchedBySourceDelete`.
# MAGIC
# MAGIC **No longer rebuilds `gold_line_status`/`gold_project_rollup`** — those are
# MAGIC now views computed directly from the CDC tables (via `v_lines`/
# MAGIC `v_stage_history`/`v_true_up_records`/`v_projects` — see
# MAGIC `src/sql/ddl/03_union_views.sql` and `04_gold_tables.sql`), so the
# MAGIC dashboard/Genie are always live with no dependency on this (or any) job
# MAGIC ever running. This job still exists for `live_lines`/`live_projects`,
# MAGIC which `ml_batch_inference` reads directly rather than through a
# MAGIC CDC-computed view — a stable, periodically-refreshed snapshot is exactly
# MAGIC what batch ML scoring wants, unlike the dashboard. See
# MAGIC ARCHITECTURE.md's "Dashboard freshness: query CDC directly instead of
# MAGIC waiting on a batch job" for the full reasoning and the live timing
# MAGIC comparison that motivated this (a real app write landed in
# MAGIC `lb_lines_history` within the same second either way — the batch
# MAGIC rebuild's ~90-110s serverless-notebook floor was pure job-trigger latency
# MAGIC on top of that, not CDC lag).
# MAGIC
# MAGIC Chained after `simulate_new_data`/`reset_poc` (Phase 8) and safe to run
# MAGIC standalone/repeatedly — every step here is idempotent (MERGE). Historical
# MAGIC tables are never read or written by this notebook.

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
# Kept refreshing all 6, not just live_lines/live_projects (the two
# ml_batch_inference actually reads directly) — the rest stay genuinely
# useful as a stable, materialized snapshot for ad-hoc inspection/debugging,
# separate from the CDC-computed-on-every-query v_* views, and there's no
# real cost to keeping them fresh too.
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
    reference exactly, just expressed as a DataFrame window instead of SQL —
    and the same logic (expressed as a SQL window function instead) that
    03_union_views.sql now uses directly, at query time, for the dashboard's
    sake."""
    df = spark.table(cdc_table).where(
        F.col("_pg_change_type").isin("insert", "update_postimage", "delete")
    )
    w = Window.partitionBy(*pk_cols).orderBy(F.col("_pg_lsn").desc())
    df = df.withColumn("rn", F.row_number().over(w))
    df = df.where((F.col("rn") == 1) & (F.col("_pg_change_type") != "delete"))
    return df.drop("rn", *CDC_META_COLS)


def refresh_live_table(cdc_table: str, live_table: str, pk_cols: list[str]) -> str:
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
    line = f"{live_table}: refreshed from {cdc_table} -> {n} rows"
    print(line)
    return line


summary_lines = [refresh_live_table(cdc_table, live_table, pk_cols) for cdc_table, live_table, pk_cols in REFRESH_MAP]
summary = "refresh_silver_gold: " + "; ".join(summary_lines)
dbutils.notebook.exit(summary)
