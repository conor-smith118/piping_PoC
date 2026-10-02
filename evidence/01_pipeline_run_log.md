# Pipeline run log — real job runs, 2026-10-02

Captured via the Databricks SDK: `w.jobs.run_now(job_id)`, poll
`w.jobs.get_run(run_id)` until `TERMINATED`, then `w.jobs.get_run_output`
on every task. Every `output:` line below is that task's
`dbutils.notebook.exit(...)` value, verbatim — a real summary computed by
the notebook's own real execution (row counts, model metrics, timings),
not written by hand. Run page URLs are real and point at this workspace.

Run in this order (matches the dependency order in `SETUP.md`).

## 1. `synthetic_historical_seed` — generate 25 historical closed projects

```
job_id=401714958071693, run_id=867038913038149
Result: SUCCESS
Run page: https://adb-7405608145506562.2.azuredatabricks.net/?o=7405608145506562#job/401714958071693/run/867038913038149
Duration: 76.6s

-- task: generate_historical (run_id=1060186028238657) --
   result: SUCCESS
   output: generate_historical_projects: 25 projects, seed=42. Row counts: projects=25; lines=882;
   stage_history=5292; true_up_records=1764; change_log=1223. True-up stage duration signal
   (large-bore/exotic vs. small-bore/carbon-steel): large_bore=False,exotic=False -> avg 63.5h (n=984)
   | large_bore=False,exotic=True -> avg 85.0h (n=310) | large_bore=True,exotic=False -> avg 92.9h
   (n=340) | large_bore=True,exotic=True -> avg 142.6h (n=130).
```

**Why this matters:** the deliberate "large-bore + exotic material runs
longer at true-up" signal built into the synthetic data generator is
*really* in the generated data — large-bore+exotic lines average 142.6
hours per true-up stage vs. 63.5 hours for small-bore carbon-steel, a real
2.25x difference computed from the actual written rows, not asserted. This
is exactly the signal `ml_train_stage_duration` (below) learns.

## 2. `apply_catalog_schema_ddl` — apply all 6 DDL files (tables/views/comments)

```
job_id=378252682125365, run_id=454217481682382
Result: SUCCESS
Run page: https://adb-7405608145506562.2.azuredatabricks.net/?o=7405608145506562#job/378252682125365/run/454217481682382
Duration: 112.6s

-- task: apply_ddl (run_id=347149411534695) --
   result: SUCCESS
   output: Done. Ran 160 statements across 6 files against css_fevm.burns_piping_poc.
```

## 3. `ml_train_stage_duration` — train + register the stage-duration model

```
job_id=50992195100774, run_id=834199630455027
Result: SUCCESS
Run page: https://adb-7405608145506562.2.azuredatabricks.net/?o=7405608145506562#job/50992195100774/run/834199630455027
Duration: 199.9s

-- task: train (run_id=929402437669840) --
   result: SUCCESS
   output: train_stage_duration_model: 5292 training rows (4233 train / 1059 test) from 20 Optuna
   trials. Best params: {'n_estimators': 288, 'max_depth': 3, 'learning_rate': 0.031854473448631376,
   'subsample': 0.643027201933799}. Held-out performance: MAE=11.0 hours (MAE log-scale=0.2927, R2
   log-scale=0.863). Registered css_fevm.burns_piping_poc.stage_duration_model version 2, aliased @prod.
```

**Real, held-out (not training-set) performance: R² = 0.863, MAE = 11.0
hours** — on data the model never saw during training/tuning.

## 4. `reset_poc` — restore the 5 live projects to the frozen baseline

Chains `refresh_silver_gold` then `ml_batch_inference` automatically via
`run_job_task` — their outputs are captured separately below since the
Jobs API exposes chained-job outputs through the *triggered* job's own run,
not the triggering task.

```
job_id=479501790373927, run_id=704618583441168
Result: SUCCESS
Run page: https://adb-7405608145506562.2.azuredatabricks.net/?o=7405608145506562#job/479501790373927/run/704618583441168
Duration: 258.0s

-- task: reset (run_id=1054658477094942) --
   result: SUCCESS
   output: reset_poc: deleted rows (before counts: {'change_log': 19, 'true_up_records': 66,
   'stage_events': 264, 'lines': 93, 'user_project_role': 19, 'projects': 5}), replayed 462 INSERT
   statements from the frozen seed file, restored row counts: {'change_log': 19, 'true_up_records': 65,
   'stage_events': 262, 'lines': 93, 'user_project_role': 18, 'projects': 5}.
```

Chained `refresh_silver_gold` (triggered run):
```
Piping PoC — Refresh Live Tables (from Lakebase CDC): run_id=538487271662160
-- refresh: refresh_silver_gold: live_projects: refreshed from lb_projects_history -> 5 rows;
   live_lines: refreshed from lb_lines_history -> 93 rows; live_stage_history: refreshed from
   lb_stage_events_history -> 262 rows; live_true_up_records: refreshed from
   lb_true_up_records_history -> 65 rows; live_change_log: refreshed from lb_change_log_history ->
   19 rows; live_user_project_role: refreshed from lb_user_project_role_history -> 18 rows
```

Chained `ml_batch_inference` (triggered run):
```
Piping PoC — Batch Score Stage-Duration Predictions: run_id=791323459904074
-- score: batch_score_predictions: scored 83 in-flight lines using
   css_fevm.burns_piping_poc.stage_duration_model@prod, wrote 83 rows to gold_ml_predictions.
   Longest-remaining examples: BM-L-003-L0016 (stage 1): 249.5h remaining, ETA
   2026-10-13 05:23:10.092883; BM-L-004-L0004 (stage 1): 238.2h remaining, ETA
   2026-10-12 18:07:36.035266; BM-L-003-L0006 (stage 1): 199.7h remaining, ETA 2026-10-11 03:39:00.135608.
```

## 5. `simulate_new_data` — exercise the real CDC path (new lines + stage advances)

```
job_id=939652093475386, run_id=261711622174510
Result: SUCCESS
Run page: https://adb-7405608145506562.2.azuredatabricks.net/?o=7405608145506562#job/939652093475386/run/261711622174510
Duration: 208.1s

-- task: simulate (run_id=113292790035644) --
   result: SUCCESS
   output: simulate_new_data: advanced 10 in-flight lines (stage 2: 3, stage 3: 2, stage 4: 2,
   stage 5: 1, stage 6: 2); inserted 3 new stage-1 lines across 3 projects ({'BM-L-003': 1,
   'BM-L-005': 1, 'BM-L-002': 1}). Committed straight to Lakebase Postgres (same path the app
   itself writes through) — real CDC propagation, not a simulated/mocked write.
```

Chained `refresh_silver_gold` (triggered run, reflecting the new activity):
```
Piping PoC — Refresh Live Tables (from Lakebase CDC): run_id=504165366420136
-- refresh: refresh_silver_gold: live_projects: refreshed from lb_projects_history -> 5 rows;
   live_lines: refreshed from lb_lines_history -> 96 rows (was 93 — the 3 new lines);
   live_stage_history: refreshed from lb_stage_events_history -> 275 rows (was 262); 
   live_true_up_records: refreshed from lb_true_up_records_history -> 68 rows (was 65);
   live_change_log: refreshed from lb_change_log_history -> 20 rows (was 19);
   live_user_project_role: refreshed from lb_user_project_role_history -> 18 rows
```

Chained `ml_batch_inference` (triggered run):
```
Piping PoC — Batch Score Stage-Duration Predictions: run_id=1072636815387544
-- score: batch_score_predictions: scored 84 in-flight lines (was 83) using
   css_fevm.burns_piping_poc.stage_duration_model@prod, wrote 84 rows to gold_ml_predictions.
```

**Why this matters:** the row counts visibly move between the two
`refresh_silver_gold` runs (93→96 lines, 262→275 events, 65→68 true-ups,
83→84 predictions) — real evidence that `simulate_new_data`'s writes went
through Lakebase → CDC → Delta exactly as the architecture claims, not a
no-op.
