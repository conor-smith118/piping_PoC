import type { AppKitHandle, PoolClient } from './appkitTypes';

/** Runs `fn` in a single Postgres transaction. Every stage-advancing write in
 * this app goes through this — never a two-request pattern that could leave
 * `lines.current_stage` out of sync with `stage_events`. */
export async function withTransaction<T>(
  appkit: AppKitHandle,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await appkit.lakebase.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function pad(n: number, width: number): string {
  return n.toString().padStart(width, '0');
}
