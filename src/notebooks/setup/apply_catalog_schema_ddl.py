# Databricks notebook source
# MAGIC %md
# MAGIC # Apply catalog/schema DDL (one-time setup)
# MAGIC
# MAGIC Runs `src/sql/ddl/01_live_tables.sql` through `06_cdc_landing_table_comments.sql`
# MAGIC against this bundle's `catalog`/`schema` — in order, statement by statement,
# MAGIC within a single Spark session so a plain `USE CATALOG`/`USE SCHEMA` at the
# MAGIC top is enough to make every bare (non-catalog.schema-qualified) object name
# MAGIC in those files resolve correctly. This is what makes those SQL files
# MAGIC portable to any catalog/schema with no find-and-replace — see each file's
# MAGIC own header note.
# MAGIC
# MAGIC **Run this once** per fresh deployment, after the Lakebase schema/CDC setup
# MAGIC (see SETUP.md) and before `synthetic_historical_seed`/the live-data seed.
# MAGIC Safe to re-run any time after that too — every statement in 01-06 is
# MAGIC idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE VIEW`,
# MAGIC `COMMENT ON ... IS`, `ALTER ... ALTER COLUMN ... COMMENT`).
# MAGIC
# MAGIC `03_union_views.sql`/`04_gold_tables.sql`'s views reference the
# MAGIC `lb_*_history` CDC landing tables, which don't exist until Lakehouse Sync
# MAGIC has been enabled and has replicated at least once (see SETUP.md step 3) —
# MAGIC run this notebook *after* that, not before, or the `CREATE OR REPLACE VIEW`
# MAGIC statements for `v_*`/`gold_*` will fail with `TABLE_OR_VIEW_NOT_FOUND`.

# COMMAND ----------

dbutils.widgets.text("catalog", "css_fevm", "Catalog")
dbutils.widgets.text("schema", "burns_piping_poc", "Schema")
dbutils.widgets.text(
    "ddl_dir",
    "/Workspace/src/sql/ddl",
    "Workspace path to src/sql/ddl (bundle resolves this automatically)",
)

CATALOG = dbutils.widgets.get("catalog")
SCHEMA = dbutils.widgets.get("schema")
DDL_DIR = dbutils.widgets.get("ddl_dir")

spark.sql(f"USE CATALOG `{CATALOG}`")
spark.sql(f"USE SCHEMA `{SCHEMA}`")
print(f"Applying DDL against {CATALOG}.{SCHEMA}, reading from {DDL_DIR}")

# COMMAND ----------

DDL_FILES = [
    "01_live_tables.sql",
    "02_historical_tables.sql",
    "03_union_views.sql",
    "04_gold_tables.sql",
    "05_genie_project_views.sql",
    "06_cdc_landing_table_comments.sql",
]


def split_sql_statements(text: str) -> list[str]:
    """Quote-aware statement splitter: splits on ';' that is not inside a
    single-quoted string, and ignores '--' line comments (which may contain
    stray apostrophes, e.g. "doesn't", that would otherwise desync quote
    tracking). Mirrors the one-off script used to backfill these same files'
    comments onto this reference deployment — see ARCHITECTURE.md."""
    statements = []
    buf: list[str] = []
    in_string = False
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if not in_string and ch == "-" and i + 1 < n and text[i + 1] == "-":
            while i < n and text[i] != "\n":
                i += 1
            continue
        if ch == "'":
            if in_string and i + 1 < n and text[i + 1] == "'":
                buf.append("''")
                i += 2
                continue
            in_string = not in_string
            buf.append(ch)
            i += 1
            continue
        if not in_string and ch == ";":
            stmt = "".join(buf).strip()
            if stmt:
                statements.append(stmt)
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    tail = "".join(buf).strip()
    if tail:
        statements.append(tail)
    return statements


# COMMAND ----------

total_run = 0
for fname in DDL_FILES:
    path = f"{DDL_DIR}/{fname}"
    with open(path) as fh:
        text = fh.read()
    statements = split_sql_statements(text)
    print(f"== {fname}: {len(statements)} statements ==")
    for stmt in statements:
        spark.sql(stmt)
    total_run += len(statements)

print(f"Done. Ran {total_run} statements across {len(DDL_FILES)} files against {CATALOG}.{SCHEMA}.")
