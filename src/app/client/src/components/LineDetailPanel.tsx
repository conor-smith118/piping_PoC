import { useEffect, useState, useCallback } from 'react';
import {
  SheetHeader,
  SheetTitle,
  SheetDescription,
  Badge,
  Button,
  Textarea,
  Skeleton,
  Alert,
  Separator,
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@databricks/appkit-ui/react';
import { api, type LineDetail, type Role } from '../lib/api';
import { CreateLineForm } from './forms/CreateLineForm';
import { TrueUpForm } from './forms/TrueUpForm';

const STAGE_NAMES: Record<number, string> = {
  1: 'Initial Data Entry', 2: 'Initial Engineer Confirmation', 3: 'Preliminary True-Up Complete',
  4: 'Engineer Prelim True-Up Confirmation', 5: 'Final True-Up Complete', 6: 'Engineer Final Confirmation',
};
// Given a line's CURRENT stage, which role acts NEXT to advance it — NOT
// which role's action produced that stage (a real bug: this used to read
// {1: 'Estimator', 2: 'Lead Engineer', ...}, i.e. "who performed stage N's
// action," which meant a line sitting AT stage 1 showed the Confirm button
// to the Estimator who just created it — instead of the Lead Engineer who
// actually confirms Initial Data Entry — and simultaneously told a Lead
// Engineer looking at that same line "waiting on Estimator," backwards. The
// server-side role gate on each route was never wrong — POST
// /confirm-initial has always correctly required Lead Engineer — so this
// only ever produced a correct-but-confusing 403 for the Estimator, never a
// real authorization gap). Stage 6 has no entry: `is_complete` is already
// true by the time current_stage reaches 6 (set in the same transaction as
// the final confirmation), so the `line.is_complete` branch below always
// short-circuits first.
const STAGE_ROLE: Record<number, Role> = {
  1: 'Lead Engineer', 2: 'Design Lead', 3: 'Lead Engineer', 4: 'Design Lead', 5: 'Lead Engineer',
};

function ConfirmAction({
  label,
  onConfirm,
}: {
  label: string;
  onConfirm: (notes?: string) => Promise<void>;
}) {
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      await onConfirm(notes || undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3 px-4 py-2">
      {error && <Alert variant="destructive">{error}</Alert>}
      <Textarea placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      <Button
        className="w-full"
        disabled={pending}
        onClick={() => {
          void handleClick();
        }}
      >
        {pending ? 'Confirming…' : label}
      </Button>
    </div>
  );
}

export function LineDetailPanel({
  lineId,
  onChanged,
  onDeleted,
}: {
  lineId: string;
  onChanged: () => void | Promise<void>;
  /** Called instead of re-loading this (now-deleted) line — the parent
   * closes the sheet, since there's nothing left here to show. */
  onDeleted: () => void | Promise<void>;
}) {
  const [detail, setDetail] = useState<LineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDetail(await api.getLine(lineId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [lineId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function afterAction() {
    await load();
    await onChanged();
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteLine(lineId);
      await onDeleted();
    } catch (e) {
      setDeleteError((e as Error).message);
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  }
  if (error || !detail) {
    return <Alert variant="destructive" className="m-4">{error ?? 'Line not found'}</Alert>;
  }

  const { line, effectiveRole } = detail;
  const stage = line.current_stage;
  const requiredRole = STAGE_ROLE[stage];
  const canAct = !line.is_complete && effectiveRole === requiredRole;
  // Same stage-1-only boundary as the server routes (see the big comment on
  // PUT /api/lines/:lineId) — an Estimator can correct or remove a line
  // only before the Lead Engineer has confirmed Initial Data Entry.
  const canEditOrDelete = !line.is_complete && stage === 1 && effectiveRole === 'Estimator';

  if (editing) {
    return (
      <div className="flex flex-col h-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit {line.line_no} — {line.service}</SheetTitle>
          <SheetDescription>Stage 1 · Estimator</SheetDescription>
        </SheetHeader>
        <CreateLineForm
          mode="edit"
          lineId={lineId}
          projectId={line.project_id}
          initialLine={line}
          onDone={async () => {
            setEditing(false);
            await afterAction();
          }}
        />
        <div className="px-4 pb-4">
          <Button variant="ghost" className="w-full" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <SheetHeader>
        <SheetTitle>{line.line_no} — {line.service}</SheetTitle>
        <SheetDescription>
          {line.line_class_spec} · {line.nominal_size_in}&quot; · {line.material}
        </SheetDescription>
      </SheetHeader>

      <div className="px-4 flex items-center gap-2">
        <Badge>{line.is_complete ? 'Complete' : STAGE_NAMES[stage]}</Badge>
        {!line.is_complete && (
          <span className="text-xs text-muted-foreground">Next action: {requiredRole}</span>
        )}
      </div>

      {canEditOrDelete && (
        <div className="px-4 flex items-center gap-2 mt-3">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          {/* Controlled (not the uncontrolled Trigger-only pattern) so the
              dialog stays open on a failed delete to show the error — a
              plain AlertDialogAction closes on click unconditionally
              (it's a Radix "confirm and dismiss" primitive), which would
              silently swallow a failed request with nothing left on screen
              to show for it. */}
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive">
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {line.line_no}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes the line and its Initial Data Entry record. This can only be
                  done before a Lead Engineer confirms it, and can&apos;t be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {deleteError && <Alert variant="destructive">{deleteError}</Alert>}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                <Button
                  variant="destructive"
                  disabled={deleting}
                  onClick={() => {
                    void handleDelete();
                  }}
                >
                  {deleting ? 'Deleting…' : 'Delete line'}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      <Separator className="my-4" />

      <div className="px-4 space-y-1 text-sm">
        <Row k="Estimated centerline length" v={`${line.estimated_centerline_length_ft} ft`} />
        <Row k="P&ID reference" v={String(line.pid_reference ?? '—')} />
        <Row k="Isometric drawing" v={String(line.isometric_drawing_no ?? '—')} />
        <Row k="Design conditions" v={`${line.design_pressure_psig ?? '—'} psig / ${line.design_temperature_f ?? '—'}°F`} />
      </div>

      <Separator className="my-4" />

      <div className="px-4">
        <h4 className="text-sm font-semibold mb-2">Stage history</h4>
        <div className="space-y-2">
          {detail.stageHistory.map((ev) => (
            <div key={ev.event_id} className="flex justify-between text-xs">
              <span>
                <span className="font-medium">{ev.stage_name}</span>
                <span className="text-muted-foreground"> — {ev.actor_role} ({ev.actor_email})</span>
              </span>
              <span className="text-muted-foreground shrink-0 ml-2">
                {new Date(ev.event_timestamp).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>

      {detail.trueUpRecords.length > 0 && (
        <>
          <Separator className="my-4" />
          <div className="px-4">
            <h4 className="text-sm font-semibold mb-2">True-up records</h4>
            {detail.trueUpRecords.map((t) => (
              <div key={String(t.true_up_id)} className="text-xs border rounded-md p-2 mb-2">
                <div className="flex justify-between font-medium mb-1">
                  <span>{String(t.true_up_type)}</span>
                  <span>{t.confirmed_at ? 'Confirmed' : 'Awaiting confirmation'}</span>
                </div>
                <Row k="Estimated / actual length" v={`${t.estimated_centerline_length_ft} / ${t.actual_centerline_length_ft} ft`} />
                <Row k="Variance" v={`${t.length_variance_pct}%`} />
              </div>
            ))}
          </div>
        </>
      )}

      <Separator className="my-4" />

      <div className="pb-4">
        {line.is_complete ? (
          <p className="px-4 text-sm text-muted-foreground">This line is fully confirmed.</p>
        ) : !canAct ? (
          <p className="px-4 text-sm text-muted-foreground">
            Waiting on a <span className="font-medium">{requiredRole}</span> to act — you&apos;re viewing as {effectiveRole}.
          </p>
        ) : stage === 1 ? (
          <ConfirmAction label="Confirm Initial Data Entry" onConfirm={async (notes) => { await api.confirmInitial(lineId, notes); await afterAction(); }} />
        ) : stage === 2 ? (
          <TrueUpForm lineId={lineId} trueUpType="PRELIMINARY" estimatedCenterlineLengthFt={line.estimated_centerline_length_ft} onDone={afterAction} />
        ) : stage === 3 ? (
          <ConfirmAction label="Confirm Preliminary True-Up" onConfirm={async () => { await api.confirmPreliminaryTrueUp(lineId); await afterAction(); }} />
        ) : stage === 4 ? (
          <TrueUpForm lineId={lineId} trueUpType="FINAL" estimatedCenterlineLengthFt={line.estimated_centerline_length_ft} onDone={afterAction} />
        ) : stage === 5 ? (
          <ConfirmAction label="Confirm Final True-Up (completes line)" onConfirm={async () => { await api.confirmFinalTrueUp(lineId); await afterAction(); }} />
        ) : null}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}

export function NewLinePanel({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: () => void | Promise<void>;
}) {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <SheetHeader>
        <SheetTitle>New line — Initial Data Entry</SheetTitle>
        <SheetDescription>Stage 1 · Estimator</SheetDescription>
      </SheetHeader>
      <CreateLineForm projectId={projectId} onDone={onDone} />
    </div>
  );
}
