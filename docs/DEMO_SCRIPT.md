# Demo Script

A live, repeatable walkthrough of the PoC. Total time ~15-20 minutes. Everything
below has been run and verified against the deployed app, not just planned.

**App:** https://burns-piping-poc-7405608145506562.2.azure.databricksapps.com
**Live projects:** BM-L-001 .. BM-L-005 (5 ACTIVE projects, ~93 lines total at
baseline)

## 0. Setup (before the audience is watching)

- Run `reset_poc` (Jobs UI or `databricks bundle run reset_poc -t dev`) so the
  demo starts from the exact same known-good baseline every time — 93 lines,
  spread across all 6 stages, 83 ML predictions already scored.
- Confirm you're logged into the app as `conor.smith@databricks.com` — a
  member of all 4 workspace groups (`Estimator`, `Lead Engineer`,
  `Design Lead`, `piping_admin`), so the "view as" switcher can act as any
  role without needing 4 separate real accounts.

## 1. The workflow, as each role sees it (~5 min)

1. Open the app → **project picker**. Point out it only lists projects you
   have a role on (or all of them, since you're Admin) — this is a real
   per-project role check, not a static menu.
2. Open **BM-L-001**. Walk through the 6-stage timeline at the top and the
   Kanban board below it — every card is a real line from `gold_line_status`,
   grouped by its current stage.
3. Using the **role badge's "view as" dropdown** (top right):
   - **View as Estimator** → open "New Line", fill in a few fields (real
     S3D/line-list vocabulary — service, line class/spec, NPS, material,
     P&ID/isometric references), submit. It lands in the "Initial Data
     Entry" column immediately.
   - **View as Lead Engineer** → open that same line, confirm it. It moves to
     "Initial Engineer Confirmation".
   - **View as Design Lead** → perform the Preliminary True-Up (enter actual
     vs. estimated length/fittings/valves) → it moves to "Preliminary
     True-Up Complete", with a variance % now visible.
   - **View as Lead Engineer** again → confirm the preliminary true-up.
   - Point out: switch to a role you *haven't* picked (e.g. try the Design
     Lead action while still "viewing as" Lead Engineer) — the button isn't
     even shown, and if you script around that client-side gate, the server
     independently rejects it with a 403. The UI hint and the real security
     boundary are two different things, and only one of them is decorative.

## 2. Dashboard + Genie, per project (~4 min)

1. Still on BM-L-001, scroll to **Project Progress Dashboard** — KPIs, a
   stage-breakdown bar chart, a completion pie, and a line-detail table, all
   scoped to this project alone (no filter widget needed — this dashboard
   only ever queries BM-L-001's rows).
2. Click the dashboard's own built-in **"Ask Genie"** button at the bottom.
   Ask something like *"Which line has the largest preliminary true-up
   variance, and what was the reason?"* — it answers using this project's own
   curated agent (full stage-history audit trail and true-up/change-log
   detail, not just the dashboard's aggregated KPIs), with the generated SQL
   visible.
3. Navigate to a **different** project (e.g. BM-L-003) and repeat the same
   question. Point out the answer is genuinely different — a different
   `spaceId`, a different underlying view — because each project has its own
   dashboard object, each natively linked to its own Genie agent. (This is
   also why there's only *one* "Ask Genie" button on the page, not two — an
   earlier version of this PoC added a second, app-level Genie chat tab and
   it read as a bug, not a feature; see `ARCHITECTURE.md`.)

## 3. Predictive ETAs (~2 min)

Point at the Kanban card / dashboard for an in-flight line and its
ML-predicted remaining time (`gold_ml_predictions`, refreshed by
`ml_batch_inference`). Mention briefly: trained on 25 synthetic historical
closed projects (~5,300 completed stage-transitions), XGBoost on
log(duration), R²≈0.86 / MAE≈11 hours on held-out data — good enough to make
the ETA feel real, explicitly caveated as trained on synthetic data if asked.

## 4. Watch new activity flow through the real pipeline (~3 min)

1. Run **`simulate_new_data`** (Jobs UI or `databricks bundle run
   simulate_new_data -t dev`). Narrate while it runs (~4 min: writes to
   Lakebase, then chains `refresh_silver_gold`, then `ml_batch_inference`):
   this goes through the *actual* app-facing database, the *actual* CDC
   pipeline (Lakehouse Sync), not a shortcut straight into Delta.
2. Once it finishes, refresh the app. Show: new stage-1 lines appeared on the
   Kanban board, some existing lines advanced a stage, the dashboard's counts
   moved, and `gold_ml_predictions` rescored — all without touching any app
   code. This is the "wow" moment: a human-shaped write (or a simulated one)
   flows through Postgres → CDC → Delta → gold → dashboard/Genie/ML
   automatically.

## 5. Admin (~1 min)

Open **Admin** (nav bar, visible because you're a `piping_admin` group
member) — shows every current per-project role assignment across all 5
projects, and lets you assign/revoke one live. Mention the reconciliation
rule: an assignment here only takes effect if the target user is *also* a
real member of the matching workspace group — the write here is a record of
intent, the actual access check re-runs independently on every request.

## 6. Reset (~1 min)

Run **`reset_poc`**. Show the app back at exactly the original 93-line
baseline — the new/advanced lines from step 4 are gone, `gold_ml_predictions`
is back to 83 rows. Ready to run the whole demo again immediately.

## Appendix: what's real vs. synthetic

Worth being upfront about if asked: the 5 *live* projects and 25 *historical*
closed projects are entirely synthetic data, generated to be internally
consistent (a deliberate "large-bore + exotic material runs long at true-up"
signal, which the ML model correctly learned). The workflow, role model,
architecture, and every pipeline (CDC, dashboards, Genie, ML) are real and
would operate identically against real S3D/line-list data — only the numbers
themselves are fabricated for this PoC.
