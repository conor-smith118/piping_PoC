# Burns & McDonnell Piping Workflow PoC

A Databricks App PoC modeling an EPC piping-design approval workflow: Estimators
enter line-list data, Lead Engineers confirm it, Design Leads true-up routed
quantities against the estimate (preliminary and final), and Lead Engineers
confirm each true-up. Built as a Databricks Asset Bundle (DABs): a Databricks
App (AppKit/React) for human data entry, backed by Lakebase Postgres with
real-time CDC into Unity Catalog, an always-live AI/BI dashboard and Genie
agent per project, and an ML model predicting stage-transition durations.

See `docs/ARCHITECTURE.md` for the full technical design and
`docs/DEMO_SCRIPT.md` for a live walkthrough script.

## Environment

| Item | Value |
|---|---|
| Databricks profile | `fevm-css-demo` |
| App | `burns-piping-poc` — https://burns-piping-poc-7405608145506562.2.azure.databricksapps.com |
| UC catalog.schema | `css_fevm.burns_piping_poc` |
| Lakebase project | `burns-piping-poc` (branch `production`, database `databricks-postgres`) |
| SQL Warehouse | `cssSQL` (`a4e59a1f13ab8b9a`) |
| Account-level groups | `Estimator Piping`, `Lead Engineer Piping`, `Design Lead Piping`, `Admin Piping` (in-app role labels: "Estimator" / "Lead Engineer" / "Design Lead" / "Admin") |
| Live projects | `BM-L-001` .. `BM-L-005` (5 active projects, ~93 lines at baseline) |
| Historical projects | 25 closed projects (~882 lines), synthetic ML training data |

## Deploying

```bash
databricks bundle validate --strict -t dev --profile fevm-css-demo
databricks bundle deploy -t dev --profile fevm-css-demo
databricks apps deploy burns-piping-poc --profile fevm-css-demo   # picks up app code changes; bundle deploy alone does not restart the app
```

The bundle's `dev` target uses `mode: production` (not `development`) deliberately —
this is a single stable environment, not a multi-developer sandbox, and
`development` mode's automatic resource-name prefixing would rename the UC
schema away from the literal name every other resource in this repo references.

## What's built

- **Role-based workflow app** — 6-stage timeline, Kanban board, per-line detail
  panel with stage-specific action forms, Estimator self-service edit/delete
  before confirmation. Every write route enforces its own role + stage
  requirement server-side, independent of what the UI shows.
- **Lakebase-backed human data entry** — all interactive writes go through
  Postgres (OBO via the app's Lakebase pool), replicated into Unity Catalog
  by Lakehouse Sync CDC.
- **Always-live dashboard + Genie, per project** — one Lakeview dashboard per
  live project, each natively linked (via `uiSettings.genieSpace.overrideId`)
  to that project's own curated Genie agent. Both read data computed directly
  from the CDC tables at query time — see `ARCHITECTURE.md`'s "Data freshness"
  section for how and why.
- **Per-project Genie agents** — 5 curated agents, each scoped via static
  per-project views to that project's full line list, stage-history audit
  trail, true-up/change-log detail, and ML predictions.
- **ML stage-duration model** — XGBoost regressor trained on 25 synthetic
  historical projects, predicting remaining time per line; batch-scored
  predictions feed the Kanban ETA column, dashboard KPI, and Genie.
- **Account-level RBAC** — role groups support Databricks' native
  "assume role" login flow, so a single test identity can genuinely
  experience each restricted role, not just via an in-app switcher.
- **Fully commented Unity Catalog** — every table/view and column carries a
  `COMMENT`, applied inline in the DDL itself (`src/sql/ddl/01`-`06_*.sql`),
  so Genie and UC search both resolve real column semantics rather than
  guessing from column names.
- **Admin console** — manage per-project role assignments without touching
  workspace/account identity management.
- **Simulate/reset jobs** — `simulate_new_data` (writes through the real
  Lakebase → CDC path) and `reset_poc` (restores an exact frozen baseline),
  both manual-trigger only, for repeatable demos.
- **v2 shell** — a clearly-marked placeholder for real S3D SQL Server
  write-back; no live connection.

## Known limitations

1. **ML predictions (`gold_ml_predictions`) are not always-live** like the
   dashboard is — they only refresh when `ml_batch_inference` runs (manual,
   or chained after `simulate_new_data`/`reset_poc`). A real workflow action
   in the app won't move the Kanban ETA column until that job runs.
2. **CDC-based views grow slower over time.** `v_lines`/`v_stage_history`/etc.
   compute "latest state" directly from the append-only `lb_*_history` CDC
   tables, which never get pruned automatically. Fine at this PoC's scale
   (sub-3-second query time); a real long-running deployment would eventually
   want periodic CDC history pruning or a return to a batch-materialized
   approach at much larger scale.
3. **Two things need a real browser to confirm**, not just CLI/API access:
   - **Embedding domain allowlist** — if a dashboard iframe renders
     blank/blocked, a workspace admin needs to allow this app's domain via
     the dashboard's **Share → Embed dashboard** dialog.
   - **The dashboard's built-in "Ask Genie" button**, and its own
     `embed_credentials` identity's access to the CDC-based views — both
     verified via direct API calls under other identities (Genie's own
     conversation API, my own CLI), not yet clicked through in a browser.
4. **Republishing a dashboard** after editing its `.lvdash.json` requires
   both `databricks bundle deploy` (updates the draft) and
   `databricks lakeview publish <id> --warehouse-id a4e59a1f13ab8b9a
   --embed-credentials` (publishes it) — for all 5 dashboards if the shared
   template (`build_dashboard_config.py`) changes.
5. **No project create/edit in `/admin`** — the 5 live projects are each
   hardcoded into their own dashboard and Genie agent; a 6th project created
   through the admin UI alone would get neither. Real project provisioning
   would need to extend those bundle resources too.
