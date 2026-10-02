# Burns & McDonnell Piping Workflow PoC — Architecture

## Overview

This PoC models an EPC piping-design approval workflow as a real, usable
Databricks App: an Estimator enters line-list data, a Lead Engineer confirms
it, routing happens externally (S3D-style 3D design), a Design Lead trues-up
the routed quantities against the estimate, and the Lead Engineer confirms
the true-up — twice (preliminary and final). Every human write goes through
Lakebase Postgres and replicates into Unity Catalog via CDC in real time,
feeding an always-live AI/BI dashboard, a curated Genie agent, and an ML model
predicting stage durations — all scoped per project.

## Environment

**Deploying this into a new workspace/account?** See `SETUP.md` at the repo
root for the full from-scratch sequence. The table below is this reference
deployment's actual values, given as a worked example — every one of them
is a bundle variable or a one-time setup choice, not hardcoded into
application code (confirmed: no catalog/schema/workspace-path/account-group-ID
literal survives outside `databricks.yml`'s variable *defaults* and this
documentation).

| Item | Value |
|---|---|
| Databricks profile | `fevm-css-demo` |
| UC catalog.schema | `css_fevm.burns_piping_poc` |
| Lakebase project | `burns-piping-poc` (branch `production`, database `databricks-postgres`) |
| SQL Warehouse | `cssSQL` (`a4e59a1f13ab8b9a`) |
| App | `burns-piping-poc`, bundle name `burns_piping_poc` |
| Account-level groups | `Estimator Piping`, `Lead Engineer Piping`, `Design Lead Piping`, `Admin Piping` — in-app role labels drop the suffix ("Estimator", "Lead Engineer", "Design Lead", "Admin") |
| Live projects | `BM-L-001` .. `BM-L-005` |

**Key structural decision:** Lakebase holds *only* live-project data. The 25
synthetic historical closed projects live directly in their own Delta tables
(same column shape as the live tables) and never touch Lakebase or CDC. This
keeps `simulate_new_data`/`reset_poc` structurally incapable of touching the
ML training corpus, and keeps the CDC surface limited to the 5 live projects.

## Repo structure

```
piping_PoC/
├── databricks.yml
├── resources/
│   ├── schema.burns_piping_poc.yml          # UC schema
│   ├── app.burns_piping_poc.yml             # Databricks App + its resource bindings
│   ├── jobs.synthetic_historical_seed.yml   # one-time: 25 closed projects -> Delta
│   ├── jobs.refresh_silver_gold.yml         # live_lines/live_projects refresh (for ML; see "Data freshness")
│   ├── jobs.simulate_new_data.yml           # manual-trigger demo data generator
│   ├── jobs.reset_poc.yml                   # manual-trigger baseline restore
│   ├── jobs.ml_train_stage_duration.yml
│   ├── jobs.ml_batch_inference.yml
│   ├── dashboards/<project>.dashboard.yml   # one per live project (x5)
│   └── genie_spaces/<project>.genie-space.yml  # one per live project (x5)
├── src/
│   ├── app/                        # AppKit (Node/TypeScript/React)
│   │   ├── app.yaml
│   │   ├── client/src/{App.tsx, pages/, components/, lib/}
│   │   └── server/{server.ts, lib/{auth,roles,db}.ts, routes/*.ts}
│   ├── dashboards/
│   │   ├── build_dashboard_config.py       # generates the 5 .lvdash.json below
│   │   └── project_progress_<project>.lvdash.json
│   ├── genie/
│   │   ├── build_agent_config.py           # generates the 5 .geniespace.json below
│   │   └── <project>.geniespace.json
│   ├── sql/
│   │   ├── ddl/01-06_*.sql                 # live/historical/union-views/gold/genie-views/cdc-comments
│   │   │                                   # (bare object names — see "Catalog/schema portability" below)
│   │   └── lakebase/{00_schema, 01_grant_app_access, seed_live_data}.sql
│   └── notebooks/
│       ├── setup/apply_catalog_schema_ddl.py  # one-time: runs sql/ddl/01-06 against this bundle's catalog/schema
│       ├── synthetic/{generate_historical_projects, generate_live_seed}.py
│       ├── etl/refresh_silver_gold.py
│       ├── simulate/simulate_new_data.py
│       ├── reset/reset_poc.py
│       └── ml/{train_stage_duration_model, batch_score_predictions}.py
├── docs/{ARCHITECTURE.md, DEMO_SCRIPT.md}
├── SETUP.md
└── README.md
```

### Catalog/schema portability

`src/sql/ddl/01`-`06_*.sql` use bare object names throughout (`live_lines`,
not `css_fevm.burns_piping_poc.live_lines`) — portable to any catalog/schema
with zero find-and-replace, as long as `USE CATALOG`/`USE SCHEMA` run first
in the same session. `apply_catalog_schema_ddl` (job + notebook) is exactly
that: it takes `catalog`/`schema` as parameters (wired from
`${var.catalog}`/`${var.schema}`), issues the two `USE` statements, then
runs every statement in all 6 files in one Spark session via
`${workspace.file_path}/src/sql/ddl` (a DABs built-in resolved at deploy
time, so the notebook never has to guess its own sibling files' path).
`databricks bundle run apply_catalog_schema_ddl` is the one command that
replaces what would otherwise be 6 files' worth of manual CLI SQL execution
with manual catalog/schema substitution.

## Data architecture

### Unity Catalog layers

| Layer | Tables/views | Nature |
|---|---|---|
| Live | `live_projects`, `live_lines`, `live_stage_history`, `live_true_up_records`, `live_change_log`, `live_user_project_role` | Physical Delta tables, refreshed from Lakebase CDC by `refresh_silver_gold` |
| Historical | `historical_projects`, `historical_lines`, `historical_stage_history`, `historical_true_up_records`, `historical_change_log` | Static synthetic data (25 closed projects), written once |
| Union | `v_projects`, `v_lines`, `v_stage_history`, `v_true_up_records`, `v_change_log` | Views unioning live + historical with a `data_origin` column — see "Data freshness" below for how the live half is actually computed |
| Gold | `gold_line_status`, `gold_project_rollup` | Views over the union views — see "Data freshness" |
| ML | `ml_stage_transition_features`, `gold_ml_predictions` | Physical Delta tables, batch-built by the ML notebooks |

### Table and column comments

Every table and view in the catalog carries a `COMMENT` — on the object
itself and on every one of its columns — applied via inline `COMMENT`
clauses directly in the DDL files (`src/sql/ddl/01`-`06_*.sql`), so a fresh
deploy is fully self-documenting with no separate backfill step. `v_*`/
`gold_*` views carry their own full column comments rather than relying on
lineage back to `live_*`/`historical_*`, since Genie and UC search both read
a column's comment on the exact object being queried, not an upstream one.
The only columns without comments are the `lb_*_history` CDC landing
tables' own Lakehouse Sync technical metadata (`_pg_change_type`/`_pg_lsn`/
`_pg_xid`/`_timestamp`/`_sort_by`) and their business columns (already fully
commented one hop downstream, on `live_*` and the `v_*` views that read
them) — those 6 tables still get a table-level `COMMENT` (`06_cdc_landing_
table_comments.sql`).

**Column-level grain** (real S3D/P&ID/line-list vocabulary, not generic
placeholders):

- **`*_projects`** (1 row/project): `project_id`, `project_name`,
  `client_name`, `site_location`, `project_type`, `status`,
  `target_line_count`, `created_at`, `closed_at`.
- **`*_lines`** (1 row/line, current snapshot): `line_id`, `project_id`,
  `line_no`, `service`, `origin_tag`, `destination_tag`,
  `area_package_zone`, `line_class_spec`, `nominal_size_in`,
  `schedule_thickness`, `material`, `design_pressure_psig`,
  `design_temperature_f`, `operating_pressure_psig`,
  `operating_temperature_f`, `corrosion_allowance_in`, `insulation_type`,
  `insulation_thickness_in`, `heat_tracing_flag`, `heat_tracing_spec`,
  `end_connections`, `flange_rating`, `pid_reference`,
  `isometric_drawing_no`, `estimated_centerline_length_ft`,
  `special_notes`, `current_stage` (1-6), `is_complete`, `created_by`,
  `created_at`, `updated_at`.
- **`*_stage_history`** (append-only audit trail): `event_id`, `line_id`,
  `project_id`, `stage_number`, `stage_name`, `event_type`, `actor_email`,
  `actor_role`, `event_timestamp`, `notes`.
- **`*_true_up_records`** (≤2 rows/line — `PRELIMINARY`/`FINAL`):
  `true_up_id`, `line_id`, `project_id`, `true_up_type`,
  `estimated_centerline_length_ft`, `actual_centerline_length_ft`,
  `length_variance_pct`, `fitting_detail`/`valve_detail`/`support_detail`
  (JSON `[{type,size,estimated_qty,actual_qty}]`), weld/flange counts, MTO
  weight/cost estimated+actual, isometric/P&ID refs, `performed_by`,
  `performed_at`, `confirmed_by`, `confirmed_at`.
- **`*_change_log`** (0..N rows/true-up): `change_id`, `true_up_id`,
  `line_id`, `reason_category` (`DESIGN_CHANGE`/`CONSTRUCTABILITY`/
  `ESTIMATING_ERROR`/`OTHER`), `reason_text`, `changed_by`, `changed_at`.
- **`live_user_project_role`** (1 row/user×project): `user_email`,
  `project_id`, `role`, `assigned_by`, `assigned_at`.

**Gold layer:**
- **`gold_line_status`** — one row per line: line record + latest stage-history
  event + true-up variance summary. Feeds the Kanban board and dashboard.
- **`gold_project_rollup`** — one row per project: `mode_stage` (most common
  stage among incomplete lines — the timeline's headline marker), `min_stage`
  (the laggard), `pct_lines_complete`, `avg_days_in_current_stage`,
  `total_lines`.

### Lakebase Postgres schema

Six tables in the `production` branch's `databricks_postgres` database,
`public` schema, mirroring the live-Delta column shape: `projects`,
`user_project_role`, `lines`, `stage_events`, `true_up_records`,
`change_log`. `lines.current_stage` is denormalized, updated in the same
transaction as the `stage_events` insert that advances it. Every table has
`REPLICA IDENTITY FULL` set at creation (`src/sql/lakebase/00_schema.sql`) —
required for CDC.

**The 6 stage actions, exactly what each writes:**

| # | Action | Actor | Writes |
|---|---|---|---|
| 1 | Initial Data Entry | Estimator | `INSERT lines` + `INSERT stage_events` (1). Editable/deletable by the Estimator until stage 2. |
| 2 | Initial Engineer Confirmation | Lead Engineer | `INSERT stage_events` (2) |
| 3 | Preliminary True-Up Complete | Design Lead | `INSERT true_up_records` (PRELIMINARY) + `INSERT change_log` (0..N) + `INSERT stage_events` (3) |
| 4 | Engineer Prelim True-Up Confirmation | Lead Engineer | `UPDATE true_up_records` (confirm) + `INSERT stage_events` (4) |
| 5 | Final True-Up Complete | Design Lead | `INSERT true_up_records` (FINAL) + `INSERT change_log` + `INSERT stage_events` (5) |
| 6 | Engineer Final Confirmation | Lead Engineer | `UPDATE true_up_records` (confirm) + `UPDATE lines SET is_complete=true` + `INSERT stage_events` (6) |

### Lakebase → Delta CDC (Lakehouse Sync)

Lakehouse Sync (`databricks postgres create-cdf-config`) replicates every
row-level change from the 6 Postgres tables into Delta CDC landing tables —
`lb_<table>_history`, each carrying `_pg_change_type`, `_pg_lsn`, `_pg_xid`,
`_timestamp`, `_sort_by`. This lands within a couple of seconds of the
Postgres write (measured directly, not assumed).

### Data freshness: the dashboard and Genie are always live

`v_projects`/`v_lines`/`v_stage_history`/`v_true_up_records`/`v_change_log`
compute their **live half directly from the `lb_*_history` CDC tables**, at
query time — a `ROW_NUMBER() OVER (PARTITION BY <pk> ORDER BY _pg_lsn DESC)`
window keeping only each primary key's latest non-deleted state, unioned with
the static historical tables. `gold_line_status`/`gold_project_rollup` are
views built on top of those — not physical tables. Since the dashboard's
dataset SQL and every Genie per-project view already just say `SELECT ...
FROM gold_line_status`/`v_stage_history` by name, both are always live with
no batch job in their path at all: a write lands in the CDC tables within
seconds, and the very next query against the dashboard or a Genie agent sees
it.

`refresh_silver_gold` still exists and still runs (manual, or chained after
`simulate_new_data`/`reset_poc`) — narrowed in scope to just
`live_lines`/`live_projects`, which `ml_batch_inference` reads directly as
physical tables rather than through a CDC-computed view. A stable,
periodically-refreshed snapshot is the right thing for batch ML scoring
(you don't want a scoring pass recomputing against data shifting mid-run);
it is not the right thing for a dashboard, which is why the two paths are
architecturally different. This is also why `gold_ml_predictions`
(ML-predicted ETAs) does *not* share the dashboard's always-live property —
see the README's "Known limitations".

**Trade-off:** the CDC tables are append-only and never pruned, so the
"latest per PK" computation scans more rows as history accumulates. Fine at
this PoC's scale (sub-3-second query time); a real long-running deployment
would eventually want periodic CDC history pruning.

## Application (AppKit / Node / React)

### Pages

- **`/`** — Project picker. Lists only projects the caller has a currently
  eligible role on (or all 5, if Admin-eligible); shows the signed-in
  identity and eligible-role badges.
- **`/projects/:projectId`** — 6-stage timeline, role badge with bounded
  "view as" switcher (Admin-eligible only), a Project Insights card (tabbed
  dashboard embed with its own native "Ask Genie" button), Kanban board.
- **`/projects/:projectId/lines/:lineId`** — Line detail slide-over: full
  record, stage history, true-up baseline-vs-actual, the one action button
  for whatever stage the line is at (rendered only if the effective role
  matches), Edit/Delete for the Estimator on a not-yet-confirmed line.
- **`/admin`** — Admin-only: assign/revoke per-project role assignments; a
  static role↔group reference. No project create/edit (see README).

### Authorization

`getEffectiveRole(user, projectId, session)` (`server/lib/roles.ts`) is the
single function backing both UI gating and every write route's server-side
check:

1. Resolve the caller's real group memberships via the OBO-authenticated
   SCIM `Me` call (`server/lib/auth.ts`), narrowed to a single role if the
   forwarded access token carries an `ag` (assumed group) claim — see
   "Account-level RBAC" below.
2. Look up `user_project_role` for `(user, projectId)`; honor it only if
   that role is also currently eligible (a defensive re-check: revoking
   group membership immediately invalidates a stale assignment).
3. If a "view as" override is set and is one of the eligible roles, return
   that instead.
4. Admins get access to any project even with no explicit assignment row.

**Reconciliation rule:** group membership = coarse eligibility ("which roles
can this person ever hold"); `user_project_role` = the actual per-project
assignment. `/admin` writes intent; `getEffectiveRole` is the only place
enforcement actually happens — an assignment for a role the target user
isn't group-eligible for simply has no effect, rather than being validated
(or not) at write time.

**"View as" — bounded, not a superuser bypass:** visible only to
Admin-eligible users; only ever offers roles the caller is actually
group-eligible for.

### Account-level RBAC and the `ag` claim

Role groups are **account-level**, not workspace-local — this is what lets
a user select/assume a specific role at login (Databricks' native RBAC
"assume role" feature) rather than always authenticating as themselves and
relying on the in-app switcher. When a caller goes through a fresh OAuth
authorization flow and picks a role during it, the resulting forwarded
access token's JWT carries an `ag` claim with that role's backing group ID
(a numeric string, e.g. `"153366456771408"` — not a display name).
`getRequestIdentity` decodes this directly and, when present, resolves it to
a display name by matching it against the SAME SCIM `Me` call's
`groups[].value` field (SCIM `Me` returns `{display, value, $ref}` per
group, and `value` is exactly the same numeric-string format as `ag`) —
**not** a hardcoded, account-specific ID-to-name table, since a caller can
only ever assume a group they are themselves already a member of, which
SCIM `Me` always includes. This is what makes the mechanism portable to any
account's groups with zero config: there is nothing account-specific to set
up beyond creating the 4 groups themselves (see `SETUP.md`).

This claim only appears via a genuinely fresh authorization exchange (e.g.
an incognito window, or explicitly signing out first) — an already
logged-in session's in-workspace role switcher, or a URL parameter against
an already-authenticated session, doesn't trigger a new token exchange and
so never carries it. Absent `ag` (the common case — a normal logged-in
session), behavior is unchanged: full group membership, exactly as SCIM
reports it.

## Dashboards + Genie (one pair per project)

Each live project has its own Lakeview dashboard (KPIs, stage-breakdown bar
chart, completion pie, line-detail table) hardcoded to that project's
`project_id` — no interactive filter needed — and natively linked via
`uiSettings.genieSpace.overrideId` to that project's own curated Genie agent.
One dashboard, one agent, one project, one integrated surface: the
dashboard's own built-in "Ask Genie" button is already correctly scoped, so
there's no separate in-app chat surface. Both are generated from a single
template (`build_dashboard_config.py` / `build_agent_config.py`) — one
project_id substitution away from another `.lvdash.json`/`.geniespace.json`
pair, both deployed as native DABs resources.

Genie agents run under a shared space identity (not per-asking-user OBO), so
per-project isolation is static: each agent is scoped to 4 views filtered by
literal `project_id` — `vw_genie_<project>_lines`, `_stage_history`,
`_true_up` (joined with change-log detail), `_predictions` — deliberately
broader than the dashboard's own aggregated tables (full audit trail: who
confirmed what and when, true-up reconciliation detail, not just KPIs).
Access to each space is granted at `CAN_RUN` to all 4 role groups.

## ML pipeline

- **Training grain:** line × stage-transition. ~5,300 rows from the 25
  historical closed projects, XGBoost regressor on `log(duration_hours)`,
  tuned via 20 Optuna trials. Held-out performance: R² ≈ 0.86 (log scale),
  MAE ≈ 11 hours. Registered to UC (`stage_duration_model`) with a `@prod`
  alias.
- **Batch inference:** loads the `@prod` model, scores every live in-flight
  line's current stage and iteratively rolls forward through remaining
  stages for an estimated completion timestamp, writes
  `gold_ml_predictions` (full overwrite per run). Surfaces as the Kanban ETA
  column, a dashboard KPI, and each project's Genie `_predictions` view.

## Simulation & reset jobs

Both manual-trigger only (no schedule).

- **`simulate_new_data`**: connects to Lakebase the same way the app does
  (OAuth database credential + psycopg2), inserts a few new stage-1 lines
  and advances a random sample of in-flight lines by one stage each — the
  same write shape as the app's own stage-action routes — deliberately
  through Lakebase, not straight to Delta, so it exercises the real CDC
  path. Chains `refresh_silver_gold` then `ml_batch_inference`.
- **`reset_poc`**: deletes all 6 Lakebase tables (safe unconditionally —
  they hold only these 5 projects' data) and replays a frozen,
  deterministic seed file verbatim, restoring the exact original baseline.
  Same chaining.

Historical tables are never touched by either job.

## v2 shell (S3D write-back)

A clearly-marked stub (`src/app/server/integrations/s3d.ts` pattern): a
placeholder function called (but no-op) from the stage-action routes, so
wiring up a real SQL Server connection later is a localized change. No live
connection exists.
