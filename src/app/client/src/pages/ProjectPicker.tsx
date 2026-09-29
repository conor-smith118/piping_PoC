import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle, Badge, Progress, Skeleton, Alert, Empty } from '@databricks/appkit-ui/react';
import { api, type Me, type ProjectSummary } from '../lib/api';
import { ROLE_VARIANT } from '../lib/roleVariant';

export function ProjectPicker() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([api.listProjects(), api.me()])
      .then(([p, m]) => {
        setProjects(p);
        setMe(m);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <Alert variant="destructive" className="max-w-2xl mx-auto">{error}</Alert>;
  if (!projects || !me) {
    return (
      <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  const identityHeader = (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div>
        <h1 className="text-xl font-semibold mb-1">Select a project</h1>
        <p className="text-sm text-muted-foreground">Pick a piping project to enter its workflow.</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs text-muted-foreground mb-1">{me.email}</p>
        <div className="flex gap-1 justify-end flex-wrap">
          {me.eligibleRoles.length === 0 ? (
            <Badge variant="outline" className="text-xs">No role assigned</Badge>
          ) : (
            me.eligibleRoles.map((r) => (
              <Badge key={r} variant={ROLE_VARIANT[r]} className="text-xs">
                {r}
              </Badge>
            ))
          )}
        </div>
      </div>
    </div>
  );

  if (projects.length === 0) {
    return (
      <div className="max-w-4xl mx-auto">
        {identityHeader}
        <Empty className="py-12">No projects assigned to you yet.</Empty>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {identityHeader}
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
