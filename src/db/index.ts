import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { __pool?: Pool; __db?: Db };

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

export const pool: Pool = globalForDb.__pool ?? new Pool({ connectionString: connectionString(), max: 10 });
export const db: Db = globalForDb.__db ?? drizzle(pool, { schema });

// Reuse one pool across hot reloads in development only.
if (process.env.NODE_ENV === "development") {
  globalForDb.__pool = pool;
  globalForDb.__db = db;
}

export { schema };
