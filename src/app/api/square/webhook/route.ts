import { handleSquareWebhook } from "@/domain/square";

/** Square calls this when a payment or terminal checkout changes. Switched on once the app is online. */
export async function POST(request: Request) {
  const body = await request.text();
  const status = await handleSquareWebhook(body, request.headers.get("x-square-hmacsha256-signature"));
  return new Response(null, { status });
}
