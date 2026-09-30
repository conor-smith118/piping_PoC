# Burns & McDonnell Piping Workflow PoC

A Databricks App PoC modeling an EPC piping-design approval workflow: Estimators
enter line-list data, Lead Engineers confirm it, Design Leads true-up routed
quantities against the estimate (preliminary and final), and Lead Engineers
confirm each true-up. Built as a Databricks Asset Bundle (DABs) — Databricks App
(AppKit/React) + Lakebase (OBO human data entry) + CDC into Unity Catalog +
AI/BI dashboard + ML stage-duration model + per-project Genie agents.

See `docs/ARCHITECTURE.md` for the full design and `docs/DEMO_SCRIPT.md` for how
to run a live demo (simulate new data, observe it flow through, reset).

## Environment

| Item | Value |
|---|---|
| Databricks profile | `fevm-css-demo` |
| UC catalog.schema | `css_fevm.burns_piping_poc` |
| Lakebase project | `burns-piping-poc` (branch `production`, database `databricks-postgres`) |
| SQL Warehouse | `cssSQL` (`a4e59a1f13ab8b9a`) |
| Account-level groups | `Estimator Piping`, `Lead Engineer Piping`, `Design Lead Piping`, `Admin Piping` (in-app role labels stay "Estimator"/"Lead Engineer"/"Design Lead"/"Admin" — see `ARCHITECTURE.md`) |

## Deploying

```bash
databricks bundle validate --strict -t dev --profile fevm-css-demo
databricks bundle deploy -t dev --profile fevm-css-demo
```

The bundle's `dev` target uses `mode: production` (not `development`) deliberately —
this is a single stable environment, not a multi-developer sandbox, and
`development` mode's automatic resource-name prefixing (e.g. `dev_<user>_...`)
would rename the UC schema away from the literal name every other resource in
this repo references.

## Status

- [x] Phase 0 — UC schema, Lakebase project + Postgres schema (REPLICA IDENTITY
      FULL confirmed on all 6 tables), live/historical/gold Delta tables + union
      views, workspace groups + membership
- [x] Phase 1 — synthetic historical data (25 closed projects, 882 lines) via a
      Lakeflow Job (`synthetic_historical_seed`), and a frozen live-data seed
      (5 active projects, 93 lines spread across all 6 stages) applied to
      Lakebase from `src/sql/lakebase/seed_live_data.sql`
- [x] Phase 2-3 — AppKit app deployed and live at
      https://burns-piping-poc-7405608145506562.2.azure.databricksapps.com —
      OBO identity + group-membership auth (`server/lib/auth.ts`), per-project
      role resolution + bounded "view as" switcher (`server/lib/roles.ts`),
      project picker, 6-stage timeline, Kanban board, line detail panel, and
      all 6 stage-action routes (each a single Lakebase transaction). Verified
      live end-to-end: reads, a role-gated write correctly rejected (403) then
      accepted after switching view-as, and the resulting stage transition
      persisted correctly. See `src/sql/lakebase/01_grant_app_access.sql` —
      required once after first deploy so the app's service principal can
      read/write the tables created in Phase 0.
- [x] Phase 4 — Lakebase → Delta CDC wiring. Lakehouse Sync CDF config
      (`burns_piping_poc_sync`) enabled against `public`; all 6
      `lb_*_history` tables confirmed `CDF_STATE_STREAMING`.
      `refresh_silver_gold` (Lakeflow Job) dedups them into `live_*` and
      rebuilds `gold_line_status` / `gold_project_rollup`. Verified live: the
      Phase 2-3 checkpoint's test write is correctly reflected in
      `gold_line_status` after running the job.
- [x] Phase 5 — dashboard (superseded by Phase 8b below — see that entry
      for the current design). Originally one shared, `project_id`-filtered
      dashboard; this turned out to be incompatible with natively linking a
      per-project Genie agent (Lakeview's Genie link is one static ID baked
      into the dashboard object).
- [x] Phase 6 — ML model. `ml_train_stage_duration` (Lakeflow Job): builds
      `ml_stage_transition_features` from historical closed projects (~5,300
      rows), trains an XGBoost regressor on `log(duration_hours)` via 20
      Optuna trials, registers `css_fevm.burns_piping_poc.stage_duration_model`
      to UC with a `@prod` alias. `ml_batch_inference`: scores every live
      in-flight line's current + remaining hypothetical stages, rolls up an
      estimated completion timestamp, writes `gold_ml_predictions` (83 rows
      after the first run). Hit and fixed 5 real issues along the way —
      `xgboost`/`optuna` not pre-installed on serverless, and a cluster of
      int32-vs-int64 / bool-vs-int dtype mismatches between Spark's
      `.toPandas()` output and plain-Python reconstruction — see the comments
      in `train_stage_duration_model.py` / `batch_score_predictions.py`.
      **Note:** `set_registered_model_alias` silently no-op'd inside the
      training notebook (unclear why — the run reported success with no
      error); the `@prod` alias was set manually via
      `databricks registered-models set-alias`. Re-verify after any retrain.
- [x] Phase 7 — Genie agents. One curated agent per live project (5 total),
      each scoped to 4 static per-project views (`vw_genie_<project>_lines` /
      `_stage_history` / `_true_up` / `_predictions`,
      `src/sql/ddl/05_genie_project_views.sql`) — full audit trail and
      true-up detail, not just the dashboard's aggregated metrics, per the
      "broader tables, appropriately scoped" ask. Designed once against
      BM-L-001 (column_configs, 5 example-query shapes, 32-item benchmark
      suite per agent — all 185 SQL statements across all 5 agents validated
      against the real warehouse before any agent was created), then
      templated via `src/genie/build_agent_config.py`. Managed as code via
      `resources/genie_spaces/*.genie-space.yml` + `src/genie/*.geniespace.json`
      — `bundle deploy` creates/updates all 5. Verified live: asked each
      agent a real question, got correct answers with clean generated SQL.
- [x] Phase 8a — per-project Genie chat in the app (**built, then
      reverted**). Added AppKit's `genie()` plugin with a `spaces` map keyed
      by `project_id`, plus a `GenieChat` panel on a new "Ask Genie" tab.
      Verified live and worked correctly — but once live, it sat alongside
      each dashboard's own default "Ask Genie" button, which felt like two
      competing Genie entry points. Superseded by Phase 8b.
- [x] Phase 8b — one dashboard per project, natively linked to that
      project's Genie agent (Option B — replaces both Phase 5's shared
      dashboard and Phase 8a's in-app chat tab). 5 dashboards
      (`src/dashboards/project_progress_bm_l_00N.lvdash.json`, templated by
      `build_dashboard_config.py`), each hardcoded to its own `project_id`
      (no interactive filter needed) and linked via
      `uiSettings.genieSpace.overrideId` to that project's Phase 7 Genie
      agent — so the dashboard's own built-in "Ask Genie" button is
      correctly, statically scoped per project, with no second chat surface
      in the app. `resources/dashboards/*.dashboard.yml` (`bundle deploy`
      creates/updates all 5); `DashboardEmbed.tsx` now looks up the right
      dashboard ID per project via `/api/config?projectId=...`
      (`server/routes/config.ts`) instead of appending a filter parameter to
      one shared dashboard. Verified live: each dashboard's
      `uiSettings.genieSpace.overrideId` matches its project's real Genie
      space ID, and each dashboard's dataset queries are hardcoded to that
      project's own line count (spot-checked BM-L-001 → 22 lines, BM-L-005 →
      15 lines, matching each project's real row count).
- [x] Phase 9 — simulate/reset jobs + polish.
      **`simulate_new_data`** (`src/notebooks/simulate/simulate_new_data.py`):
      connects to Lakebase via `w.postgres.generate_database_credential` +
      psycopg2, inserts 3-8 new stage-1 lines and advances a random sample of
      in-flight lines by one stage each (same write shape as the app's own
      stage-action routes) — chains `refresh_silver_gold` then
      `ml_batch_inference` via `run_job_task`.
      **`reset_poc`** (`src/notebooks/reset/reset_poc.py`): unconditionally
      `DELETE`s all 6 Lakebase tables (child-to-parent FK order — safe
      because Lakebase holds *only* these 5 projects' data) and replays
      `seed_live_data.sql` verbatim, then chains the same two jobs. Both are
      manual-trigger only (no `schedule` block). **Verified live end-to-end:**
      ran `simulate_new_data` (93→100 lines, 7 new `-SIM-` lines, predictions
      83→90), then `reset_poc` (back to exactly 93 lines, 0 `-SIM-` lines,
      predictions back to exactly 83 — matching Phase 6's original recorded
      count byte-for-byte).
      **`/admin`** (`server/routes/admin.ts`, `pages/Admin.tsx`): Admin-only
      page to assign/revoke per-project role assignments across all 5
      projects, plus a static role↔group reference. Deliberately no project
      create/edit (see `ARCHITECTURE.md`). Verified live: full
      assign→list→revoke round-trip against the real API.
      **`docs/DEMO_SCRIPT.md`** rewritten from a placeholder into a concrete,
      timed walkthrough covering every phase.
- [x] Phase 10 — migrated the 4 role groups from workspace-local to
      **account-level** SCIM groups: `Estimator Piping`, `Lead Engineer Piping`,
      `Design Lead Piping`, `Admin Piping` (the account already had unrelated
      groups literally named `Estimator` etc., hence the suffix). Workspace-local
      groups can't be selected/assumed at login, which is what actually
      motivated this — see `ARCHITECTURE.md`'s "Workspace-local -> account-level
      group migration" for the full story. Updated `server/lib/roles.ts`
      (`GROUP_TO_ROLE`), `server/lib/auth.ts` (dev fallback), `server/routes/admin.ts`
      (display mapping), and all 5 `resources/genie_spaces/*.genie-space.yml`
      `permissions:` blocks — nowhere else needed to change, since the app's
      SCIM group-lookup call is identical for account- and workspace-level
      groups. **Verified live end-to-end after redeploying:** `/api/me` resolves
      all 4 roles correctly from the new groups; the view-as switcher still
      correctly 403s a wrong-role write on a real line
      (`This action requires role Lead Engineer; you are Estimator...`); all 5
      Genie spaces' permission grants redeployed cleanly and each space is
      still reachable via the Conversation API.
- [x] Phase 11 — landing-page identity indicator (`ProjectPicker.tsx` now
      shows signed-in email + eligible-role badges — was previously only
      visible once inside a project), plus a full investigation into
      Databricks' native "assume role" RBAC feature. 4 mechanisms tried and
      disproven (workspace UI switcher, `aid=` URL param on both the app's
      and workspace's URL, `aid=` against the raw SCIM API directly,
      `assume_group` OAuth param) before finding the one that actually
      works: a genuinely **fresh** OAuth login (e.g. incognito window) with
      a role picked during it embeds an `ag` (assumed group) claim in the
      forwarded token's JWT — confirmed directly (`"ag":"153366456771408"`
      after picking Estimator, matching that group's real ID exactly). Wired
      into `server/lib/auth.ts`/`roles.ts`: when present, narrows the
      request's identity to just that one role, bypassing the full-membership
      SCIM lookup entirely. Full trail in `ARCHITECTURE.md`'s "Databricks
      'assume role' — found the real mechanism". This means
      `conor.smith@databricks.com` can now test any restricted single-role
      view directly (incognito + pick a role at login) — no separate test
      accounts needed after all. Also found + fixed a real bug along the
      way: the SCIM `/Me` API's `groups` array order is unstable across
      calls (confirmed directly), which was making the landing page's role
      badges visibly reorder on every load — fixed by sorting
      `eligibleRoles()` into the fixed `ROLES` order.

- [x] Phase 12 — the `ag` fix from Phase 11 immediately exposed a second,
      real bug: `GET /api/projects` (`server/routes/projects.ts`) filtered
      by "does *any* `user_project_role` row exist for this user" rather
      than "...for one of their *currently eligible* roles" — so an
      Estimator-only session still saw all 5 projects (matched
      `conor.smith`'s pre-existing `'Admin'` rows) and every card's badge
      showed the raw stored `'Admin'` value regardless of actual eligibility.
      Fixed by adding `AND upr.role = ANY($eligible)` to both the project
      query and the badge lookup, so they agree with `getEffectiveRole`'s
      own reconciliation rule. Also fixed the underlying data gap that made
      this untestable even after the query fix: `conor.smith` had zero
      `user_project_role` rows for any role except `'Admin'` (which
      `getEffectiveRole`'s fallback rule never actually needed a row for in
      the first place). `generate_live_seed.py` now gives `conor.smith` one
      real assignment per non-admin role on a different project
      (`Estimator`→BM-L-001, `Lead Engineer`→BM-L-002, `Design
      Lead`→BM-L-003); applied directly to the live Lakebase table via a
      one-off `databricks jobs submit` run (local `pip install` is blocked
      by this machine's proxy, so reused the exact `w.postgres` + psycopg2
      pattern from `simulate_new_data`), then `refresh_silver_gold` to sync
      it through CDC, then regenerated `seed_live_data.sql` so `reset_poc`
      matches going forward. **Verified live end-to-end in a real incognito
      browser session**: picking a non-Admin role at login now correctly
      shows just that one role on the landing page, only that role's single
      assigned project in the picker, and a matching badge. (A normal,
      non-incognito session correctly still shows the full identity/all 4
      roles — no `ag` claim, expected and by design, since that's whichever
      session was already authenticated before this feature was ever
      wired in.)

## Known follow-ups (need your real browser, not just my CLI access)

1. **Embedding domain allowlist.** If a dashboard iframe renders
   blank/blocked instead of the dashboard, a workspace admin needs to allow
   this app's domain — open any dashboard's **Share → Embed dashboard**
   dialog in the Databricks UI, which shows the exact domain to add and lets
   an admin add it directly.
2. Republishing a dashboard after editing its `.lvdash.json` requires
   **both** `databricks bundle deploy` (updates the draft) **and**
   `databricks lakeview publish <id> --warehouse-id a4e59a1f13ab8b9a
   --embed-credentials` (publishes it — `bundle deploy` alone does not). With
   5 dashboards now, that's 5 publish calls after any shared-template change
   to `build_dashboard_config.py`.
3. **Confirm the dashboard's built-in "Ask Genie" button in a real browser**
   — open a project, click it, and check it answers correctly scoped to that
   project (it should, per the `overrideId` link, but this hasn't been
   clicked through a real browser session, only verified via the CLI/API
   that the link itself is correctly configured).
