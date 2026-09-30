// Thin typed fetch layer over the server routes in server/routes/*.ts.
// Deliberately not using useAnalyticsQuery/config-queries — this app's
// interactive reads/writes go through Lakebase (see server/lib), not the SQL
// warehouse. Types here mirror the DTOs those routes actually return.

export type Role = 'Estimator' | 'Lead Engineer' | 'Design Lead' | 'Admin';

export interface Me {
  email: string;
  eligibleRoles: Role[];
  viewAsRole: Role | null;
  isDevFallback: boolean;
}

export interface ProjectSummary {
  projectId: string;
  projectName: string;
  clientName: string;
  siteLocation: string | null;
  status: string;
  yourRole: Role | null;
  totalLines: number;
  linesComplete: number;
  pctComplete: number;
  modeStage: number | null;
  modeStageName: string | null;
  minStage: number | null;
  minStageName: string | null;
}

export interface ProjectDetail extends Omit<ProjectSummary, 'yourRole'> {
  projectType: string | null;
  targetLineCount: number | null;
  createdAt: string;
  effectiveRole: Role;
  isOverride: boolean;
  eligibleRoles: Role[];
}

export interface LineRow {
  line_id: string;
  project_id: string;
  line_no: string;
  service: string | null;
  line_class_spec: string | null;
  nominal_size_in: number | null;
  material: string | null;
  estimated_centerline_length_ft: number | null;
  pid_reference: string | null;
  isometric_drawing_no: string | null;
  design_pressure_psig: number | null;
  design_temperature_f: number | null;
  current_stage: number;
  is_complete: boolean;
  latest_actor_email: string | null;
  latest_actor_role: string | null;
  latest_event_timestamp: string | null;
  latest_event_type: string | null;
}

// GET /api/lines/:lineId's `line` field is a raw `SELECT * FROM lines` row
// (server/routes/lines.ts's loadLine) — every column, unlike LineRow above
// (the Kanban board's narrower query). Needed in full for the edit form to
// pre-fill every field, not just the ones the Kanban card displays.
export interface LineDetailRow {
  line_id: string;
  project_id: string;
  line_no: string;
  service: string | null;
  origin_tag: string | null;
  destination_tag: string | null;
  area_package_zone: string | null;
  line_class_spec: string | null;
  nominal_size_in: number | null;
  schedule_thickness: string | null;
  material: string | null;
  design_pressure_psig: number | null;
  design_temperature_f: number | null;
  operating_pressure_psig: number | null;
  operating_temperature_f: number | null;
  corrosion_allowance_in: number | null;
  insulation_type: string | null;
  insulation_thickness_in: number | null;
  heat_tracing_flag: boolean;
  heat_tracing_spec: string | null;
  end_connections: string | null;
  flange_rating: string | null;
  pid_reference: string | null;
  isometric_drawing_no: string | null;
  estimated_centerline_length_ft: number | null;
  special_notes: string | null;
  current_stage: number;
  is_complete: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface LineDetail {
  line: LineDetailRow;
  effectiveRole: Role;
  isOverride: boolean;
  stageHistory: Array<{
    event_id: string;
    stage_number: number;
    stage_name: string;
    event_type: string;
    actor_email: string;
    actor_role: string;
    event_timestamp: string;
    notes: string | null;
  }>;
  trueUpRecords: TrueUpRecordRow[];
  changeLog: Array<Record<string, unknown>>;
}

export interface TrueUpRecordRow {
  true_up_id: string;
  true_up_type: 'PRELIMINARY' | 'FINAL';
  estimated_centerline_length_ft: number | null;
  actual_centerline_length_ft: number | null;
  length_variance_pct: number | null;
  confirmed_at: string | null;
}

interface ErrorBody {
  error?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as ErrorBody;
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface DashboardConfig {
  dashboardId: string | null;
  embedBaseUrl: string | null;
}

export interface RoleAssignment {
  userEmail: string;
  projectId: string;
  role: Role;
  assignedBy: string | null;
  assignedAt: string;
}

export interface AdminOverview {
  projects: Array<{ projectId: string; projectName: string }>;
  assignments: RoleAssignment[];
  roles: Role[];
  roleToGroup: Record<Role, string>;
}

export const api = {
  me: () => request<Me>('/api/me'),
  getConfig: (projectId: string) => request<DashboardConfig>(`/api/config?projectId=${encodeURIComponent(projectId)}`),
  setViewAs: (role: Role | null) =>
    request<{ role: Role | null }>('/api/view-as', { method: 'POST', body: JSON.stringify({ role }) }),

  listProjects: () => request<ProjectSummary[]>('/api/projects'),
  getProject: (projectId: string) => request<ProjectDetail>(`/api/projects/${projectId}`),
  listLines: (projectId: string) => request<LineRow[]>(`/api/projects/${projectId}/lines`),
  getLine: (lineId: string) => request<LineDetail>(`/api/lines/${lineId}`),

  createLine: (projectId: string, body: Record<string, unknown>) =>
    request<{ lineId: string; lineNo: string }>(`/api/projects/${projectId}/lines`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateLine: (lineId: string, body: Record<string, unknown>) =>
    request<{ lineId: string }>(`/api/lines/${lineId}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteLine: (lineId: string) => request<void>(`/api/lines/${lineId}`, { method: 'DELETE' }),
  confirmInitial: (lineId: string, notes?: string) =>
    request<{ lineId: string; currentStage: number }>(`/api/lines/${lineId}/confirm-initial`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),
  submitPreliminaryTrueUp: (lineId: string, body: Record<string, unknown>) =>
    request(`/api/lines/${lineId}/true-up/preliminary`, { method: 'POST', body: JSON.stringify(body) }),
  confirmPreliminaryTrueUp: (lineId: string) =>
    request(`/api/lines/${lineId}/true-up/preliminary/confirm`, { method: 'POST', body: JSON.stringify({}) }),
  submitFinalTrueUp: (lineId: string, body: Record<string, unknown>) =>
    request(`/api/lines/${lineId}/true-up/final`, { method: 'POST', body: JSON.stringify(body) }),
  confirmFinalTrueUp: (lineId: string) =>
    request(`/api/lines/${lineId}/true-up/final/confirm`, { method: 'POST', body: JSON.stringify({}) }),

  getAdminOverview: () => request<AdminOverview>('/api/admin/overview'),
  assignRole: (userEmail: string, projectId: string, role: Role) =>
    request<RoleAssignment>('/api/admin/roles', { method: 'POST', body: JSON.stringify({ userEmail, projectId, role }) }),
  revokeRole: (userEmail: string, projectId: string) =>
    request<void>('/api/admin/roles', { method: 'DELETE', body: JSON.stringify({ userEmail, projectId }) }),
};
