import { useState } from 'react';
import {
  Button,
  Input,
  Label,
  Textarea,
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Alert,
} from '@databricks/appkit-ui/react';
import { api } from '../../lib/api';

// Field pools grounded in the S3D/line-list research (see ARCHITECTURE.md) —
// real EPC vocabulary, not generic placeholders.
const MATERIALS = ['Carbon Steel', 'Stainless 304', 'Stainless 316', 'Chrome Moly (P11)', 'Chrome Moly (P22)', 'HDPE', 'PVC'];
const SCHEDULES = ['SCH 40', 'SCH 80', 'SCH 160', 'XS', 'STD', 'XXS'];
const END_CONNECTIONS = ['Flanged', 'Butt-Weld', 'Threaded', 'Socket-Weld'];
const FLANGE_RATINGS = ['150#', '300#', '600#', '900#'];
const INSULATION_TYPES = ['Mineral Wool', 'Calcium Silicate', 'Foam Glass'];

interface FormState {
  service: string;
  originTag: string;
  destinationTag: string;
  areaPackageZone: string;
  pidReference: string;
  isometricDrawingNo: string;
  lineClassSpec: string;
  nominalSizeIn: string;
  scheduleThickness: string;
  material: string;
  endConnections: string;
  flangeRating: string;
  designPressurePsig: string;
  designTemperatureF: string;
  operatingPressurePsig: string;
  operatingTemperatureF: string;
  corrosionAllowanceIn: string;
  insulationType: string;
  insulationThicknessIn: string;
  heatTracingFlag: boolean;
  heatTracingSpec: string;
  estimatedCenterlineLengthFt: string;
  specialNotes: string;
}

const EMPTY: FormState = {
  service: '', originTag: '', destinationTag: '', areaPackageZone: '', pidReference: '', isometricDrawingNo: '',
  lineClassSpec: '', nominalSizeIn: '', scheduleThickness: '', material: '', endConnections: '', flangeRating: '',
  designPressurePsig: '', designTemperatureF: '', operatingPressurePsig: '', operatingTemperatureF: '',
  corrosionAllowanceIn: '', insulationType: '', insulationThicknessIn: '', heatTracingFlag: false,
  heatTracingSpec: '', estimatedCenterlineLengthFt: '', specialNotes: '',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/** Stage 1: Initial Data Entry (Estimator). */
export function CreateLineForm({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: () => void | Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await api.createLine(projectId, {
        service: form.service,
        originTag: form.originTag || undefined,
        destinationTag: form.destinationTag || undefined,
        areaPackageZone: form.areaPackageZone || undefined,
        pidReference: form.pidReference || undefined,
        isometricDrawingNo: form.isometricDrawingNo || undefined,
        lineClassSpec: form.lineClassSpec,
        nominalSizeIn: Number(form.nominalSizeIn),
        scheduleThickness: form.scheduleThickness || undefined,
        material: form.material,
        endConnections: form.endConnections || undefined,
        flangeRating: form.flangeRating || undefined,
        designPressurePsig: form.designPressurePsig ? Number(form.designPressurePsig) : undefined,
        designTemperatureF: form.designTemperatureF ? Number(form.designTemperatureF) : undefined,
        operatingPressurePsig: form.operatingPressurePsig ? Number(form.operatingPressurePsig) : undefined,
        operatingTemperatureF: form.operatingTemperatureF ? Number(form.operatingTemperatureF) : undefined,
        corrosionAllowanceIn: form.corrosionAllowanceIn ? Number(form.corrosionAllowanceIn) : undefined,
        insulationType: form.insulationType || null,
        insulationThicknessIn: form.insulationThicknessIn ? Number(form.insulationThicknessIn) : null,
        heatTracingFlag: form.heatTracingFlag,
        heatTracingSpec: form.heatTracingFlag ? form.heatTracingSpec || undefined : null,
        estimatedCenterlineLengthFt: Number(form.estimatedCenterlineLengthFt),
        specialNotes: form.specialNotes || null,
      });
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = form.service && form.lineClassSpec && form.nominalSizeIn && form.material && form.estimatedCenterlineLengthFt;

  return (
    <div className="space-y-5 px-4 py-2">
      {error && <Alert variant="destructive">{error}</Alert>}

      <div>
        <h4 className="text-sm font-semibold mb-2">Identification</h4>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Service *">
            <Input value={form.service} onChange={(e) => set('service', e.target.value)} placeholder="e.g. Fuel Gas" />
          </Field>
          <Field label="Area / Package / Zone">
            <Input value={form.areaPackageZone} onChange={(e) => set('areaPackageZone', e.target.value)} />
          </Field>
          <Field label="Origin tag">
            <Input value={form.originTag} onChange={(e) => set('originTag', e.target.value)} placeholder="e.g. P-101" />
          </Field>
          <Field label="Destination tag">
            <Input value={form.destinationTag} onChange={(e) => set('destinationTag', e.target.value)} placeholder="e.g. V-501" />
          </Field>
          <Field label="P&ID reference">
            <Input value={form.pidReference} onChange={(e) => set('pidReference', e.target.value)} />
          </Field>
          <Field label="Isometric drawing no.">
            <Input value={form.isometricDrawingNo} onChange={(e) => set('isometricDrawingNo', e.target.value)} />
          </Field>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold mb-2">Pipe Specification</h4>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Line class / spec *">
            <Input value={form.lineClassSpec} onChange={(e) => set('lineClassSpec', e.target.value)} placeholder="e.g. Class 300 CS" />
          </Field>
          <Field label="Nominal size (in) *">
            <Input type="number" value={form.nominalSizeIn} onChange={(e) => set('nominalSizeIn', e.target.value)} />
          </Field>
          <Field label="Material *">
            <Select value={form.material} onValueChange={(v) => set('material', v)}>
              <SelectTrigger><SelectValue placeholder="Select material" /></SelectTrigger>
              <SelectContent>{MATERIALS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Schedule / thickness">
            <Select value={form.scheduleThickness} onValueChange={(v) => set('scheduleThickness', v)}>
              <SelectTrigger><SelectValue placeholder="Select schedule" /></SelectTrigger>
              <SelectContent>{SCHEDULES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="End connections">
            <Select value={form.endConnections} onValueChange={(v) => set('endConnections', v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{END_CONNECTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Flange rating">
            <Select value={form.flangeRating} onValueChange={(v) => set('flangeRating', v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{FLANGE_RATINGS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold mb-2">Design Conditions</h4>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Design pressure (psig)">
            <Input type="number" value={form.designPressurePsig} onChange={(e) => set('designPressurePsig', e.target.value)} />
          </Field>
          <Field label="Design temperature (°F)">
            <Input type="number" value={form.designTemperatureF} onChange={(e) => set('designTemperatureF', e.target.value)} />
          </Field>
          <Field label="Operating pressure (psig)">
            <Input type="number" value={form.operatingPressurePsig} onChange={(e) => set('operatingPressurePsig', e.target.value)} />
          </Field>
          <Field label="Operating temperature (°F)">
            <Input type="number" value={form.operatingTemperatureF} onChange={(e) => set('operatingTemperatureF', e.target.value)} />
          </Field>
          <Field label="Corrosion allowance (in)">
            <Input type="number" value={form.corrosionAllowanceIn} onChange={(e) => set('corrosionAllowanceIn', e.target.value)} />
          </Field>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold mb-2">Insulation & Tracing</h4>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Insulation type">
            <Select value={form.insulationType} onValueChange={(v) => set('insulationType', v)}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>{INSULATION_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Insulation thickness (in)">
            <Input type="number" value={form.insulationThicknessIn} onChange={(e) => set('insulationThicknessIn', e.target.value)} disabled={!form.insulationType} />
          </Field>
          <div className="flex items-center gap-2 pt-5">
            <Checkbox checked={form.heatTracingFlag} onCheckedChange={(c) => set('heatTracingFlag', !!c)} />
            <Label className="text-sm">Heat tracing required</Label>
          </div>
          <Field label="Heat tracing spec">
            <Input value={form.heatTracingSpec} onChange={(e) => set('heatTracingSpec', e.target.value)} disabled={!form.heatTracingFlag} placeholder="e.g. Self-regulating, 10W/ft" />
          </Field>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold mb-2">Estimate (true-up baseline)</h4>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Estimated centerline length (ft) *">
            <Input type="number" value={form.estimatedCenterlineLengthFt} onChange={(e) => set('estimatedCenterlineLengthFt', e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          This baseline is what both true-up stages will reconcile against later.
        </p>
      </div>

      <Field label="Special notes">
        <Textarea value={form.specialNotes} onChange={(e) => set('specialNotes', e.target.value)} rows={2} />
      </Field>

      <Button
        className="w-full"
        disabled={!canSubmit || submitting}
        onClick={() => {
          void handleSubmit();
        }}
      >
        {submitting ? 'Creating…' : 'Create line (Stage 1)'}
      </Button>
    </div>
  );
}
