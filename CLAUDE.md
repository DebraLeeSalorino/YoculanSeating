# Yoculan Seating — notes for Claude Code

The brief is `docs/spec.md`. Its section numbers are referenced throughout the code. When behaviour
and spec disagree, ask the owner rather than guessing; record decided changes in the spec itself.

## Stack
- Next.js 15 (App Router) + React 19, TypeScript, strict mode.
- Postgres via Drizzle ORM (`src/db/schema.ts`). Migrations in `drizzle/`, generated with
  `npm run db:generate -- --name <what>` and applied with `npm run db:migrate`. Never edit an applied migration.
- Vitest against a real Postgres database (`yoculan_test`). The test run drops and rebuilds that database.

## Layout
- `src/domain/` — all business rules. Every exported action takes an `Actor` and calls `authorize()`
  from `permissions.ts` first. The server must refuse anything a role can't do (section 10.1); the UI
  only hides it.
- `src/app/` — screens and server actions. Keep them thin: parse input, call a domain function, show the result.
- `src/lib/` — helpers with no business rules (passwords, tokens, mail, phone numbers).
- `tests/` — one file per area. Acceptance criteria from spec section 12 should each have a test.

## Rules that are easy to break
- Every sale or payment that changes what's sold must run inside a transaction that calls
  `lockEventSales()` then `assertCanSell()` (`src/domain/capacity.ts`). Capacity is worked out only there.
- Payment records and customers are never hard-deleted (customers get `deletedAt`).
- Tokens (sessions, invites, resets) are stored only as SHA-256 hashes.
- Door staff never see phone numbers or emails.
- Eventbrite orders are entered by hand by admins (spec 3.3). Keep `orders.channel` and
  `eventbrite_order_number` so an automatic import can be added later (spec 3.3.1).
- Money is whole cents.

## Commands
- `npm test` — tests (needs Postgres; see README).
- `npm run typecheck`, `npm run build`.
- `npm run setup -- --name ... --email ... --event ... --date YYYY-MM-DD` — first admin and event.
