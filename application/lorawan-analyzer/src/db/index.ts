import postgres from 'postgres';
import type { PostgresConfig } from '../types.js';

let sql: ReturnType<typeof postgres> | null = null;

export function initPostgres(config: PostgresConfig): ReturnType<typeof postgres> {
  sql = postgres(config.url, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 30,
    onnotice: () => {},
  });
  return sql;
}

export function getDb(): ReturnType<typeof postgres> {
  if (!sql) {
    throw new Error('Postgres client not initialized');
  }
  return sql;
}

export async function closePostgres(): Promise<void> {
  if (sql) {
    await sql.end();
    sql = null;
  }
}
