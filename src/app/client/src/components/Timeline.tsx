import { Check } from 'lucide-react';
import { cn } from '../lib/utils';
import type { ProjectDetail } from '../lib/api';

const STAGES = [
  'Initial Data Entry',
  'Initial Engineer Confirmation',
  'Preliminary True-Up Complete',
  'Engineer Prelim True-Up Confirmation',
  'Final True-Up Complete',
  'Engineer Final Confirmation',
];

/**
 * The 6-stage project timeline. The "current" marker is the mode stage among
 * incomplete lines (where the bulk of remaining work is) — the min stage
 * (the laggard) is shown as a secondary annotation, not the headline, per
 * ARCHITECTURE.md's rollup design.
 */
export function Timeline({ project }: { project: ProjectDetail }) {
  const current = project.modeStage ?? 1;
  const laggard = project.minStage;

  return (
    <div>
      <div className="flex items-center">
        {STAGES.map((label, i) => {
          const stageNum = i + 1;
          const isDone = stageNum < current || project.pctComplete === 1;
          const isCurrent = stageNum === current && project.pctComplete < 1;
          return (
            <div key={label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1.5 w-28 text-center">
                <div
                  className={cn(
                    'flex items-center justify-center w-8 h-8 rounded-full border-2 text-sm font-medium shrink-0',
                    isDone && 'bg-primary border-primary text-primary-foreground',
                    isCurrent && 'border-primary text-primary',
                    !isDone && !isCurrent && 'border-muted-foreground/30 text-muted-foreground',
                  )}
                >
                  {isDone ? <Check className="w-4 h-4" /> : stageNum}
                </div>
                <span
                  className={cn(
                    'text-xs leading-tight',
                    isCurrent ? 'font-semibold text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {label}
                </span>
                {laggard !== null && laggard === stageNum && laggard < current && (
                  <span className="text-[10px] text-amber-600 font-medium">Laggard line here</span>
                )}
              </div>
              {stageNum < STAGES.length && (
                <div className={cn('h-0.5 flex-1 -mt-6', isDone ? 'bg-primary' : 'bg-muted-foreground/20')} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
