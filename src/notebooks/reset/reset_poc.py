# Databricks notebook source
# MAGIC %md
# MAGIC # Reset the 5 live projects back to their frozen seed state
# MAGIC
# MAGIC Wipes all 6 Lakebase tables (they hold **only** the 5 live projects — see
# MAGIC ARCHITECTURE.md's "Key structural decision" — so an unconditional `DELETE`
# MAGIC in FK-safe child-to-parent order is exactly equivalent to a scoped delete,
# MAGIC with no risk of ever touching historical/training data, which lives only
# MAGIC in Delta and is never written by anything in this notebook), then replays
# MAGIC `src/sql/lakebase/seed_live_data.sql` **verbatim** — the exact same frozen,
# MAGIC deterministic file applied once at initial setup (Phase 1), never
# MAGIC regenerated with a new random seed on reset, so every reset produces
# MAGIC byte-for-byte identical state (same project_id/line_id/event_id primary
# MAGIC keys as the original seed).
# MAGIC
# MAGIC `DELETE` (not `TRUNCATE`) deliberately — matches the same choice already
# MAGIC made in `simulate_new_data`/the app itself, so this reset's rows emit the
# MAGIC same kind of row-level CDC delete events Lakehouse Sync already handles
# MAGIC correctly (verified in Phase 4/8b — `refresh_silver_gold`'s
# MAGIC `whenNotMatchedBySourceDelete` removes any PK whose *latest* CDC state is
# MAGIC a delete, which is exactly what every row not present in the reseed will
# MAGIC be — including any lines/events added by `simulate_new_data` since the
# MAGIC last reset).
# MAGIC
# MAGIC Manual-trigger only. Chained with `refresh_silver_gold` + `ml_batch_inference`
# MAGIC via `run_job_task` in `resources/jobs.reset_poc.yml`, so a reset leaves the
# MAGIC dashboards/Genie agents/ML predictions caught up to the restored baseline
# MAGIC rather than stale or empty.

# COMMAND ----------

# MAGIC %pip install --quiet psycopg2-binary

# COMMAND ----------

dbutils.library.restartPython()

# COMMAND ----------

dbutils.widgets.text("lakebase_project_id", "burns-piping-poc", "Lakebase project")
dbutils.widgets.text("lakebase_branch_id", "production", "Lakebase branch")
dbutils.widgets.text("lakebase_endpoint_id", "primary", "Lakebase endpoint")
dbutils.widgets.text("seed_sql_path", "", "Absolute workspace path to seed_live_data.sql")

PROJECT_ID = dbutils.widgets.get("lakebase_project_id")
BRANCH_ID = dbutils.widgets.get("lakebase_branch_id")
ENDPOINT_ID = dbutils.widgets.get("lakebase_endpoint_id")
ENDPOINT_PATH = f"projects/{PROJECT_ID}/branches/{BRANCH_ID}/endpoints/{ENDPOINT_ID}"
SEED_SQL_PATH = dbutils.widgets.get("seed_sql_path")

# COMMAND ----------

import psycopg2
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
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
# MAGIC ## Wipe all 6 tables, child-to-parent (FK order from src/sql/lakebase/00_schema.sql)

# COMMAND ----------

DELETE_ORDER = ["change_log", "true_up_records", "stage_events", "lines", "user_project_role", "projects"]

before_counts = {}
for t in DELETE_ORDER:
    cur.execute(f"SELECT COUNT(*) FROM {t}")
    before_counts[t] = cur.fetchone()[0]
for t in DELETE_ORDER:
    cur.execute(f"DELETE FROM {t}")
print(f"Deleted (row counts before delete): {before_counts}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Replay the frozen seed file verbatim
# MAGIC The file is plain `INSERT ... ;` statements, one per line, wrapped in its
# MAGIC own `BEGIN;`/`COMMIT;` — those two lines are skipped here since psycopg2's
# MAGIC own transaction (this notebook's single `conn`, committed once at the very
# MAGIC end alongside the deletes above) already provides the transaction
# MAGIC boundary; sending a second literal `BEGIN`/`COMMIT` as SQL text would just
# MAGIC be redundant, not harmful, but skipping them is clearer about which
# MAGIC transaction is actually in effect.

# COMMAND ----------

with open(SEED_SQL_PATH) as f:
    seed_lines = f.readlines()

n_statements = 0
for line in seed_lines:
    stmt = line.strip()
    if not stmt or stmt.startswith("--") or stmt in ("BEGIN;", "COMMIT;"):
        continue
    cur.execute(stmt)
    n_statements += 1

print(f"Replayed {n_statements} INSERT statements from {SEED_SQL_PATH}.")

# COMMAND ----------

conn.commit()

after_counts = {}
for t in DELETE_ORDER:
    cur.execute(f"SELECT COUNT(*) FROM {t}")
    after_counts[t] = cur.fetchone()[0]
print(f"Row counts after reset: {after_counts}")

cur.close()
conn.close()
print("Reset committed. Run/wait for refresh_silver_gold (chained automatically by this job) "
      "to see the restored baseline reflected in Delta/dashboards/Genie.")

summary = (
    f"reset_poc: deleted rows (before counts: {before_counts}), replayed {n_statements} INSERT "
    f"statements from the frozen seed file, restored row counts: {after_counts}."
)
print(summary)
dbutils.notebook.exit(summary)
