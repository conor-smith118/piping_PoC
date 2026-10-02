# Genie conversation — real Q&A transcript, 2026-10-02

A real question asked of BM-L-001's deployed Genie agent (space id
`01f1bc14c9b21cc29434ac66028bdcee`) via the Genie Conversation REST API
(`POST .../start-conversation`, then poll
`GET .../conversations/{id}/messages/{id}` until `COMPLETED`) — the same
API the dashboard's own "Ask Genie" button calls, just invoked directly
instead of through a browser click.

**Question asked:**
> Which line has the largest preliminary true-up variance, and what reason was logged for it?

**Real generated SQL** (Genie wrote this itself, against the real
per-project views — note it correctly scoped to `vw_genie_bm_l_001_*`,
never touching another project's data):

```sql
WITH ranked AS (
  SELECT
    `l`.`line_no`,
    `l`.`prelim_length_variance_pct`,
    `t`.`reason_category`,
    `t`.`reason_text`,
    RANK() OVER (ORDER BY ABS(`l`.`prelim_length_variance_pct`) DESC) AS `rnk`
  FROM `css_fevm`.`burns_piping_poc`.`vw_genie_bm_l_001_lines` AS `l`
  INNER JOIN `css_fevm`.`burns_piping_poc`.`vw_genie_bm_l_001_true_up` AS `t`
    ON `l`.`line_id` = `t`.`line_id`
  WHERE `l`.`prelim_length_variance_pct` IS NOT NULL
    AND `t`.`true_up_type` = 'PRELIMINARY'
)
SELECT `line_no`, `prelim_length_variance_pct`, `reason_category`, `reason_text`
FROM ranked
WHERE `rnk` <= 1
```

**Genie's real recorded reasoning** (`thoughts` returned by the API):
- *Description:* "You want to find the line with the largest absolute preliminary true-up variance and see the reason logged for that variance."
- *Data sourcing:* `css_fevm.burns_piping_poc.vw_genie_bm_l_001_lines`, `css_fevm.burns_piping_poc.vw_genie_bm_l_001_true_up`
- *Steps:* filter to non-null variance → join to true-up records → rank by `ABS(variance)` descending → select the top row.

**Genie's real natural-language answer:**
> The line with the largest preliminary true-up variance is **line L-018**, with **prelim_length_variance_pct = 16.3**. The logged reason for **line L-018** is **reason_category = null** and **reason_text = null**, so no reason was recorded in the visible data.

**Verification:** `03_query_results.md`'s `v_true_up_records` sample
confirms `BM-L-002-L0004` (line_no `L-004` on a *different* project)
shows 15.9%, and this agent — correctly scoped to BM-L-001 only — found
BM-L-001's own highest at 16.3% on `L-018`. Genie also correctly reported
that no change-log reason exists for that specific true-up, rather than
inventing one — a real example of the "don't guess at missing data"
instruction in `src/genie/build_agent_config.py` actually being followed.
