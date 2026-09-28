import { useState } from 'react';
import {
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@databricks/appkit-ui/react';
import type { Me, Role } from '../lib/api';
import { api } from '../lib/api';

const ROLE_VARIANT: Record<Role, 'default' | 'secondary' | 'outline'> = {
  Estimator: 'secondary',
  'Lead Engineer': 'default',
  'Design Lead': 'default',
  Admin: 'outline',
};

/**
 * Top-right role badge. Shows the caller's effective role for the current
 * project. If they're an Admin-group member, also shows the bounded "view as"
 * switcher — see ARCHITECTURE.md for why it only offers roles the caller is
 * actually a group-member of (never an unbounded superuser bypass).
 */
export function RoleBadge({
  effectiveRole,
  isOverride,
  me,
  onViewAsChanged,
}: {
  effectiveRole: Role;
  isOverride: boolean;
  me: Me;
  onViewAsChanged: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const isAdmin = me.eligibleRoles.includes('Admin');

  async function handleChange(value: string) {
    setPending(true);
    try {
      await api.setViewAs(value === '__real__' ? null : (value as Role));
      await onViewAsChanged();
    } finally {
      setPending(false);
    }
  }

  if (!isAdmin) {
    return (
      <Badge variant={ROLE_VARIANT[effectiveRole]} className="text-sm px-3 py-1">
        {effectiveRole}
      </Badge>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Badge variant={ROLE_VARIANT[effectiveRole]} className="text-sm px-3 py-1">
        {effectiveRole}
        {isOverride && ' (viewing as)'}
      </Badge>
      <Select
        value={isOverride ? effectiveRole : '__real__'}
        onValueChange={(v) => {
          void handleChange(v);
        }}
        disabled={pending}
      >
        <SelectTrigger className="w-[160px] h-8 text-xs">
          <SelectValue placeholder="View as..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__real__">My real role</SelectItem>
          {me.eligibleRoles.map((r) => (
            <SelectItem key={r} value={r}>
              View as {r}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
