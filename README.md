# Yoculan Seating

Tickets and seating for the annual gala: staff sell tickets, link buyers into groups, draw the room
and seat everyone so each group sits together. The full specification is in [`docs/spec.md`](docs/spec.md).

## Status

Release 1 (Sales) is in progress.

| Done | Still to come in release 1 |
| --- | --- |
| Accounts, invitations, sign-in, password reset | Square Terminal and payment-link charging |
| Admin, ticket seller and door staff roles, enforced on the server | Settings screen: prices, limits, capacity |
| Event switcher | Comps with admin approval |
| Customers: add, quick-add, edit, delete, search, duplicate-email warning | Refunds |
| Groups with automatic names | Buyer page and its email |
| Eventbrite orders entered by hand | Sales screen and seller totals |
| Capacity, sell-out and standing-room rules | Real email sending (Amazon SES) |

## Running it on your computer

You need Node.js 20 or later and PostgreSQL 16.

```bash
npm install
cp .env.example .env          # then edit DATABASE_URL if needed
createdb yoculan
npm run db:migrate
npm run setup -- --name "Your Name" --email you@example.org --event "Gala 2027" --date 2027-11-13 --seats 1200
npm run dev
```

The setup command prints a link for choosing your password. Until email is set up, every email the
app would send (invitations, password resets) is printed in the terminal and saved in `mail-log/`.

## Tests

```bash
createdb yoculan_test
npm test
```

The tests use the `yoculan_test` database and wipe it on every run. Set `TEST_DATABASE_URL` to use another.
