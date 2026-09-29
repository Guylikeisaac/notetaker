import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// Reuse one pool across hot reloads in dev.
const globalForDb = globalThis as unknown as { __notetakerSql?: postgres.Sql };
// Recycle idle/old connections so a laptop sleep or network drop doesn't leave
// dead sockets in the pool.
const sql = globalForDb.__notetakerSql ?? postgres(url, { max: 10, idle_timeout: 20, max_lifetime: 30 * 60, connect_timeout: 15 });
if (process.env.NODE_ENV !== "production") globalForDb.__notetakerSql = sql;

export const db = drizzle(sql, { schema });
export * from "./schema";
export { and, asc, desc, eq, gt, gte, inArray, lt, lte, ne, or, sql as rawSql } from "drizzle-orm";
export { canSeeMeeting, setAttendees } from "./access";
