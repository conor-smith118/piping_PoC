import type { Role } from './api';

// Shared role -> badge-color mapping, used by both RoleBadge (per-project
// effective-role badge) and ProjectPicker's landing-page identity indicator,
// so a role reads the same way everywhere in the app. Split into its own
// file (not exported alongside a component) to keep Vite's fast-refresh
// boundary clean — a plain constant re-exported from a component file
// triggers a "fast refresh only works when a file only exports components"
// eslint warning.
export const ROLE_VARIANT: Record<Role, 'default' | 'secondary' | 'outline'> = {
  Estimator: 'secondary',
  'Lead Engineer': 'default',
  'Design Lead': 'default',
  Admin: 'outline',
};
