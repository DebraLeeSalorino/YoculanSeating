import { afterAll, beforeEach } from "vitest";
import { pool } from "@/db";
import { getMailer, MemoryMailer } from "@/lib/mail/mailer";
import { FakeSquare, getSquare } from "@/lib/square/client";

beforeEach(async () => {
  const { rows } = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  if (rows.length) {
    await pool.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`);
  }
  (getMailer() as MemoryMailer).clear();
  (getSquare() as FakeSquare).reset();
});

afterAll(async () => {
  await pool.end();
});
