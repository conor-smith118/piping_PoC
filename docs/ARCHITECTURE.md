# Burns & McDonnell Piping Workflow PoC — Build Plan

## Context

Burns & McDonnell (EPC) needs a PoC Databricks App to demonstrate a piping-design
approval workflow: an Estimator enters line-list data, a Lead Engineer confirms it,
routing happens externally (S3D-style 3D design), a Design Lead trues-up the routed
quantities against the estimate, and the Lead Engineer confirms the true-up — twice
(preliminary and final). The PoC must show this as a real, usable app (not a mockup):
role-gated actions, a live project timeline/Kanban, an embedded dashboard, human input
flowing through a real CDC pipeline into the lakehouse, a trained ML model predicting
stage durations, and a curated Genie agent per project. It also needs to be demoable
repeatedly (simulate new data, reset to a clean state) and handed off via a real repo.

This is a from-scratch build — the target repo (`conor-smith118/piping_PoC`) is empty,
and no PoC infrastructure exists yet in the workspace. All product/architecture
decisions below were confirmed directly with the stakeholder across two rounds of
clarifying questions; this plan is the concrete implementation of those decisions,
firmed up against the actual `databricks-dabs`, `databricks-lakebase`,
`databricks-genie-agents`, and `databricks-aibi-dashboards` skill references and
against live workspace recon (not guessed from memory).

## Fixed naming / environment

| Item | Value |
|---|---|
| Databricks profile | `fevm-css-demo` (re-authenticated, confirmed working) |
| UC catalog.schema | `css_fevm.burns_piping_poc` (new schema in existing shared sandbox catalog) |
| Lakebase project | new dedicated project `burns-piping-poc` (not reusing any of the 8 existing unrelated projects) |
| SQL Warehouse | `cssSQL` — **re-resolve its `warehouse_id` via `databricks warehouses list` at build time**, don't hardcode |
| App name | `burns-piping-poc` |
| DABs bundle name | `burns_piping_poc` |
| GitHub repo | `conor-smith118/piping_PoC` (empty, ADMIN access, `gh` authenticated) |
| Workspace groups | `Estimator`, `Lead Engineer`, `Design Lead`, `piping_admin` — **workspace-level SCIM groups** (`databricks groups create`), not account-level. See "Auth design" below for why this is sufficient. `Admin` is deliberately avoided as a *group* name (too generic/collision-prone — the workspace already has a generic `admins` group) — the group is called `piping_admin`, but the **in-app role label/value stays "Admin"** (matches the domain vocabulary from the workflow). Only the workspace object is renamed, not the role enum users see. |

**Key structural decision:** Lakebase holds **only live-project data**. The 20-30
synthetic historical closed projects are generated directly into their own Delta
tables (same column shape as the live tables) and never touch Lakebase or CDC. A
union view reconciles the two for ML/dashboard/Genie consumption. This keeps
"reset"/"simulate" jobs structurally incapable of touching the training corpus, and
keeps the CDC surface limited to the 5 live projects.

## Repo structure (DABs monorepo)

```
piping_PoC/
├── databricks.yml
├── resources/
│   ├── schema.burns_piping_poc.yml          # UC schema (resources.Schema)
│   ├── postgres_project.burns_piping_poc.yml # Lakebase project+branch+database (resources.Postgres*)
│   ├── app.burns_piping_poc.yml
│   ├── jobs.synthetic_historical_seed.yml   # one-time: 20-30 closed projects -> Delta
│   ├── jobs.live_seed.yml                   # one-time: seed 5 live projects into Lakebase
│   ├── jobs.refresh_silver_gold.yml         # CDC history -> live_* -> gold_* (manual + chainable)
│   ├── jobs.simulate_new_data.yml           # manual-trigger only, no schedule block
│   ├── jobs.reset_poc.yml                   # manual-trigger only
│   ├── jobs.ml_train_stage_duration.yml     # manual-trigger, occasional retrain
│   ├── jobs.ml_batch_inference.yml
│   ├── dashboards.project_progress.yml
│   └── genie_spaces/
│       └── <project_id>.genie-space.yml     # one resource per live project (x5)
├── src/
│   ├── app/                    # `databricks apps init` output
│   │   ├── app.yaml
│   │   ├── client/src/{App.tsx,pages/,components/}
│   │   ├── server/server.ts    # getEffectiveRole() + 6 stage-action write routes
│   │   └── config/queries/*.sql
│   ├── dashboards/project_progress.lvdash.json
│   ├── sql/
│   │   ├── ddl/00_tables.sql ... 06_genie_project_views.sql   # schema itself is a bundle resource now
│   │   └── lakebase/00_schema.sql
│   ├── notebooks/
│   │   ├── setup/01_create_cdf_config.py    # verifies REPLICA IDENTITY FULL on all 6 tables, then enables CDF sync (no bundle resource type for this)
│   │   ├── synthetic/{generate_historical_projects,generate_live_seed}.py
│   │   ├── etl/refresh_silver_gold.py
│   │   ├── simulate/simulate_new_data.py
│   │   ├── reset/reset_poc.py
│   │   └── ml/{train_stage_duration_model,batch_score_predictions}.py
│   └── genie/
│       └── <project_id>.geniespace.json     # serialized_space per project, referenced via file_path
├── docs/{ARCHITECTURE.md,DEMO_SCRIPT.md}
└── README.md
```

**Confirmed directly against this environment's installed CLI (v1.17.0,
`databricks bundle schema`)** — DABs supports far more than assumed in the first
pass of this plan: `dashboards`, `jobs`, `apps`, `registered_models`, `volumes`,
**`schemas`** (UC schema as code — `catalog_name`/`name`/`comment`/`grants`), and
the full Lakebase hierarchy **`postgres_projects`/`postgres_branches`/
`postgres_databases`/`postgres_synced_tables`**, and — contrary to what this plan
originally claimed — **`genie_spaces`** too (`title`, `description`,
`warehouse_id`, `parent_path`, `permissions`, and either an inline `serialized_space`
or a `file_path` to a `.geniespace.json` file; round-trip an existing space with
`databricks bundle generate genie-space`). All of these are now declared as bundle
resources rather than imperative setup scripts, so `bundle deploy` alone stands up
the schema, the Lakebase project, and all 5 Genie agents — only workspace groups and
the Lakehouse Sync CDF config have no bundle resource type and stay as one-time CLI
steps in `notebooks/setup/`.

**Verify at build time:** exact bundle YAML for each of these resources against
`bundle validate --strict` (field names above are taken from the live schema, but
confirm nested shapes like `default_endpoint_settings` and `new_pipeline_spec`
before relying on them); whether `databricks apps init --features
analytics,lakebase` scaffolds cleanly into `src/app/` or needs relocating.

## Unity Catalog schema (`css_fevm.burns_piping_poc`)

**Live vs. historical, physically separate, unioned by view:**

| Live (CDC + merge job) | Historical (written once, static) |
|---|---|
| `live_projects` | `historical_projects` |
| `live_lines` | `historical_lines` |
| `live_stage_history` | `historical_stage_history` |
| `live_true_up_records` | `historical_true_up_records` |
| `live_change_log` | `historical_change_log` |

`v_projects` / `v_lines` / `v_stage_history` / `v_true_up_records` / `v_change_log`
are `UNION ALL` views over each pair, adding a literal `data_origin` column
(`LIVE` / `SYNTHETIC_HISTORICAL`). `live_user_project_role` has no historical
counterpart (synthetic projects have no interactive role assignments).

**CDC landing tables** (auto-created by Lakehouse Sync once enabled — see "Lakebase
→ Delta CDC" below): `lb_projects_history`, `lb_lines_history`,
`lb_user_project_role_history`, `lb_stage_events_history`,
`lb_true_up_records_history`, `lb_change_log_history` — each carrying
`_pg_change_type`, `_pg_lsn`, `_pg_xid`, `_timestamp`, `_sort_by`.
`refresh_silver_gold.py` dedups these (latest `_pg_lsn` per PK, excluding deletes)
into the `live_*` tables via MERGE.

**Column-level grain:**

- **`*_projects`** (1 row/project): `project_id` (PK), `project_name`, `client_name`,
  `site_location`, `project_type`, `status` (`ACTIVE`/`CLOSED`), `target_line_count`,
  `created_at`, `closed_at`.
- **`*_lines`** (1 row/piping line, current snapshot): `line_id` (PK), `project_id`
  (FK), `line_no` (e.g. `L-001`), `service`, `origin_tag`, `destination_tag`,
  `area_package_zone`, `line_class_spec`, `nominal_size_in`, `schedule_thickness`,
  `material`, `design_pressure_psig`, `design_temperature_f`,
  `operating_pressure_psig`, `operating_temperature_f`, `corrosion_allowance_in`,
  `insulation_type`, `insulation_thickness_in`, `heat_tracing_flag`,
  `heat_tracing_spec`, `end_connections`, `flange_rating`, `pid_reference`,
  `isometric_drawing_no`, `estimated_centerline_length_ft`, `special_notes`,
  `current_stage` (1-6, denormalized), `is_complete`, `created_by`, `created_at`,
  `updated_at`. (Field list from real S3D/line-list research, not generic
  placeholders.)
- **`*_stage_history`** (append-only event log — the audit/confirmation trail):
  `event_id` (PK), `line_id`, `project_id`, `stage_number` (1-6), `stage_name`,
  `event_type` (one of the 6 canonical actions), `actor_email`, `actor_role`,
  `event_timestamp`, `notes`.
- **`*_true_up_records`** (1 row per line per true-up round, max 2/line —
  `PRELIMINARY`/`FINAL`): `true_up_id` (PK), `line_id`, `project_id`, `true_up_type`,
  `estimated_centerline_length_ft`, `actual_centerline_length_ft`,
  `length_variance_pct`, `fitting_detail` (JSON `[{type,size,estimated_qty,actual_qty}]`),
  `valve_detail` (same shape), `support_detail` (same shape),
  `weld_count_estimated/actual`, `flange_count_estimated/actual`,
  `mto_weight_estimated_lb/actual_lb`, `mto_cost_estimated_usd/actual_usd`,
  `isometric_drawing_ref`, `pid_ref`, `performed_by`, `performed_at`, `confirmed_by`,
  `confirmed_at`.
- **`*_change_log`** (0..N rows per true-up): `change_id` (PK), `true_up_id` (FK),
  `line_id`, `reason_category` (`DESIGN_CHANGE`/`CONSTRUCTABILITY`/
  `ESTIMATING_ERROR`/`OTHER`), `reason_text`, `changed_by`, `changed_at`.
- **`live_user_project_role`** (1 row per user×project, CDC'd from Lakebase):
  `user_email`, `project_id`, `role`, `assigned_by`, `assigned_at`.

**Gold layer:**
- **`gold_line_status`** — `v_lines` + latest `v_stage_history` row + true-up
  variance summary. Feeds the Kanban board.
- **`gold_project_rollup`** — per-project stage histogram, `mode_stage` (most common
  stage among incomplete lines — the headline timeline marker), `min_stage` (the
  laggard, shown as a secondary stat), `pct_lines_complete`,
  `avg_days_in_current_stage`, `total_lines`, `data_origin`. Always computed live as
  an aggregate over `gold_line_status`, never hand-maintained.
- **`ml_stage_transition_features`** / **`gold_ml_predictions`** — see ML section.

## Lakebase Postgres schema

Same 6 tables (`projects`, `user_project_role`, `lines`, `stage_events`,
`true_up_records`, `change_log`) in the `production` branch's `databricks_postgres`
database, `public` schema, mirroring the live-Delta column shape.
`lines.current_stage` is a denormalized column the app must update in the **same
transaction** as any `stage_events` insert that advances a line (fast Kanban reads
without a join, at the cost of requiring write discipline — every stage-advancing
route does both writes atomically).

**`REPLICA IDENTITY FULL` is set as part of table creation itself, not a separate
step to remember later** — `src/sql/lakebase/00_schema.sql` pairs every
`CREATE TABLE` with its `ALTER TABLE ... REPLICA IDENTITY FULL;` immediately below
it, for all 6 tables, e.g.:

```sql
CREATE TABLE lines ( ... );
ALTER TABLE lines REPLICA IDENTITY FULL;

CREATE TABLE stage_events ( ... );
ALTER TABLE stage_events REPLICA IDENTITY FULL;
-- ... repeated for projects, user_project_role, true_up_records, change_log
```

This file is the single source of truth for the Lakebase schema (run once against
the new project/branch at Phase 0) — no table is ever created without its replica
identity set in the same script, so CDC can't silently be enabled against a table
that isn't ready for it.

**Mapping the 6 stage actions to exact writes** (all server-side, one transaction
each, via AppKit's Lakebase pool):

| # | Action | Actor | Writes |
|---|---|---|---|
| 1 | Initial Data Entry | Estimator | `INSERT lines` (full line-list record) + `INSERT stage_events` (stage 1) |
| 2 | Initial Engineer Confirmation | Lead Engineer | `INSERT stage_events` (stage 2) [+ optional `UPDATE lines` on correction] |
| 3 | Preliminary True-Up Complete | Design Lead | `INSERT true_up_records` (PRELIMINARY) + `INSERT change_log` (0..N) + `INSERT stage_events` (stage 3) |
| 4 | Engineer Prelim True-Up Confirmation | Lead Engineer | `UPDATE true_up_records` (confirm PRELIMINARY) + `INSERT stage_events` (stage 4) |
| 5 | Final True-Up Complete | Design Lead | `INSERT true_up_records` (FINAL) + `INSERT change_log` + `INSERT stage_events` (stage 5) |
| 6 | Engineer Final Confirmation | Lead Engineer | `UPDATE true_up_records` (confirm FINAL) + `UPDATE lines SET is_complete=true` + `INSERT stage_events` (stage 6) |

## Lakebase → Delta CDC ("Lakehouse Sync", Beta — confirmed mechanism)

This is the **opposite direction** from Lakebase "synced tables" (Delta→Postgres).
Confirmed via `databricks-lakebase`'s `lakehouse-sync.md`. `01_create_cdf_config.py`
does this in two steps, in order — **it verifies replica identity before turning
sync on, rather than assuming `00_schema.sql` was run correctly**:

1. **Verify** every one of the 6 tables in `public` actually has `relreplident =
   'f'` (full) — the same check query from the skill's reference doc — and fails
   loudly (naming the offending table) rather than proceeding if any table doesn't:

   ```sql
   SELECT c.relname AS table_name,
          CASE c.relreplident WHEN 'f' THEN 'full' ELSE 'NOT FULL' END AS replica_identity
   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind = 'r' AND n.nspname = 'public';
   ```

2. **Enable sync**, only once step 1 passes for all 6 tables:

   ```bash
   databricks postgres create-cdf-config \
     projects/<PROJECT_ID>/branches/<BRANCH_ID>/databases/<DATABASE_ID> \
     css_fevm burns_piping_poc public \
     --cdf-config-id burns-piping-poc-sync --profile fevm-css-demo
   ```

Other notes:
- `PARENT` is the database **resource path**, not the Postgres connect name.
- Works at schema granularity — one config covers all 6 tables, present and future.
- Destination catalog/schema must already exist (created in Phase 0, before this).
- Requires Postgres 17 (Lakebase default).
- `list-cdf-configs`/`list-cdf-statuses` return `NotFound` (404) when none exist yet —
  not an empty list; don't treat that as an error during setup.
- If a table is ever added to `public` later (e.g. a schema change), it needs its own
  `ALTER TABLE ... REPLICA IDENTITY FULL;` **before** it will sync — the schema-level
  CDF config covers future tables for sync *eligibility*, not their replica identity.

## AppKit app structure

Scaffold: `databricks apps init --name burns-piping-poc --features analytics,lakebase
--set analytics.sql-warehouse.id=<WH_ID> --set lakebase.postgres.branch=<...> --set
lakebase.postgres.database=<...>` — **confirm exact `--set` keys via `databricks apps
manifest` at build time.**

- **`/`** — Project picker. Lists only projects the OBO-authenticated user has any
  role on (join `gold_project_rollup` + `live_user_project_role`); Admins see all.
- **`/projects/:projectId`** — Main view: 6-stage timeline (from
  `gold_project_rollup`), role badge top-right (effective role, see Auth below),
  "View as role" dropdown next to it (Admin-group members only), that project's
  own embedded dashboard — including its built-in, natively-linked "Ask Genie"
  button (see "Dashboards + native Genie" below) — Kanban board (6 columns)
  of `gold_line_status` rows.
- **`/projects/:projectId/lines/:lineId`** — Line detail slide-over: full line-list
  record, isometric/P&ID reference links, per-line stage-history timeline, true-up
  baseline-vs-actual side-by-side when applicable, and the one action button for
  whatever stage the line is at — rendered only if `effectiveRole` matches the
  required role (Estimator→1, Lead Engineer→2/4/6, Design Lead→3/5).
- **`/admin`** — Admin-only: create/edit projects, manage `user_project_role`
  assignments (role picker restricted to roles the target user is actually a member
  of), read-only view of the 4 groups and members.

## Auth / authorization design

`getEffectiveRole(user, projectId, session)` — one function, used for both UI gating
and every write-route's server-side check:

1. Fetch the user's real group memberships via the OBO-authenticated SDK client's
   **`w.current_user.me()`** call and its `.groups[].display` field — this is
   already confirmed to return group membership on this exact API in this workspace
   (verified during recon: `databricks current-user me` returns a `groups` array).
   This sidesteps any dependency on account-level identity federation or
   `is_account_group_member()` SQL, so plain **workspace-level** SCIM groups
   (`databricks groups create`) are sufficient — no account-admin profile needed.
2. Look up `live_user_project_role` for `(user, projectId)` → the assigned role,
   but only honor it if that role is also in the group-membership list from step 1
   (defensive re-check — revoking group membership immediately invalidates a stale
   assignment, no separate cleanup needed).
3. If `session.viewAsOverride` is set **and** is one of the roles from step 1, return
   the override instead. Otherwise return the result of step 2.

**Reconciliation rule:** group membership = coarse eligibility ("which roles can this
person ever hold"); `user_project_role` = actual per-project assignment. The
`/admin` assignment UI enforces "assignment ⊆ eligibility" at write-time, so an
invalid assignment can never be created.

**"View as role" design — bounded, not a superuser bypass:** visible only to
`piping_admin`-group members (displayed in-app as the "Admin" role); the dropdown
only offers roles the tester is *actually* a group-member of.
`conor.smith@databricks.com` is added to all 4 groups (`Estimator`, `Lead Engineer`,
`Design Lead`, `piping_admin`), so this gives full testing coverage without a
separate unbounded-bypass code path that would let a demo show behavior no real
account setup could reproduce.

## Dashboards (one per project, superseded design)

**Current design (Phase 8b) — see "Dashboards + native Genie" below.** This
section is kept for history: the original plan (and Phase 5's actual build)
was **one shared** Lakeview dashboard, datasets over `gold_line_status` /
`gold_project_rollup`, with a `project_id` filter field, embedded via
`<iframe src={dashboardUrl}?f_project_id=<projectId>>`. That was replaced
once it became clear a single dashboard object can't be natively,
correctly linked to a specific project's Genie agent — see below.

## Genie agents (one per live project, static per-project views, bundle-managed)

Genie agents execute under a shared space identity, not per-asking-user OBO, so
per-project isolation must be **static, literal-`project_id` SQL views** — not a
dynamic row filter keyed on `current_user()`. Per live project `P`:

- `vw_genie_<P>_lines` = `SELECT * FROM gold_line_status WHERE project_id='<P>'`
- `vw_genie_<P>_stage_history` = `SELECT * FROM v_stage_history WHERE project_id='<P>'`
  (full audit/confirmation log — who/when/role — not just dashboard-level
  aggregates, per the explicit "broader tables, appropriately scoped" ask)
- `vw_genie_<P>_true_up` = true-up + change-log detail joined, filtered to `P`
- `vw_genie_<P>_predictions` (after the ML phase) = `gold_ml_predictions WHERE
  project_id='<P>'`

15-20 view objects total across 5 agents — comfortably under Genie's per-agent
object guidance.

**Creation/deployment — bundle-native, confirmed via `databricks bundle schema`:**
design and get approval on the **first** project's agent shape via the
`databricks-genie-agents` skill's create workflow (`discover-schema` → draft
`serialized_space` → approval → `create-space`, done once interactively, not as a
deployed job). Then run `databricks bundle generate genie-space` against that
approved space to pull its `serialized_space` into `src/genie/<project_id>.
geniespace.json` and scaffold `resources/genie_spaces/<project_id>.genie-space.yml`
(fields: `title`, `description`, `warehouse_id: ${var.warehouse_id}`, `parent_path`,
`file_path: ../../src/genie/<project_id>.geniespace.json`). Template that same shape
— substituting the per-project view names — across the remaining four projects'
resource files and `.geniespace.json`s. From then on, `databricks bundle deploy`
creates/updates all 5 agents alongside everything else; no standalone script needed.

## Dashboards + native Genie (current design, Phase 8b)

Two designs were tried and superseded before landing here — worth recording
why, since both were reasonable-looking first instincts:

1. **One shared dashboard + a `project_id` filter** (Phase 5). Simple, but a
   dashboard's native Genie link (`uiSettings.genieSpace.overrideId`) is one
   static space ID baked into the dashboard *object* — incompatible with a
   shared dashboard, since a static ID can never track which project the
   viewer currently has selected.
2. **Keep the shared dashboard, add a separate in-app Genie chat tab**
   (Phase 8a) — AppKit's `genie()` plugin with a per-project `spaces` map,
   rendered via `<GenieChat alias={project.projectId} />`. This *worked* —
   verified live, correct project-scoped answers — but every Lakeview
   dashboard also gets a **default built-in "Ask Genie" button**
   automatically (confirmed by observing one on the Phase 5 dashboard, which
   had no `uiSettings.genieSpace` configured at all — the field's own name,
   "**override**Id", implies a default exists to override). Two "Ask Genie"
   entry points on the same page reads as a bug, not a feature.

**Current design: one dashboard per project**, each natively linked to that
project's own agent — a single integrated surface, no separate chat tab:

- `src/dashboards/build_dashboard_config.py` generates 5 near-identical
  dashboards from the Phase 5 template, for each project: (a) hardcodes
  `AND project_id = '<project_id>'` into both dataset queries (no
  interactive filter widget needed — mirrors the static per-project Genie
  views from Phase 7), (b) sets
  `uiSettings.genieSpace = {isEnabled: true, overrideId: <that project's
  real Genie space ID>, enablementMode: "ENABLED"}`. Space IDs are hardcoded
  literals (same reasoning as `DASHBOARD_ID` originally being one) — a
  `file_path`-loaded dashboard JSON is opaque to bundle variable
  substitution, so `${resources.genie_spaces...}` can't reach inside it.
- `resources/dashboards/*.dashboard.yml` (5 files, resource keys
  `dash_bm_l_00N` — plain `bm_l_00N` collides with the genie_spaces resource
  of the same name) — `bundle deploy` creates/updates all 5; each still
  needs a separate `databricks lakeview publish --embed-credentials` after
  any change (bundle deploy only updates the draft).
- `server/routes/config.ts`'s `/api/config` now takes a `projectId` query
  param and looks up that project's own dashboard ID from 5 env vars
  (`DASHBOARD_ID_BM_L_00N`, set as plain literals in `app.yaml` — no AppKit
  "dashboard" resource type exists to bind them via `valueFrom`).
  `DashboardEmbed.tsx` calls it per-project instead of appending a filter
  query parameter to one shared dashboard URL.
- Phase 8a's `genie()` plugin, `GenieAssistant.tsx`, `dashboards.genie` OBO
  scope, and the 5 `genie_space` app-resource bindings were all removed —
  the app itself no longer talks to the Genie Conversation API at all. The
  `CAN_RUN` permission grants on each Genie space
  (`resources/genie_spaces/*.genie-space.yml`) stayed, since real end users
  still need that permission to use each dashboard's built-in Genie button,
  regardless of which mechanism reaches the space.

**Verified live:** each dashboard's `uiSettings.genieSpace.overrideId`
matches its project's real Genie space ID (checked via `lakeview get` for
BM-L-001 and BM-L-005), and each dashboard's own dataset queries return
exactly that project's line count (BM-L-001 → 22, BM-L-005 → 15) rather than
all 5 projects' data. Not yet confirmed in an actual browser: clicking the
built-in "Ask Genie" button itself (see README "Known follow-ups").

## ML pipeline

- **Training grain:** line × stage-transition, not project — 20-30 historical
  projects × ~20-60 lines × 6 transitions ≈ 3,000-10,000 rows, workable for a
  gradient-boosted regressor. Generate via Faker/Spark (`databricks-synthetic-data-gen`
  conventions): stage durations log-normal, correlated with size/material/complexity,
  with a deliberate subset of large-NPS/exotic-material lines taking longer at
  true-up stages (gives the model — and the demo narrative — something real to find).
- **Feature table `ml_stage_transition_features`:** `project_id`, `line_id`,
  `stage_number`, `stage_name`, `stage_entry_ts`, `stage_exit_ts` (null if in-flight),
  `duration_hours` (label, null if in-flight), line attributes (`nominal_size_in`,
  `material`, `line_class_spec`, `service`, `insulation_type`, `heat_tracing_flag`,
  `estimated_centerline_length_ft`), project attributes (`num_lines_in_project`,
  `project_type`), `data_origin`.
- **Model:** one XGBoost regressor predicting `log(duration_hours)`, `stage_number`
  as a categorical feature, trained only on fully-completed historical transitions
  (no censoring needed — historical projects are closed). `mlflow.xgboost.autolog()`
  + Optuna, registered to UC as `css_fevm.burns_piping_poc.stage_duration_model`,
  `@prod` alias — the `databricks-ml-training` skill's canonical flow. No Feature
  Store/`FeatureLookup` (none of its triggers apply to a PoC at this scale) — plain UC
  table.
  - *Deferred to v2:* one model per stage (6 small models); proper survival analysis
    for in-flight/censored lines.
- **Batch inference:** loads `models:/.../stage_duration_model@prod` via
  `mlflow.pyfunc.spark_udf`, scores every live line's current open transition, then
  iteratively rolls forward through remaining stages for an estimated completion
  date. Writes `gold_ml_predictions` (project_id, line_id, current_stage,
  predicted_remaining_hours, predicted_completion_ts, model_version, scored_at) —
  overwrite per run. Surfaces as an "Est. completion" Kanban column, a dashboard KPI,
  and the `vw_genie_<P>_predictions` view. Chained as a `run_job_task` at the end of
  `simulate_new_data` (and kept independently runnable) — not on its own schedule, so
  scores don't shift mid-demo unexpectedly.

## Simulation & reset jobs

Both jobs have **no `schedule`/`trigger` block** — manual-only (`run-now` via
CLI/Jobs UI), per the requirement.

- **`simulate_new_data`**: (1) `generate_increment` notebook — connects to Lakebase
  the same way the app does (`w.postgres.generate_database_credential` OAuth token +
  psycopg2), inserts a few new stage-1 lines and advances a sample of existing lines
  one stage (writing the matching `stage_events`/`true_up_records`/`change_log` rows
  + updating `lines.current_stage`) across the 5 live projects — deliberately through
  Lakebase, not straight to Delta, so every simulate run exercises the real CDC path
  (the core "watch it flow through" demo moment); (2) `refresh_silver_gold`
  (`depends_on` #1); (3) `run_job_task → ml_batch_inference` (optional/skippable).
- **`reset_poc`**: (1) `reset_lakebase` notebook — row-level `DELETE ... WHERE
  project_id IN (<5 ids>)` (not `TRUNCATE` — **verify at build time** whether
  `TRUNCATE` even emits CDC events under this Beta mechanism) across all 6 tables,
  then re-`INSERT`s a **frozen seed snapshot** generated once at initial setup and
  stored as static seed SQL/Parquet (never re-randomized on reset, for reproducible
  demos); (2) `reset_delta` — re-runs `refresh_silver_gold` + clears
  `gold_ml_predictions` for live rows; (3) `run_job_task → ml_batch_inference` so
  reset leaves fresh baseline predictions rather than an empty table.

Historical tables are never touched by either job.

## v2 shell (S3D write-back)

A clearly-marked stub, e.g. `src/app/server/integrations/s3d.ts`:
`pushToS3D(lineId, payload)` — TODO comments, commented-out example connection code
(pyodbc/SQL-Server-style), called (but no-op) from the stage-action routes so wiring
it up later is a localized change, not a new integration point. No real connection —
confirmed placeholder-only per stakeholder.

## Build sequencing (9 phases, 5 stakeholder checkpoints)

| Phase | Scope | Notes |
|---|---|---|
| 0 | Bundle-deploy UC schema + Lakebase project/branch/database (bundle resources), table DDL, workspace groups (`Estimator`/`Lead Engineer`/`Design Lead`/`piping_admin`) + membership | Sequential — everything depends on this |
| 1 | Synthetic historical data (20-30 closed projects) + live seed snapshot | Parallel with Phase 2 |
| 2 | App skeleton: `apps init`, picker + project-view shell, OBO + `getEffectiveRole`, nav | Parallel with Phase 1 |
| 3 | All 6 stage-action forms (writing to Lakebase), Kanban wired, role-gating | After Phase 2 |
| 4 | Lakebase CDC wiring (`create-cdf-config`), `refresh_silver_gold`, verify write→CDC→gold end-to-end | After Phase 3 |
| 5 | Dashboard build + embed | Parallel with Phase 4 once Phase 1's historical gold data exists |
| 6 | ML training + batch inference | After Phase 4 (live gold data) and Phase 1 (historical data) |
| 7 | Design+approve 1st Genie agent, `bundle generate genie-space`, template to remaining 4 as bundle resources | Parallel with Phase 6, after Phase 4 |
| 8 | `simulate_new_data` + `reset_poc` jobs | After Phase 4 (must exercise real CDC) |
| 9 | Polish: `/admin`, view-as-role switcher, demo script rehearsal | Last |

**Checkpoints:** (1) after Phase 0-1 — schema + realistic historical data to review;
(2) after Phase 2-3 — app clickable end-to-end against Lakebase, pre-CDC; (3) after
Phase 4-5 — the "wow" moment: a form submission flows through CDC into a live
dashboard; (4) after Phase 6-7 — predictive ETAs + a working Genie agent; (5) after
Phase 8-9 — full rehearsal: simulate → observe → reset → repeat.

## Critical files

- `piping_PoC/databricks.yml`
- `piping_PoC/resources/schema.burns_piping_poc.yml`,
  `resources/postgres_project.burns_piping_poc.yml`
- `piping_PoC/src/sql/ddl/01_live_tables.sql` (+ `02_historical_tables.sql`,
  `03_union_views.sql`, `04_gold_tables.sql`, `06_genie_project_views.sql`)
- `piping_PoC/src/sql/lakebase/00_schema.sql`
- `piping_PoC/src/notebooks/etl/refresh_silver_gold.py`
- `piping_PoC/src/app/server/server.ts` (`getEffectiveRole` + the 6 write routes)
- `piping_PoC/resources/jobs.simulate_new_data.yml`, `jobs.reset_poc.yml`
- `piping_PoC/resources/genie_spaces/<project_id>.genie-space.yml` (x5) +
  `piping_PoC/src/genie/<project_id>.geniespace.json` (x5)

## Verification (end-to-end, per checkpoint)

1. **Schema/data (Ckpt 1):** `databricks experimental aitools tools query` against
   `historical_lines`/`historical_stage_history` — row counts (≥20 projects, sane
   line counts), spot-check a few full line lifecycles.
2. **App skeleton (Ckpt 2):** log in as the test user, confirm project picker shows
   only assigned projects, submit each of the 6 stage actions as the right role and
   confirm a wrong-role attempt is rejected server-side (not just hidden in the UI).
3. **CDC + dashboard (Ckpt 3):** submit a stage action in the app, poll
   `lb_stage_events_history`/`get-cdf-status` until the row lands, run
   `refresh_silver_gold`, refresh the embedded dashboard and confirm the number
   moved.
4. **ML + Genie (Ckpt 4):** run the training job, confirm `@prod` alias set; run
   batch inference and confirm `gold_ml_predictions` has a row per live in-flight
   line; ask each project's Genie agent a project-specific question and confirm it
   can't see another project's lines.
5. **Simulate/reset (Ckpt 5):** run `simulate_new_data`, confirm new/advanced lines
   appear in the app and dashboard; run `reset_poc`, confirm state matches the frozen
   seed exactly (row counts + a spot-checked line back at stage 1).
