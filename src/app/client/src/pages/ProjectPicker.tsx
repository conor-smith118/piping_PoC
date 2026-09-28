import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle, Badge, Progress, Skeleton, Alert, Empty } from '@databricks/appkit-ui/react';
import { api, type ProjectSummary } from '../lib/api';

export function ProjectPicker() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <Alert variant="destructive" className="max-w-2xl mx-auto">{error}</Alert>;
  if (!projects) {
    return (
      <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }
  if (projects.length === 0) {
    return <Empty className="max-w-2xl mx-auto py-12">No projects assigned to you yet.</Empty>;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold mb-1">Select a project</h1>
      <p className="text-sm text-muted-foreground mb-5">Pick a piping project to enter its workflow.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {projects.map((p) => (
          <Card
            key={p.projectId}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => {
              void navigate(`/projects/${p.projectId}`);
            }}
          >
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle className="text-base">{p.projectName}</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">{p.clientName} · {p.siteLocation}</p>
              </div>
              {p.yourRole && <Badge variant="outline">{p.yourRole}</Badge>}
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Progress value={p.pctComplete * 100} className="flex-1" />
                <span className="text-xs text-muted-foreground shrink-0">
                  {p.linesComplete} / {p.totalLines} lines
                </span>
              </div>
              {p.modeStageName && (
                <p className="text-xs text-muted-foreground mt-2">Bulk of work at: {p.modeStageName}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
