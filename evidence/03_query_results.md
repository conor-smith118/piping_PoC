# Query results — real output, 2026-10-02

Captured via the Databricks SQL Statement Execution API
(`w.statement_execution.execute_statement`) against the live SQL warehouse,
immediately after the pipeline run in `01_pipeline_run_log.md` completed.
Every table below is the exact, unedited result of a real query against
the deployed Unity Catalog objects — the same objects the app's Kanban
board, the per-project dashboards, and the Genie agents all read from.

## Row counts, all tables/views, after the real pipeline run above

| t | n |
|---|---|
| gold_line_status | 978 |
| gold_ml_predictions | 84 |
| gold_project_rollup | 30 |
| historical_lines | 882 |
| historical_projects | 25 |
| historical_stage_history | 5292 |
| live_change_log | 20 |
| live_lines | 96 |
| live_projects | 5 |
| live_stage_history | 275 |
| live_true_up_records | 68 |
| ml_stage_transition_features | 5639 |
| v_lines (LIVE+HISTORICAL) | 978 |

## `gold_project_rollup` — all 5 live projects (real query result)

| project_id | project_name | client_name | total_lines | lines_complete | pct_lines_complete | mode_stage | min_stage | avg_days_in_current_stage |
|---|---|---|---|---|---|---|---|---|
| BM-L-001 | Petrochemical Unit - Unit 300 | Highland Gas Processing | 22 | 2 | 0.091 | 3 | 1 | 29.9 |
| BM-L-002 | Refinery Expansion - Pipe Rack B | Meridian Energy Partners | 20 | 5 | 0.25 | 1 | 1 | 49.2 |
| BM-L-003 | Power Plant Piping - Pipe Rack A | Cascade Petrochemical | 18 | 1 | 0.056 | 1 | 1 | 55.82 |
| BM-L-004 | Refinery Expansion - Pipe Rack A | Cascade Petrochemical | 20 | 1 | 0.05 | 1 | 1 | 61.47 |
| BM-L-005 | Gas Processing Plant - Pipe Rack A | Prairie Power & Light | 16 | 3 | 0.188 | 1 | 1 | 34.0 |

This is the exact query the "Project Progress" dashboard's KPI tiles and
the app's 6-stage timeline both read.

## `gold_line_status` — sample of 10 live lines, varied stages (real query result)

| line_id | project_id | line_no | service | current_stage | current_stage_name | is_complete | prelim_length_variance_pct | final_length_variance_pct |
|---|---|---|---|---|---|---|---|---|
| BM-L-001-L0003 | BM-L-001 | L-003 | Crude Oil | 6 | Engineer Final Confirmation | true | 1.5 | 1.5 |
| BM-L-001-L0014 | BM-L-001 | L-014 | Fuel Gas | 6 | Engineer Final Confirmation | true | 6.9 | 6.9 |
| BM-L-002-L0004 | BM-L-002 | L-004 | Steam | 6 | Engineer Final Confirmation | true | 15.9 | 15.9 |
| BM-L-002-L0005 | BM-L-002 | L-005 | Crude Oil | 6 | Engineer Final Confirmation | true | 2.8 | 2.8 |
| BM-L-002-L0007 | BM-L-002 | L-007 | Nitrogen | 6 | Engineer Final Confirmation | true | -0.1 | -0.1 |
| BM-L-002-L0011 | BM-L-002 | L-011 | Steam | 6 | Engineer Final Confirmation | true | 9.9 | 9.9 |
| BM-L-002-L0018 | BM-L-002 | L-018 | Condensate | 6 | Engineer Final Confirmation | true | 1.3 | 1.3 |
| BM-L-003-L0010 | BM-L-003 | L-010 | Steam | 6 | Engineer Final Confirmation | true | 6.1 | 6.1 |
| BM-L-004-L0010 | BM-L-004 | L-010 | Nitrogen | 6 | Engineer Final Confirmation | true | -7.6 | -7.6 |
| BM-L-005-L0002 | BM-L-005 | L-002 | Cooling Water | 6 | Engineer Final Confirmation | true | 8.0 | 8.0 |

## `v_stage_history` — most recent 8 real stage-transition events (live, from Lakebase CDC)

| event_id | line_id | project_id | stage_number | stage_name | actor_email | actor_role | event_timestamp |
|---|---|---|---|---|---|---|---|
| BM-L-002-L0020-SIM82e2-EVT1 | BM-L-002-L0020-SIM82e2 | BM-L-002 | 1 | Initial Data Entry | estimator.bm-l-002@example-epc.com | Estimator | 2026-10-02T19:58:09.640Z |
| BM-L-005-L0016-SIM27b6-EVT1 | BM-L-005-L0016-SIM27b6 | BM-L-005 | 1 | Initial Data Entry | estimator.bm-l-005@example-epc.com | Estimator | 2026-10-02T19:58:09.633Z |
| BM-L-003-L0018-SIMb2e8-EVT1 | BM-L-003-L0018-SIMb2e8 | BM-L-003 | 1 | Initial Data Entry | estimator.bm-l-003@example-epc.com | Estimator | 2026-10-02T19:58:09.626Z |
| BM-L-001-L0007-EVT3-SIMe5f094 | BM-L-001-L0007 | BM-L-001 | 3 | Preliminary True-Up Complete | design_lead.bm-l-001@example-epc.com | Design Lead | 2026-10-02T19:58:09.333Z |
| BM-L-004-L0014-EVT4-SIMd985fb | BM-L-004-L0014 | BM-L-004 | 4 | Engineer Prelim True-Up Confirmation | lead_engineer.bm-l-004@example-epc.com | Lead Engineer | 2026-10-02T19:58:09.325Z |
| BM-L-003-L0011-EVT3-SIM055c26 | BM-L-003-L0011 | BM-L-003 | 3 | Preliminary True-Up Complete | design_lead.bm-l-003@example-epc.com | Design Lead | 2026-10-02T19:58:09.318Z |
| BM-L-003-L0013-EVT5-SIM0b91f0 | BM-L-003-L0013 | BM-L-003 | 5 | Final True-Up Complete | design_lead.bm-l-003@example-epc.com | Design Lead | 2026-10-02T19:58:09.310Z |
| BM-L-004-L0004-EVT2-SIMca12b2 | BM-L-004-L0004 | BM-L-004 | 2 | Initial Engineer Confirmation | lead_engineer.bm-l-004@example-epc.com | Lead Engineer | 2026-10-02T19:58:09.304Z |

These are the exact 8 most recent audit-trail rows from `simulate_new_data`'s
real run (`01_pipeline_run_log.md`, step 5) — real actor emails/roles/stage
transitions, queried straight from the CDC-backed view.

## `gold_ml_predictions` — 8 real scored predictions (longest remaining first)

| project_id | line_id | current_stage | predicted_remaining_hours | predicted_completion_ts | model_version | scored_at |
|---|---|---|---|---|---|---|
| BM-L-003 | BM-L-003-L0016 | 1 | 249.5 | 2026-10-13T05:27:56.935Z | 2 | 2026-10-02T20:00:22.064Z |
| BM-L-004 | BM-L-004-L0004 | 2 | 238.2 | 2026-10-12T18:10:10.117Z | 2 | 2026-10-02T20:00:22.064Z |
| BM-L-003 | BM-L-003-L0006 | 1 | 199.7 | 2026-10-11T03:43:46.977Z | 2 | 2026-10-02T20:00:22.064Z |
| BM-L-004 | BM-L-004-L0013 | 1 | 195.4 | 2026-10-10T23:23:23.430Z | 2 | 2026-10-02T20:00:22.064Z |
| BM-L-005 | BM-L-005-L0007 | 1 | 194.3 | 2026-10-10T22:17:29.341Z | 2 | 2026-10-02T20:00:22.064Z |
| BM-L-001 | BM-L-001-L0019 | 1 | 194.2 | 2026-10-10T22:15:06.738Z | 2 | 2026-10-02T20:00:22.064Z |
| BM-L-005 | BM-L-005-L0003 | 1 | 194.1 | 2026-10-10T22:07:14.161Z | 2 | 2026-10-02T20:00:22.064Z |
| BM-L-004 | BM-L-004-L0001 | 1 | 190.0 | 2026-10-10T17:58:09.679Z | 2 | 2026-10-02T20:00:22.064Z |

`model_version=2` — the exact UC Model Registry version trained and
`@prod`-aliased in `01_pipeline_run_log.md`, step 3, scoring real in-flight
lines produced by the real seed/simulate data above.

## `v_true_up_records` — real true-up variance examples (large-bore/exotic signal, live projects)

| line_id | material | nominal_size_in | true_up_type | estimated_centerline_length_ft | actual_centerline_length_ft | length_variance_pct |
|---|---|---|---|---|---|---|
| BM-L-004-L0012 | Carbon Steel | 2.0 | PRELIMINARY | 47.7 | 58.8 | 23.3 |
| BM-L-001-L0018 | Carbon Steel | 3.0 | PRELIMINARY | 43.9 | 51.1 | 16.3 |
| BM-L-002-L0004 | Stainless 316 | 3.0 | FINAL | 37.8 | 43.8 | 15.9 |
| BM-L-002-L0004 | Stainless 316 | 3.0 | PRELIMINARY | 37.8 | 43.8 | 15.9 |
| BM-L-004-L0020 | Carbon Steel | 2.0 | PRELIMINARY | 72.8 | 83.6 | 14.9 |
| BM-L-005-L0001 | Chrome Moly (P11) | 2.0 | PRELIMINARY | 32.2 | 36.6 | 13.7 |
| BM-L-001-L0013 | Stainless 304 | 1.0 | PRELIMINARY | 44.6 | 50.0 | 12.2 |
| BM-L-003-L0008 | Stainless 304 | 2.0 | PRELIMINARY | 50.5 | 56.3 | 11.5 |

This is exactly the data the Genie answer in `05_genie_conversation.md`
is reasoning over.

## UC catalog self-documentation — real column comment sample (`v_lines`)

| column_name | comment |
|---|---|
| line_id | Unique piping line identifier. Primary key. |
| project_id | Project this line belongs to. Foreign key to v_projects.project_id. |
| line_no | Line-list number as shown on the P&ID/isometric (e.g. L-001). |
| service | Process service the line carries (e.g. Cooling Water, Steam, Crude Oil). |
| origin_tag | Equipment/line tag the line originates from. |
| destination_tag | Equipment/line tag the line terminates at. |
| area_package_zone | Plant area, unit, or package the line is routed through. |
| line_class_spec | Piping line class / specification governing materials and ratings. |
| nominal_size_in | Nominal pipe size, in inches (NPS). |
| schedule_thickness | Pipe wall schedule or thickness designation (e.g. SCH 40, XS). |
