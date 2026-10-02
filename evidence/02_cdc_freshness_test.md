# CDC freshness test — real, timed, 2026-10-02

The dashboard/Genie architecture (`docs/ARCHITECTURE.md`, "Data freshness:
the dashboard and Genie are always live") claims that a write to Lakebase
Postgres is visible in the CDC-backed `v_*` views within seconds, with no
batch job in the path. This is a real, timed, one-off measurement of that
claim — not an assumption, not a repeated marketing number.

**Method:** a one-off notebook (not part of the deployed bundle — written
for this test, run via `databricks jobs submit`, cleaned up afterward)
connected to Lakebase Postgres directly (same OAuth-credential mechanism
the app itself uses), inserted one real `stage_events` row, recorded the
commit timestamp, then polled `v_stage_history` (the query-time view over
the `lb_stage_events_history` CDC table — no batch job) once per second
until that exact row appeared.

**Real result:**

```
CDC freshness test: wrote event EVIDENCE-2faa6f69c9f2 directly to Lakebase Postgres at
1790971851.994 (epoch); first visible in v_stage_history (query-time view over the
lb_stage_events_history CDC table — no batch job in the path) at 1790971866.513 (epoch).
Elapsed: 14.5 seconds (poll granularity 1s, so true latency may be up to 1s less than this).
```

**14.5 seconds**, Lakebase write to visible-in-the-CDC-view, measured
end-to-end including network round trips from this test script itself —
not the few-hundred-millisecond-to-low-single-digit-seconds Lakehouse Sync
replication lag alone (which `ARCHITECTURE.md` separately measured closer
to query-time). Compare against the batch-job alternative this PoC
deliberately avoided: `refresh_silver_gold`'s serverless-notebook cold
start alone measured 90-110 seconds across 5 historical runs, *before* any
actual refresh work — meaning a batch-triggered dashboard would have been
6-8x slower minimum, before even counting how often that batch job runs.

The evidence row (`event_id` starting `EVIDENCE-`) was deleted immediately
after the test — it is not real demo content and does not appear in the
query results in `03_query_results.md`.
