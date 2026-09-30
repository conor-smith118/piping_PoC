# Demo Script

A live, repeatable walkthrough of the PoC. Total time ~18-22 minutes. Everything
below has been run and verified against the deployed app, not just planned.

**App:** https://burns-piping-poc-7405608145506562.2.azure.databricksapps.com
**Live projects:** BM-L-001 .. BM-L-005 (5 ACTIVE projects, ~93 lines total at
baseline)

## 0. Setup (before the audience is watching)

- Run `reset_poc` (Jobs UI or `databricks bundle run reset_poc -t dev`) so the
  demo starts from the exact same known-good baseline every time — 93 lines,
  spread across all 6 stages, 83 ML predictions already scored.
- Confirm you're logged into the app as `conor.smith@databricks.com` — a
  member of all 4 account-level groups (`Estimator Piping`,
  `Lead Engineer Piping`, `Design Lead Piping`, `Admin Piping`), so the "view
  as" switcher can act as any role without needing 4 separate real accounts.
  These are account-level (not workspace-local) specifically so a real user
  who only holds one role can instead log in by selecting/assuming that
  group directly, rather than needing the in-app switcher at all — either
  path exercises the exact same server-side authorization check.

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
   dashboard object, each natively linked to its own Genie agent.

## 3. Predictive ETAs (~2 min)

Point at the Kanban card / dashboard for an in-flight line and its
ML-predicted remaining time (`gold_ml_predictions`, refreshed by
`ml_batch_inference`). Mention briefly: trained on 25 synthetic historical
closed projects (~5,300 completed stage-transitions), XGBoost on
log(duration), R²≈0.86 / MAE≈11 hours on held-out data — good enough to make
the ETA feel real, explicitly caveated as trained on synthetic data if asked.

## 4. Watch a single action reach the dashboard live (~2 min)

The dashboard and Genie read straight from CDC, not a batch snapshot — so
this doesn't need `simulate_new_data` to show:

1. Have the dashboard open on a project's **Dashboard** tab, showing its
   current stage-breakdown chart.
2. In another tab, perform one real stage action on that same project (e.g.
   confirm a line as Lead Engineer).
3. Switch back to the dashboard tab and refresh. The bar chart has already
   moved — no job to wait for, just the couple of seconds it takes Lakehouse
   Sync to replicate the write.

## 5. Simulate a burst of activity (~3 min)

1. Run **`simulate_new_data`** (Jobs UI or `databricks bundle run
   simulate_new_data -t dev`) — writes several new lines and stage advances
   at once through the real Lakebase → CDC path, then chains
   `refresh_silver_gold`/`ml_batch_inference` to keep `live_lines` and the
   ML predictions caught up too (~4 min total for the full chain, though the
   dashboard itself reflects the individual writes within seconds, same as
   step 4).
2. Refresh the app: new stage-1 lines on the Kanban board, some existing
   lines advanced, `gold_ml_predictions` rescored.

## 6. Admin (~1 min)

Open **Admin** (nav bar, visible because you're an `Admin Piping` group
member) — shows every current per-project role assignment across all 5
projects, and lets you assign/revoke one live. Mention the reconciliation
rule: an assignment here only takes effect if the target user is *also* a
real member of the matching account-level group — the write here is a record
of intent, the actual access check re-runs independently on every request.

## 7. Reset (~1 min)

Run **`reset_poc`**. Show the app back at exactly the original 93-line
baseline — the new/advanced lines from step 5 are gone, `gold_ml_predictions`
is back to 83 rows. Ready to run the whole demo again immediately.

## Appendix: what's real vs. synthetic

Worth being upfront about if asked: the 5 *live* projects and 25 *historical*
closed projects are entirely synthetic data, generated to be internally
consistent (a deliberate "large-bore + exotic material runs long at true-up"
signal, which the ML model correctly learned). The workflow, role model,
architecture, and every pipeline (CDC, dashboards, Genie, ML) are real and
would operate identically against real S3D/line-list data — only the numbers
themselves are fabricated for this PoC.
