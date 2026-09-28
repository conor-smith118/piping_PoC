import { useState } from 'react';
import {
  Button,
  Input,
  Label,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Alert,
  Badge,
} from '@databricks/appkit-ui/react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';

const REASON_CATEGORIES = ['DESIGN_CHANGE', 'CONSTRUCTABILITY', 'ESTIMATING_ERROR', 'OTHER'] as const;

interface ChangeEntry {
  id: string;
  reasonCategory: (typeof REASON_CATEGORIES)[number];
  reasonText: string;
}

/**
 * Stage 3 / Stage 5: True-Up Complete (Design Lead). Baseline-vs-actual side
 * by side, per the S3D true-up research in ARCHITECTURE.md — the Design Lead
 * needs the estimate right next to the field to reconcile against, plus a
 * change/reason log for anything that moved. Itemized per-fitting-type
 * baselines aren't collected at line creation (v1 scope decision), so this
 * form collects actual totals only, not a full estimated/actual breakdown
 * per fitting type — the historical/synthetic data is richer here than the
 * live human-entry form, which is intentionally kept fast to fill out.
 */
export function TrueUpForm({
  lineId,
  trueUpType,
  estimatedCenterlineLengthFt,
  onDone,
}: {
  lineId: string;
  trueUpType: 'PRELIMINARY' | 'FINAL';
  estimatedCenterlineLengthFt: number | null;
  onDone: () => void | Promise<void>;
}) {
  const [actualLength, setActualLength] = useState('');
  const [weldCountActual, setWeldCountActual] = useState('');
  const [flangeCountActual, setFlangeCountActual] = useState('');
  const [mtoWeightActualLb, setMtoWeightActualLb] = useState('');
  const [mtoCostActualUsd, setMtoCostActualUsd] = useState('');
  const [changes, setChanges] = useState<ChangeEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseline = estimatedCenterlineLengthFt ?? 0;
  const actual = Number(actualLength);
  const variancePct = baseline > 0 && actualLength ? ((actual - baseline) / baseline) * 100 : null;

  function addChange() {
    setChanges((c) => [...c, { id: crypto.randomUUID(), reasonCategory: 'DESIGN_CHANGE', reasonText: '' }]);
  }
  function removeChange(id: string) {
    setChanges((c) => c.filter((entry) => entry.id !== id));
  }
  function updateChange(id: string, patch: Partial<ChangeEntry>) {
    setChanges((c) => c.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        actualCenterlineLengthFt: actual,
        fittingDetail: [],
        valveDetail: [],
        supportDetail: [],
        weldCountActual: weldCountActual ? Number(weldCountActual) : undefined,
        flangeCountActual: flangeCountActual ? Number(flangeCountActual) : undefined,
        mtoWeightActualLb: mtoWeightActualLb ? Number(mtoWeightActualLb) : undefined,
        mtoCostActualUsd: mtoCostActualUsd ? Number(mtoCostActualUsd) : undefined,
        changeLog: changes.filter((c) => c.reasonText.trim().length > 0),
      };
      if (trueUpType === 'PRELIMINARY') await api.submitPreliminaryTrueUp(lineId, body);
      else await api.submitFinalTrueUp(lineId, body);
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5 px-4 py-2">
      {error && <Alert variant="destructive">{error}</Alert>}

      <div>
        <h4 className="text-sm font-semibold mb-2">Centerline length — baseline vs. actual</h4>
        <div className="grid grid-cols-3 gap-3 items-end">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Estimated (ft)</Label>
            <Input value={baseline} disabled className="bg-muted" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Actual (ft) *</Label>
            <Input type="number" value={actualLength} onChange={(e) => setActualLength(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Variance</Label>
            {variancePct !== null ? (
              <Badge variant={Math.abs(variancePct) > 15 ? 'destructive' : 'secondary'} className="text-sm">
                {variancePct > 0 ? '+' : ''}{variancePct.toFixed(1)}%
              </Badge>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold mb-2">Quantities (actual)</h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Weld count</Label>
            <Input type="number" value={weldCountActual} onChange={(e) => setWeldCountActual(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Flange count</Label>
            <Input type="number" value={flangeCountActual} onChange={(e) => setFlangeCountActual(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">MTO weight (lb)</Label>
            <Input type="number" value={mtoWeightActualLb} onChange={(e) => setMtoWeightActualLb(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">MTO cost (USD)</Label>
            <Input type="number" value={mtoCostActualUsd} onChange={(e) => setMtoCostActualUsd(e.target.value)} />
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold">Change / reason log</h4>
          <Button variant="outline" size="sm" onClick={addChange}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add reason
          </Button>
        </div>
        {changes.length === 0 && <p className="text-xs text-muted-foreground">No changes logged.</p>}
        <div className="space-y-2">
          {changes.map((c) => (
            <div key={c.id} className="flex gap-2 items-start">
              <Select value={c.reasonCategory} onValueChange={(v) => updateChange(c.id, { reasonCategory: v as ChangeEntry['reasonCategory'] })}>
                <SelectTrigger className="w-[160px] shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REASON_CATEGORIES.map((r) => <SelectItem key={r} value={r}>{r.replace('_', ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
              <Textarea
                value={c.reasonText}
                onChange={(e) => updateChange(c.id, { reasonText: e.target.value })}
                placeholder="What changed and why"
                rows={1}
                className="flex-1"
              />
              <Button variant="ghost" size="icon" onClick={() => removeChange(c.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <Button
        className="w-full"
        disabled={!actualLength || submitting}
        onClick={() => {
          void handleSubmit();
        }}
      >
        {submitting ? 'Submitting…' : `Submit ${trueUpType === 'PRELIMINARY' ? 'Preliminary' : 'Final'} True-Up`}
      </Button>
    </div>
  );
}
