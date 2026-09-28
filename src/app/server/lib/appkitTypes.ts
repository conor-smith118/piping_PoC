// Minimal local interface for the subset of AppKit we use — matches the pattern
// in the AppKit-scaffolded sample routes (avoids depending on AppKit's internal
// types, which aren't part of its public API surface). `query`'s generic is
// constrained to `QueryResultRow` to match pg's own signature exactly —
// otherwise TS treats our narrower method as incompatible with the real
// (more-constrained) one when the real `appkit` object is passed in
// structurally at each route-registration call site.
import type { Application } from 'express';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

export interface AppKitLakebase {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  // AppKit wraps the real pg.Pool in its own LakebasePool (token refresh,
  // etc.) that doesn't structurally match pg.Pool's full surface — we only
  // ever call .connect() (for the withTransaction helper in lib/db.ts), so
  // that's all this local type asks for.
  pool: { connect(): Promise<PoolClient> };
}

export interface AppKitServer {
  extend(fn: (app: Application) => void): void;
}

export interface AppKitHandle {
  lakebase: AppKitLakebase;
  server: AppKitServer;
}

export type { PoolClient };
