# SETUP.md — Deploying this PoC in a new workspace/account

This is a from-scratch deployment guide. Follow it in order — later steps
depend on earlier ones (the DDL in step 5 depends on CDC being live from
step 4; the app in step 8 depends on the dashboards in step 7, etc.).

Everything here is a one-time setup action. Day-to-day usage after setup is
just `databricks bundle deploy` (code changes) and the demo jobs
(`simulate_new_data`, `reset_poc`) described in `docs/DEMO_SCRIPT.md`.

**Time estimate:** ~45-60 minutes, mostly waiting on jobs/CDC propagation,
not hands-on-keyboard time.

## 0. Prerequisites

- Databricks CLI ≥ v1.17.0 (`databricks --version`), authenticated to the
  target workspace (`databricks auth profiles` — note the profile name,
  you'll pass it explicitly on every command below, e.g. `--profile acme`).
- An existing Unity Catalog **catalog** you can create schemas in (`CREATE
  SCHEMA` privilege). This bundle does not create a catalog.
- A SQL warehouse (serverless or classic) — note its ID (`databricks
  warehouses list --profile acme`), or create one.
- **Lakebase** enabled for this workspace/account (Postgres Autoscaling —
  check with your Databricks contact if unsure).
- Account-admin access (or someone who has it) for step 2 — creating
  account-level groups requires it. Everything else only needs normal
  workspace permissions.
- `jq` installed locally (used in a couple of commands below) — optional,
  you can also just read the JSON output by eye.

## 1. Pick your names, set the bundle variables

Open `databricks.yml` and edit the `variables:` block's `default:` values
(or override every command below with `--var="catalog=...,schema=..."` —
editing the file once is simpler):

| Variable | What it is | This repo's example |
|---|---|---|
| `catalog` | Existing UC catalog | `css_fevm` |
| `schema` | UC schema this bundle will create | `burns_piping_poc` |
| `warehouse_id` | SQL warehouse backing the app/dashboards/Genie | `a4e59a1f13ab8b9a` |
| `lakebase_project_id` | Lakebase project you'll create in step 4 | `burns-piping-poc` |
| `lakebase_branch_id` | Lakebase branch | `production` |
| `lakebase_database_id` | Lakebase database | `databricks-postgres` |
| `lakebase_endpoint_id` | Lakebase read-write endpoint | `primary` |

There is deliberately no `profile:` set in `databricks.yml`'s `dev` target —
every command below takes `--profile <yours>` explicitly.

## 2. Create the 4 account-level role groups

Role groups are **account-level** (not workspace-local) so a user can select
one at login via Databricks' native "assume role" flow (see
`docs/ARCHITECTURE.md`'s "Account-level RBAC and the `ag` claim") instead of
only via the app's in-UI "view as" switcher. None of this is a DABs
resource — account groups aren't bundle-manageable — so it's a manual,
one-time step.

Create exactly these 4 groups (names matter — they're referenced literally
in `src/app/server/lib/roles.ts`'s `GROUP_TO_ROLE` map and in
`resources/genie_spaces/*.genie-space.yml`'s `permissions:` blocks):

- `Estimator Piping`
- `Lead Engineer Piping`
- `Design Lead Piping`
- `Admin Piping`

(The " Piping" suffix avoids colliding with any other groups literally
named `Estimator`/`Admin`/etc. that may already exist in your account from
other workloads. If you'd rather use different names, this is the one place
in the whole repo you'd need to also edit — `GROUP_TO_ROLE` in `roles.ts`
and the 5 `permissions:` blocks in `resources/genie_spaces/*.yml` — to
match.)

Via the account console (**Settings → Identity and access → Groups → Add
group**), or via CLI if you have account-admin credentials configured
(`databricks account groups create --json '{"displayName": "Estimator
Piping"}' --profile <account-profile>`, repeated for all 4).

Add your test user(s) to **all 4 groups** — this is what lets one person
exercise every role via the app's "view as" switcher (and, separately, via
the account-level "assume role" login flow once you're in all 4). A real
deployment would instead put each real user in only the one group matching
their actual job.

## 3. Create the Lakebase project and apply the schema

```bash
# Create the project/branch/database (names must match what you set in
# databricks.yml's lakebase_* variables in step 1)
databricks postgres projects create --profile <yours> --json '{
  "name": "<your-lakebase-project-name>"
}'
# Note the project response's branch/database ids if they differ from the
# "production"/"databricks-postgres" defaults.

# Apply the 6-table schema (REPLICA IDENTITY FULL is set in this file —
# required for CDC, don't skip it or write your own variant without it)
databricks psql --project <your-lakebase-project-name> --profile <yours> \
  -- -f src/sql/lakebase/00_schema.sql
```

Confirm the script's own verification query at the bottom printed `full`
for all 6 tables before continuing.

## 4. Enable Lakehouse Sync (Lakebase → Delta CDC)

```bash
databricks postgres create-cdf-config \
  projects/<your-lakebase-project-name>/branches/<branch-id>/databases/<database-id> \
  <your-catalog> <your-schema> public \
  --cdf-config-id <your-lakebase-project-name>-sync --profile <yours>
```

Then verify the `lb_*_history` landing tables actually exist before moving
on (they may take a minute to appear):

```bash
databricks tables list <your-catalog> <your-schema> --profile <yours> \
  | grep lb_
```

You should see 6: `lb_projects_history`, `lb_lines_history`,
`lb_stage_events_history`, `lb_true_up_records_history`,
`lb_change_log_history`, `lb_user_project_role_history`. **Don't proceed to
step 6 until all 6 show up** — the views created there read from them
directly and will fail with `TABLE_OR_VIEW_NOT_FOUND` otherwise.

## 5. Deploy the bundle

```bash
databricks bundle validate --strict -t dev --profile <yours>
databricks bundle deploy -t dev --profile <yours>
```

This creates: the UC schema, the app (stopped — no Lakebase data yet so
there's nothing useful to show), all 7 jobs, the 5 dashboards (draft, not
yet published), and the 5 Genie spaces. `${workspace.current_user.userName}`
and `${workspace.file_path}` (DABs built-ins) mean every workspace path this
creates lands under *your* user folder automatically — nothing to edit here.

## 6. Apply the catalog/schema DDL (one-time)

```bash
databricks bundle run apply_catalog_schema_ddl -t dev --profile <yours>
```

Runs `src/sql/ddl/01`-`06_*.sql` — creates `live_*`/`historical_*` tables,
the `v_*` union views (computed from the CDC tables you confirmed in step
4), the `gold_*` views, the 20 per-project Genie views, and comments on all
of it. Safe to re-run any time; every statement is idempotent.

## 7. Grant the app's service principal access to Lakebase

```bash
# First deploy the app once so its service principal exists:
databricks apps deploy <your-app-name> --profile <yours>

# Get its client ID:
databricks apps get <your-app-name> --profile <yours> -o json | jq -r '.service_principal_client_id'

# Grant it access to the (currently empty) Lakebase tables:
databricks psql --project <your-lakebase-project-name> --profile <yours> \
  -- -v sp_client_id='<SP_CLIENT_ID>' -f src/sql/lakebase/01_grant_app_access.sql
```

## 8. Seed data

**Historical (ML training data, 25 synthetic closed projects):**

```bash
databricks bundle run synthetic_historical_seed -t dev --profile <yours>
```

**Live (the 5 demo projects you'll actually click through):**

If you want the per-project role assignment (step 2's "assume role" demo
flow) to work for *your* test user rather than this reference deployment's
(`conor.smith@databricks.com`), regenerate the seed first:

```bash
python3 src/notebooks/synthetic/generate_live_seed.py \
  --test-user-email you@yourcompany.com \
  > src/sql/lakebase/seed_live_data.sql
```

Then load it — `reset_poc` doubles as the initial load (deleting from
empty tables is a no-op, then it replays the seed file verbatim):

```bash
databricks bundle run reset_poc -t dev --profile <yours>
```

This also chains `refresh_silver_gold` + `ml_batch_inference` — give it a
few minutes.

## 9. Train the ML model

```bash
databricks bundle run ml_train_stage_duration -t dev --profile <yours>
# Then, if step 8's reset_poc chain ran before training finished:
databricks bundle run ml_batch_inference -t dev --profile <yours>
```

## 10. Wire up the dashboard IDs and republish the app

Dashboard IDs aren't knowable until after their first deploy, so
`src/app/app.yaml` ships with placeholder values that must be replaced once
(see that file's own comment):

```bash
databricks lakeview list --profile <yours> | grep -A2 "Piping Project Progress"
# or: databricks bundle summary -t dev --profile <yours>
```

Edit the 5 `DASHBOARD_ID_BM_L_00X` values in `src/app/app.yaml` with the
real ids, then:

```bash
databricks apps deploy <your-app-name> --profile <yours>
```

## 11. Publish the dashboards

`bundle deploy` only creates/updates the **draft** — the app's embedded
iframe reads the **published** version, which is a separate step, once per
dashboard (and again any time `src/dashboards/*.lvdash.json` changes):

```bash
for id in <dash-id-1> <dash-id-2> <dash-id-3> <dash-id-4> <dash-id-5>; do
  databricks lakeview publish "$id" --warehouse-id <your-warehouse-id> \
    --embed-credentials --profile <yours>
done
```

## 12. If you changed catalog/schema from the defaults: regenerate the Genie space JSON

`src/genie/*.geniespace.json`'s view identifiers are baked in at generation
time (Genie space JSON isn't processed by DABs variable substitution — same
reason dashboard/app.yaml IDs are plain literals, not `${resources...}`
references). If you kept the defaults from step 1, skip this. Otherwise:

```bash
for p in bm_l_001 bm_l_002 bm_l_003 bm_l_004 bm_l_005; do
  PID=$(echo "$p" | tr 'a-z' 'A-Z' | tr '_' '-')
  python3 src/genie/build_agent_config.py "$PID" \
    --catalog <your-catalog> --schema <your-schema> \
    > "src/genie/${p}.geniespace.json"
done
databricks bundle deploy -t dev --profile <yours>
```

## 13. Verify

- [ ] Open the app URL (`databricks apps get <your-app-name> --profile
  <yours> -o json | jq -r '.url'`). Project picker shows all 5 `BM-L-00X`
  projects.
- [ ] Open a project. Kanban board has cards in multiple stage columns
  (from the funnel-shaped seed).
- [ ] Role badge's "view as" dropdown works; each role's action button
  appears/disappears correctly per line stage.
- [ ] Dashboard tab renders real numbers (not blank — if blank, check step
  10/11; if blocked entirely, your workspace admin may need to allow this
  app's domain via the dashboard's **Share → Embed dashboard** dialog).
- [ ] Dashboard's "Ask Genie" button answers a question using real data.
- [ ] `databricks bundle run simulate_new_data -t dev --profile <yours>`,
  then refresh the dashboard tab within a few seconds (not minutes) — new
  activity should already be visible (CDC-direct freshness, see
  `docs/ARCHITECTURE.md`'s "Data freshness" section).
- [ ] `databricks bundle run reset_poc -t dev --profile <yours>` restores
  the original baseline.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `apply_catalog_schema_ddl` fails with `TABLE_OR_VIEW_NOT_FOUND` on `lb_*_history` | CDC (step 4) hasn't finished creating the landing tables yet, or `--cdf-config-id` targeted the wrong catalog/schema. |
| App's role badge shows no eligible roles for a real (non-test) user | They're not in any of the 4 account groups yet (step 2), or SCIM group sync hasn't propagated — can take a minute after group membership changes. |
| "View as"/assume-role narrows to the wrong role or none | Confirm the 4 group *names* exactly match `GROUP_TO_ROLE` in `src/app/server/lib/roles.ts` — this is the one place a renamed group (see step 2's note) must also be edited. |
| Dashboard tab blank/blocked | Steps 10-11 not done, or embedding domain not allowlisted — see the Verify checklist. |
| `ml_batch_inference` has nothing to score | `ml_train_stage_duration` (step 9) hasn't produced a `@prod`-aliased model yet. |

## What's demo content vs. infrastructure

Everything under `src/sql/ddl/`, `resources/`, `src/app/`,
`src/notebooks/{etl,setup,simulate,reset,ml}/` is infrastructure — portable
as-is once the steps above are followed. `src/notebooks/synthetic/`,
`src/sql/lakebase/seed_live_data.sql`, and the 5 `BM-L-00X` project
identities baked into the dashboard/Genie JSON are the specific demo
dataset built for this PoC — real, believable piping-engineering content,
but fabricated data, not a customer's real line list. Swapping in real data
is a separate exercise (point the app at a real S3D/line-list source — see
`docs/ARCHITECTURE.md`'s "v2 shell" section) that this guide doesn't cover.
