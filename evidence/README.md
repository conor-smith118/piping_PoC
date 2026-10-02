# Execution evidence

Everything in this folder is **real output captured from a live run of this
exact codebase**, on 2026-10-02, against the deployed workspace described in
`SETUP.md`/`README.md` — not fabricated, not a screenshot, and not written
from memory. Each file states how it was captured so it can be reproduced.

This folder exists specifically to satisfy "evidence the build actually
ran" as text: every number below (row counts, model metrics, timings, HTTP
responses, generated SQL) is copy-pasted from a real tool/API response, in
the order the pipeline actually runs.

| File | What it proves | How it was captured |
|---|---|---|
| [`01_pipeline_run_log.md`](01_pipeline_run_log.md) | Every job in the bundle (synthetic data generation, DDL apply, ML training, reset, simulate, CDC refresh, batch scoring) ran end-to-end and succeeded, with real row counts/metrics in its own output | `databricks.sdk` Jobs API: `run_now` → poll `get_run` → `get_run_output` on each task, verbatim |
| [`02_cdc_freshness_test.md`](02_cdc_freshness_test.md) | The "always-live dashboard" architectural claim is real, not aspirational — a timed, one-off test | A notebook submitted via `databricks jobs submit`, writing one real row to Lakebase Postgres and polling the CDC-backed view until it appeared |
| [`03_query_results.md`](03_query_results.md) | The gold/ML layer that the dashboard and Genie actually query contains real, correct, varied data after the pipeline run above | Databricks SQL Statement Execution API against the live warehouse, verbatim |
| [`04_app_http_smoke_test.md`](04_app_http_smoke_test.md) | The deployed Databricks App is live and its authorization logic resolves real per-project roles correctly | `curl` against the deployed app's own URL with a real OAuth bearer token, verbatim HTTP responses |
| [`05_genie_conversation.md`](05_genie_conversation.md) | A project's Genie agent answers a real natural-language question correctly, using real generated SQL against the real views | Genie Conversation REST API (`start-conversation` → poll), verbatim |

## Reproducing this yourself

Every command here is also in `SETUP.md`/`docs/DEMO_SCRIPT.md` in context.
Nothing in this folder is special-cased — it's the same jobs, same app,
same Genie space a real user would hit by clicking through the deployed
app, just invoked via API so the result can be captured as committed text
instead of a screenshot.
