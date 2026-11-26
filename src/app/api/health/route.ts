import { pool } from "@/db";

export const dynamic = "force-dynamic";

/** Render checks this to know the app is up and can reach its database. */
export async function GET() {
  try {
    await pool.query("select 1");
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
