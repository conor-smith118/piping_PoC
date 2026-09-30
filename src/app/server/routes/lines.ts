import { z } from 'zod';
import type { Request, Response } from 'express';
import type { AppKitHandle, PoolClient } from '../lib/appkitTypes';
import { getRequestIdentity } from '../lib/auth';
import { getEffectiveRole, requireRole, STAGE_NAMES, STAGE_EVENT_TYPE } from '../lib/roles';
import { withTransaction, pad } from '../lib/db';

// ---------------------------------------------------------------------------
// Zod schemas for the 6 stage-action bodies. Field names mirror the S3D/
// line-list research baked into the schema (see ARCHITECTURE.md).
// ---------------------------------------------------------------------------

const CreateLineBody = z.object({
  service: z.string().min(1),
  originTag: z.string().optional(),
  destinationTag: z.string().optional(),
  areaPackageZone: z.string().optional(),
  lineClassSpec: z.string().min(1),
  nominalSizeIn: z.number().positive(),
  scheduleThickness: z.string().optional(),
  material: z.string().min(1),
  designPressurePsig: z.number().optional(),
  designTemperatureF: z.number().optional(),
  operatingPressurePsig: z.number().optional(),
  operatingTemperatureF: z.number().optional(),
  corrosionAllowanceIn: z.number().optional(),
  insulationType: z.string().nullable().optional(),
  insulationThicknessIn: z.number().nullable().optional(),
  heatTracingFlag: z.boolean().optional(),
  heatTracingSpec: z.string().nullable().optional(),
  endConnections: z.string().optional(),
  flangeRating: z.string().nullable().optional(),
  pidReference: z.string().optional(),
  isometricDrawingNo: z.string().optional(),
  estimatedCenterlineLengthFt: z.number().positive(),
  specialNotes: z.string().nullable().optional(),
});

const ConfirmBody = z.object({ notes: z.string().optional() });

const DetailItem = z.object({
  type: z.string(),
  size: z.number(),
  estimatedQty: z.number().int().nonnegative(),
  actualQty: z.number().int().nonnegative(),
});

const ChangeLogEntry = z.object({
  reasonCategory: z.enum(['DESIGN_CHANGE', 'CONSTRUCTABILITY', 'ESTIMATING_ERROR', 'OTHER']),
  reasonText: z.string().optional(),
});

const TrueUpBody = z.object({
  actualCenterlineLengthFt: z.number().positive(),
  fittingDetail: z.array(DetailItem).default([]),
  valveDetail: z.array(DetailItem).default([]),
  supportDetail: z.array(DetailItem).default([]),
  weldCountActual: z.number().int().nonnegative().optional(),
  flangeCountActual: z.number().int().nonnegative().optional(),
  mtoWeightActualLb: z.number().nonnegative().optional(),
  mtoCostActualUsd: z.number().nonnegative().optional(),
  changeLog: z.array(ChangeLogEntry).default([]),
});

interface LineRow {
  line_id: string;
  project_id: string;
  current_stage: number;
  estimated_centerline_length_ft: number | null;
  nominal_size_in: number | null;
}

async function loadLine(appkit: AppKitHandle, lineId: string): Promise<LineRow | null> {
  const { rows } = await appkit.lakebase.query<LineRow>('SELECT * FROM lines WHERE line_id = $1', [lineId]);
  return rows[0] ?? null;
}

async function insertStageEvent(
  client: PoolClient,
  args: { lineId: string; projectId: string; stageNumber: number; actorEmail: string; actorRole: string; notes?: string },
) {
  const eventId = `${args.lineId}-EVT${args.stageNumber}`;
  await client.query(
    `INSERT INTO stage_events (event_id, line_id, project_id, stage_number, stage_name, event_type, actor_email, actor_role, event_timestamp, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)`,
    [
      eventId,
      args.lineId,
      args.projectId,
      args.stageNumber,
      STAGE_NAMES[args.stageNumber],
      STAGE_EVENT_TYPE[args.stageNumber],
      args.actorEmail,
      args.actorRole,
      args.notes ?? null,
    ],
  );
}

export function registerLineRoutes(appkit: AppKitHandle) {
  appkit.server.extend((app) => {
    // ---- Line detail: record + full stage history + true-ups + change log ----
    app.get('/api/lines/:lineId', async (req, res) => {
      try {
        const { lineId } = req.params;
        const line = await loadLine(appkit, lineId);
        if (!line) {
          res.status(404).json({ error: 'Line not found' });
          return;
        }
        const identity = await getRequestIdentity(req);
        const effective = await getEffectiveRole(appkit, req, identity, line.project_id);
        if (!effective.role) {
          res.status(403).json({ error: 'You do not have access to this project.' });
          return;
        }

        const [history, trueUps, changeLog] = await Promise.all([
          appkit.lakebase.query('SELECT * FROM stage_events WHERE line_id = $1 ORDER BY stage_number', [lineId]),
          appkit.lakebase.query('SELECT * FROM true_up_records WHERE line_id = $1 ORDER BY true_up_type', [lineId]),
          appkit.lakebase.query(
            `SELECT c.* FROM change_log c
             JOIN true_up_records t ON t.true_up_id = c.true_up_id
             WHERE t.line_id = $1 ORDER BY c.changed_at`,
            [lineId],
          ),
        ]);

        res.json({
          line,
          effectiveRole: effective.role,
          isOverride: effective.isOverride,
          stageHistory: history.rows,
          trueUpRecords: trueUps.rows,
          changeLog: changeLog.rows,
        });
      } catch (err) {
        console.error('GET /api/lines/:lineId failed:', err);
        res.status(500).json({ error: 'Failed to load line' });
      }
    });

    // ---- Edit a not-yet-confirmed line (Estimator, stage 1 only) ----
    // Scoped to stage 1 deliberately: once the Lead Engineer has confirmed
    // Initial Data Entry (stage >= 2), that confirmation is itself a
    // statement "I reviewed and approved this exact data" — silently
    // editing it afterward would invalidate that confirmation without
    // re-triggering it. Correcting a mistake after that point is a
    // Lead-Engineer-side "optional UPDATE lines on correction" per
    // ARCHITECTURE.md's stage-action table, not an Estimator self-service
    // edit — not built here; out of scope for this fix.
    app.put('/api/lines/:lineId', async (req, res) => {
      try {
        const { lineId } = req.params;
        const line = await loadLine(appkit, lineId);
        if (!line) {
          res.status(404).json({ error: 'Line not found' });
          return;
        }
        const identity = await getRequestIdentity(req);
        const effective = await getEffectiveRole(appkit, req, identity, line.project_id);
        if (!effective.role) {
          res.status(403).json({ error: 'You do not have access to this project.' });
          return;
        }
        if (!requireRole(res, effective, ['Estimator'])) return;
        if (line.current_stage !== 1) {
          res.status(409).json({
            error: `This line is at stage ${line.current_stage} (${STAGE_NAMES[line.current_stage]}) — it can only be edited before Initial Engineer Confirmation.`,
          });
          return;
        }
        const parsed = CreateLineBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'Invalid line data', details: parsed.error.flatten() });
          return;
        }
        const b = parsed.data;
        // Plain UPDATE, no new stage_events row — editing an unconfirmed
        // line is a correction, not a new stage action, so the audit trail
        // still shows exactly one "Initial Data Entry" event at its
        // original timestamp.
        await appkit.lakebase.query(
          `UPDATE lines SET
             service = $1, origin_tag = $2, destination_tag = $3, area_package_zone = $4, line_class_spec = $5,
             nominal_size_in = $6, schedule_thickness = $7, material = $8, design_pressure_psig = $9,
             design_temperature_f = $10, operating_pressure_psig = $11, operating_temperature_f = $12,
             corrosion_allowance_in = $13, insulation_type = $14, insulation_thickness_in = $15,
             heat_tracing_flag = $16, heat_tracing_spec = $17, end_connections = $18, flange_rating = $19,
             pid_reference = $20, isometric_drawing_no = $21, estimated_centerline_length_ft = $22,
             special_notes = $23, updated_at = NOW()
           WHERE line_id = $24`,
          [
            b.service, b.originTag ?? null, b.destinationTag ?? null, b.areaPackageZone ?? null, b.lineClassSpec,
            b.nominalSizeIn, b.scheduleThickness ?? null, b.material, b.designPressurePsig ?? null,
            b.designTemperatureF ?? null, b.operatingPressurePsig ?? null, b.operatingTemperatureF ?? null,
            b.corrosionAllowanceIn ?? null, b.insulationType ?? null, b.insulationThicknessIn ?? null,
            b.heatTracingFlag ?? false, b.heatTracingSpec ?? null, b.endConnections ?? null, b.flangeRating ?? null,
            b.pidReference ?? null, b.isometricDrawingNo ?? null, b.estimatedCenterlineLengthFt, b.specialNotes ?? null,
            lineId,
          ],
        );
        res.json({ lineId });
      } catch (err) {
        console.error('PUT /api/lines/:lineId failed:', err);
        res.status(500).json({ error: 'Failed to update line' });
      }
    });

    // ---- Delete a not-yet-confirmed line (Estimator, stage 1 only) ----
    // Same stage-1-only boundary as edit, for the same reason. Deletes the
    // line's single stage_events row (the original Initial Data Entry
    // event — stage 1 is the only stage where no true_up_records/change_log
    // rows can exist yet) before the line itself, satisfying the FK.
    app.delete('/api/lines/:lineId', async (req, res) => {
      try {
        const { lineId } = req.params;
        const line = await loadLine(appkit, lineId);
        if (!line) {
          res.status(404).json({ error: 'Line not found' });
          return;
        }
        const identity = await getRequestIdentity(req);
        const effective = await getEffectiveRole(appkit, req, identity, line.project_id);
        if (!effective.role) {
          res.status(403).json({ error: 'You do not have access to this project.' });
          return;
        }
        if (!requireRole(res, effective, ['Estimator'])) return;
        if (line.current_stage !== 1) {
          res.status(409).json({
            error: `This line is at stage ${line.current_stage} (${STAGE_NAMES[line.current_stage]}) — it can only be deleted before Initial Engineer Confirmation.`,
          });
          return;
        }
        await withTransaction(appkit, async (client) => {
          await client.query('DELETE FROM stage_events WHERE line_id = $1', [lineId]);
          await client.query('DELETE FROM lines WHERE line_id = $1', [lineId]);
        });
        res.status(204).end();
      } catch (err) {
        console.error('DELETE /api/lines/:lineId failed:', err);
        res.status(500).json({ error: 'Failed to delete line' });
      }
    });

    // ---- Stage 1: Initial Data Entry (Estimator) ----
    app.post('/api/projects/:projectId/lines', async (req, res) => {
      try {
        const { projectId } = req.params;
        const identity = await getRequestIdentity(req);
        const effective = await getEffectiveRole(appkit, req, identity, projectId);
        if (!effective.role) {
          res.status(403).json({ error: 'You do not have access to this project.' });
          return;
        }
        if (!requireRole(res, effective, ['Estimator'])) return;
        const actorRole = effective.role; // captured outside the closure below — narrowing doesn't cross closure boundaries

        const parsed = CreateLineBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'Invalid line data', details: parsed.error.flatten() });
          return;
        }
        const b = parsed.data;

        const line = await withTransaction(appkit, async (client) => {
          const { rows: countRows } = await client.query<{ n: string }>(
            'SELECT COUNT(*) AS n FROM lines WHERE project_id = $1',
            [projectId],
          );
          const seq = Number(countRows[0].n) + 1;
          const lineId = `${projectId}-L${pad(seq, 4)}`;
          const lineNo = `L-${pad(seq, 3)}`;

          await client.query(
            `INSERT INTO lines (
               line_id, project_id, line_no, service, origin_tag, destination_tag, area_package_zone,
               line_class_spec, nominal_size_in, schedule_thickness, material, design_pressure_psig,
               design_temperature_f, operating_pressure_psig, operating_temperature_f, corrosion_allowance_in,
               insulation_type, insulation_thickness_in, heat_tracing_flag, heat_tracing_spec, end_connections,
               flange_rating, pid_reference, isometric_drawing_no, estimated_centerline_length_ft, special_notes,
               current_stage, is_complete, created_by, created_at, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,1,false,$27,NOW(),NOW())`,
            [
              lineId, projectId, lineNo, b.service, b.originTag ?? null, b.destinationTag ?? null,
              b.areaPackageZone ?? null, b.lineClassSpec, b.nominalSizeIn, b.scheduleThickness ?? null, b.material,
              b.designPressurePsig ?? null, b.designTemperatureF ?? null, b.operatingPressurePsig ?? null,
              b.operatingTemperatureF ?? null, b.corrosionAllowanceIn ?? null, b.insulationType ?? null,
              b.insulationThicknessIn ?? null, b.heatTracingFlag ?? false, b.heatTracingSpec ?? null,
              b.endConnections ?? null, b.flangeRating ?? null, b.pidReference ?? null, b.isometricDrawingNo ?? null,
              b.estimatedCenterlineLengthFt, b.specialNotes ?? null, identity.email,
            ],
          );
          await insertStageEvent(client, {
            lineId, projectId, stageNumber: 1, actorEmail: identity.email, actorRole,
          });
          return { lineId, lineNo };
        });

        res.status(201).json(line);
      } catch (err) {
        console.error('POST /api/projects/:projectId/lines failed:', err);
        res.status(500).json({ error: 'Failed to create line' });
      }
    });

    // ---- Stage 2: Initial Engineer Confirmation (Lead Engineer) ----
    app.post('/api/lines/:lineId/confirm-initial', async (req, res) => {
      await handleSimpleAdvance(req, res, { fromStage: 1, toStage: 2, role: 'Lead Engineer' });
    });

    // ---- Stage 4: Engineer Prelim True-Up Confirmation (Lead Engineer) ----
    app.post('/api/lines/:lineId/true-up/preliminary/confirm', async (req, res) => {
      await handleTrueUpConfirm(req, res, { trueUpType: 'PRELIMINARY', fromStage: 3, toStage: 4 });
    });

    // ---- Stage 6: Engineer Final Confirmation (Lead Engineer) ----
    app.post('/api/lines/:lineId/true-up/final/confirm', async (req, res) => {
      await handleTrueUpConfirm(req, res, { trueUpType: 'FINAL', fromStage: 5, toStage: 6 });
    });

    // ---- Stage 3: Preliminary True-Up Complete (Design Lead) ----
    app.post('/api/lines/:lineId/true-up/preliminary', async (req, res) => {
      await handleTrueUpSubmit(req, res, { trueUpType: 'PRELIMINARY', fromStage: 2, toStage: 3 });
    });

    // ---- Stage 5: Final True-Up Complete (Design Lead) ----
    app.post('/api/lines/:lineId/true-up/final', async (req, res) => {
      await handleTrueUpSubmit(req, res, { trueUpType: 'FINAL', fromStage: 4, toStage: 5 });
    });

    async function handleSimpleAdvance(
      req: Request<{ lineId: string }>,
      res: Response,
      opts: { fromStage: number; toStage: number; role: 'Lead Engineer' },
    ) {
      try {
        const { lineId } = req.params;
        const line = await loadLine(appkit, lineId);
        if (!line) {
          res.status(404).json({ error: 'Line not found' });
          return;
        }
        const identity = await getRequestIdentity(req);
        const effective = await getEffectiveRole(appkit, req, identity, line.project_id);
        if (!effective.role) {
          res.status(403).json({ error: 'You do not have access to this project.' });
          return;
        }
        if (!requireRole(res, effective, [opts.role])) return;
        const actorRole = effective.role;
        if (line.current_stage !== opts.fromStage) {
          res.status(409).json({
            error: `Line is at stage ${line.current_stage} (${STAGE_NAMES[line.current_stage]}), expected stage ${opts.fromStage}.`,
          });
          return;
        }
        const parsed = ConfirmBody.safeParse(req.body ?? {});
        const notes = parsed.success ? parsed.data.notes : undefined;

        await withTransaction(appkit, async (client) => {
          await insertStageEvent(client, {
            lineId, projectId: line.project_id, stageNumber: opts.toStage, actorEmail: identity.email,
            actorRole, notes,
          });
          await client.query('UPDATE lines SET current_stage = $1, updated_at = NOW() WHERE line_id = $2', [
            opts.toStage, lineId,
          ]);
        });

        res.json({ lineId, currentStage: opts.toStage });
      } catch (err) {
        console.error(`POST advance stage failed:`, err);
        res.status(500).json({ error: 'Failed to advance stage' });
      }
    }

    async function handleTrueUpSubmit(
      req: Request<{ lineId: string }>,
      res: Response,
      opts: { trueUpType: 'PRELIMINARY' | 'FINAL'; fromStage: number; toStage: number },
    ) {
      try {
        const { lineId } = req.params;
        const line = await loadLine(appkit, lineId);
        if (!line) {
          res.status(404).json({ error: 'Line not found' });
          return;
        }
        const identity = await getRequestIdentity(req);
        const effective = await getEffectiveRole(appkit, req, identity, line.project_id);
        if (!effective.role) {
          res.status(403).json({ error: 'You do not have access to this project.' });
          return;
        }
        if (!requireRole(res, effective, ['Design Lead'])) return;
        const actorRole = effective.role;
        if (line.current_stage !== opts.fromStage) {
          res.status(409).json({
            error: `Line is at stage ${line.current_stage} (${STAGE_NAMES[line.current_stage]}), expected stage ${opts.fromStage}.`,
          });
          return;
        }
        const parsed = TrueUpBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'Invalid true-up data', details: parsed.error.flatten() });
          return;
        }
        const b = parsed.data;
        const estimated = line.estimated_centerline_length_ft ?? 0;
        const variancePct = estimated > 0 ? ((b.actualCenterlineLengthFt - estimated) / estimated) * 100 : 0;
        const trueUpId = `${lineId}-TU-${opts.trueUpType.slice(0, 3)}`;

        await withTransaction(appkit, async (client) => {
          await client.query(
            `INSERT INTO true_up_records (
               true_up_id, line_id, project_id, true_up_type, estimated_centerline_length_ft,
               actual_centerline_length_ft, length_variance_pct, fitting_detail, valve_detail, support_detail,
               weld_count_estimated, weld_count_actual, flange_count_estimated, flange_count_actual,
               mto_weight_estimated_lb, mto_weight_actual_lb, mto_cost_estimated_usd, mto_cost_actual_usd,
               isometric_drawing_ref, pid_ref, performed_by, performed_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW())`,
            [
              trueUpId, lineId, line.project_id, opts.trueUpType, estimated, b.actualCenterlineLengthFt,
              Math.round(variancePct * 10) / 10, JSON.stringify(b.fittingDetail), JSON.stringify(b.valveDetail),
              JSON.stringify(b.supportDetail), null, b.weldCountActual ?? null, null, b.flangeCountActual ?? null,
              null, b.mtoWeightActualLb ?? null, null, b.mtoCostActualUsd ?? null, null, null, identity.email,
            ],
          );
          for (let i = 0; i < b.changeLog.length; i++) {
            const entry = b.changeLog[i];
            await client.query(
              `INSERT INTO change_log (change_id, true_up_id, line_id, reason_category, reason_text, changed_by, changed_at)
               VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
              [`${trueUpId}-CH${i + 1}`, trueUpId, lineId, entry.reasonCategory, entry.reasonText ?? null, identity.email],
            );
          }
          await insertStageEvent(client, {
            lineId, projectId: line.project_id, stageNumber: opts.toStage, actorEmail: identity.email,
            actorRole,
          });
          await client.query('UPDATE lines SET current_stage = $1, updated_at = NOW() WHERE line_id = $2', [
            opts.toStage, lineId,
          ]);
        });

        res.status(201).json({ lineId, trueUpId, currentStage: opts.toStage, variancePct });
      } catch (err) {
        console.error('POST true-up submit failed:', err);
        res.status(500).json({ error: 'Failed to submit true-up' });
      }
    }

    async function handleTrueUpConfirm(
      req: Request<{ lineId: string }>,
      res: Response,
      opts: { trueUpType: 'PRELIMINARY' | 'FINAL'; fromStage: number; toStage: number },
    ) {
      try {
        const { lineId } = req.params;
        const line = await loadLine(appkit, lineId);
        if (!line) {
          res.status(404).json({ error: 'Line not found' });
          return;
        }
        const identity = await getRequestIdentity(req);
        const effective = await getEffectiveRole(appkit, req, identity, line.project_id);
        if (!effective.role) {
          res.status(403).json({ error: 'You do not have access to this project.' });
          return;
        }
        if (!requireRole(res, effective, ['Lead Engineer'])) return;
        const actorRole = effective.role;
        if (line.current_stage !== opts.fromStage) {
          res.status(409).json({
            error: `Line is at stage ${line.current_stage} (${STAGE_NAMES[line.current_stage]}), expected stage ${opts.fromStage}.`,
          });
          return;
        }
        const trueUpId = `${lineId}-TU-${opts.trueUpType.slice(0, 3)}`;

        await withTransaction(appkit, async (client) => {
          const result = await client.query(
            'UPDATE true_up_records SET confirmed_by = $1, confirmed_at = NOW() WHERE true_up_id = $2',
            [identity.email, trueUpId],
          );
          if (!result.rowCount) {
            throw new Error(`True-up record ${trueUpId} not found`);
          }
          await insertStageEvent(client, {
            lineId, projectId: line.project_id, stageNumber: opts.toStage, actorEmail: identity.email,
            actorRole,
          });
          const isFinal = opts.trueUpType === 'FINAL';
          await client.query(
            `UPDATE lines SET current_stage = $1, is_complete = $2, updated_at = NOW() WHERE line_id = $3`,
            [opts.toStage, isFinal, lineId],
          );
        });

        res.json({ lineId, currentStage: opts.toStage, isComplete: opts.trueUpType === 'FINAL' });
      } catch (err) {
        console.error('POST true-up confirm failed:', err);
        res.status(500).json({ error: 'Failed to confirm true-up' });
      }
    }
  });
}
