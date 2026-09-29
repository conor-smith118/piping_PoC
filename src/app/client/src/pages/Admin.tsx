import { useCallback, useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Alert,
  Skeleton,
  Empty,
  Badge,
} from '@databricks/appkit-ui/react';
import { api, type AdminOverview, type Me, type Role } from '../lib/api';

/**
 * Admin-only: manage per-project role assignments (`user_project_role`) and
 * see, at a glance, which workspace group a target user needs to already be
 * a member of for a given in-app role.
 *
 * Deliberately does NOT include project create/edit. This PoC's 5 live
 * projects are each hardcoded into their own dashboard
 * (resources/dashboards/*.dashboard.yml) and Genie agent
 * (resources/genie_spaces/*.genie-space.yml) — creating a 6th project here
 * would silently get neither, which is a worse experience than not offering
 * the feature at all. Real project provisioning would need to extend those
 * bundle resources too, not just insert a Lakebase row.
 */
export function Admin() {
  const [me, setMe] = useState<Me | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const [projectId, setProjectId] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, o] = await Promise.all([api.me(), api.getAdminOverview()]);
      setMe(m);
      setOverview(o);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return <Alert variant="destructive" className="max-w-2xl mx-auto">{error}</Alert>;
  }
  if (!me || !overview) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!me.eligibleRoles.includes('Admin')) {
    return <Empty className="max-w-2xl mx-auto py-12">Admins only.</Empty>;
  }

  async function handleAssign() {
    if (!userEmail || !projectId || !role) return;
    setSaving(true);
    try {
      await api.assignRole(userEmail, projectId, role);
      setUserEmail('');
      setProjectId('');
      setRole('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke(email: string, pid: string) {
    setSaving(true);
    try {
      await api.revokeRole(email, pid);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const projectName = (pid: string) => overview.projects.find((p) => p.projectId === pid)?.projectName ?? pid;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Admin</h1>
        <p className="text-sm text-muted-foreground">Manage per-project role assignments.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">In-app role &harr; workspace group</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            An assignment made below only takes effect if the target user is <em>also</em> a real member of the
            matching workspace group &mdash; that eligibility check runs independently on every request, so a
            mismatched assignment here simply has no effect rather than granting unintended access.
          </p>
          <div className="flex flex-wrap gap-2">
            {overview.roles.map((r) => (
              <Badge key={r} variant="outline" className="text-xs">
                {r} &rarr; {overview.roleToGroup[r]}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Assign a role</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div className="space-y-1">
              <Label htmlFor="admin-email">User email</Label>
              <Input
                id="admin-email"
                type="email"
                placeholder="someone@example-epc.com"
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {overview.projects.map((p) => (
                    <SelectItem key={p.projectId} value={p.projectId}>
                      {p.projectId} &mdash; {p.projectName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {overview.roles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button disabled={!userEmail || !projectId || !role || saving} onClick={() => void handleAssign()}>
              Assign
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Current assignments ({overview.assignments.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {overview.assignments.length === 0 ? (
            <Empty className="py-8">No role assignments yet.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Assigned by</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.assignments.map((a) => (
                  <TableRow key={`${a.userEmail}-${a.projectId}`}>
                    <TableCell className="text-sm">{a.userEmail}</TableCell>
                    <TableCell className="text-sm">{projectName(a.projectId)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{a.role}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.assignedBy ?? '—'}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={saving}
                        onClick={() => void handleRevoke(a.userEmail, a.projectId)}
                      >
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
