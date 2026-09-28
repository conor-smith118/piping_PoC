import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Empty } from '@databricks/appkit-ui/react';
import { Plus } from 'lucide-react';
import type { LineRow, Role } from '../lib/api';

const STAGE_NAMES: Record<number, string> = {
  1: 'Initial Data Entry',
  2: 'Initial Engineer Confirmation',
  3: 'Preliminary True-Up',
  4: 'Prelim True-Up Confirmed',
  5: 'Final True-Up',
  6: 'Final Confirmed',
};

export function KanbanBoard({
  lines,
  effectiveRole,
  onSelectLine,
  onNewLine,
}: {
  lines: LineRow[];
  effectiveRole: Role;
  onSelectLine: (lineId: string) => void;
  onNewLine: () => void;
}) {
  const byStage = new Map<number, LineRow[]>();
  for (let s = 1; s <= 6; s++) byStage.set(s, []);
  for (const line of lines) {
    byStage.get(line.current_stage)?.push(line);
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {[1, 2, 3, 4, 5, 6].map((stage) => (
        <div key={stage} className="min-w-0">
          <div className="flex items-center justify-between px-1 mb-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {STAGE_NAMES[stage]}
            </h3>
            <Badge variant="outline" className="text-xs">
              {byStage.get(stage)?.length ?? 0}
            </Badge>
          </div>
          {stage === 1 && effectiveRole === 'Estimator' && (
            <Button variant="outline" size="sm" className="w-full mb-2" onClick={onNewLine}>
              <Plus className="w-3.5 h-3.5 mr-1" /> New line
            </Button>
          )}
          <div className="flex flex-col gap-2">
            {(byStage.get(stage) ?? []).map((line) => (
              <Card
                key={line.line_id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => onSelectLine(line.line_id)}
              >
                <CardHeader className="p-3 pb-1">
                  <CardTitle className="text-sm">{line.line_no}</CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0 space-y-1">
                  <p className="text-xs text-muted-foreground truncate">{line.service}</p>
                  <p className="text-xs text-muted-foreground">
                    {line.nominal_size_in}&quot; · {line.material}
                  </p>
                  {line.latest_actor_role && (
                    <p className="text-[10px] text-muted-foreground pt-1 border-t mt-1">
                      Last: {line.latest_actor_role}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
            {(byStage.get(stage) ?? []).length === 0 && (
              <Empty className="text-xs text-muted-foreground py-6">No lines</Empty>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
