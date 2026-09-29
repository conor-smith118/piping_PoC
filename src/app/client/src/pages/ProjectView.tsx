import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Sheet,
  SheetContent,
  Skeleton,
  Alert,
  Progress,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@databricks/appkit-ui/react';
import { ArrowLeft } from 'lucide-react';
import { api, type ProjectDetail, type LineRow, type Me } from '../lib/api';
import { Timeline } from '../components/Timeline';
import { RoleBadge } from '../components/RoleBadge';
import { KanbanBoard } from '../components/KanbanBoard';
import { LineDetailPanel, NewLinePanel } from '../components/LineDetailPanel';
import { DashboardEmbed } from '../components/DashboardEmbed';
import { GenieAssistant } from '../components/GenieAssistant';

export function ProjectView() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [creatingLine, setCreatingLine] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [p, l, m] = await Promise.all([api.getProject(projectId), api.listLines(projectId), api.me()]);
      setProject(p);
      setLines(l);
      setMe(m);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !project) {
    return (
      <div className="max-w-6xl mx-auto space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (error || !project || !me) {
    return <Alert variant="destructive" className="max-w-2xl mx-auto">{error ?? 'Failed to load project'}</Alert>;
  }

  const sheetOpen = !!selectedLineId || creatingLine;

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/" className="text-xs text-muted-foreground flex items-center gap-1 mb-1 hover:underline">
            <ArrowLeft className="w-3 h-3" /> All projects
          </Link>
          <h1 className="text-xl font-semibold">{project.projectName}</h1>
          <p className="text-sm text-muted-foreground">
            {project.clientName} · {project.siteLocation}
          </p>
        </div>
        <RoleBadge effectiveRole={project.effectiveRole} isOverride={project.isOverride} me={me} onViewAsChanged={load} />
      </div>

      <Card>
        <CardContent className="pt-6">
          <Timeline project={project} />
          <div className="mt-4 flex items-center gap-3">
            <Progress value={project.pctComplete * 100} className="flex-1" />
            <span className="text-xs text-muted-foreground shrink-0">
              {project.linesComplete} / {project.totalLines} lines complete
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Project Insights</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="dashboard">
            <TabsList>
              <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
              <TabsTrigger value="genie">Ask Genie</TabsTrigger>
            </TabsList>
            <TabsContent value="dashboard">
              <DashboardEmbed projectId={project.projectId} />
            </TabsContent>
            <TabsContent value="genie">
              <GenieAssistant projectId={project.projectId} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-sm font-semibold mb-3">Lines</h2>
        <KanbanBoard
          lines={lines}
          effectiveRole={project.effectiveRole}
          onSelectLine={setSelectedLineId}
          onNewLine={() => setCreatingLine(true)}
        />
      </div>

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedLineId(null);
            setCreatingLine(false);
          }
        }}
      >
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          {creatingLine && (
            <NewLinePanel
              projectId={project.projectId}
              onDone={async () => {
                setCreatingLine(false);
                await load();
              }}
            />
          )}
          {selectedLineId && (
            <LineDetailPanel lineId={selectedLineId} onChanged={load} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
