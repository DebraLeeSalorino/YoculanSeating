# Putting the app online

The app runs on Render, sends email through Amazon SES, and lives at `yoculantickets.com` (DNS at
GoDaddy). Secrets (keys and tokens) are typed into Render only. They never go in this repository.

## 1. Create the app on Render

1. In Render, choose **New → Blueprint**, pick the `YoculanSeating` repository, and approve.
   Render reads `render.yaml` and creates the web service `yoculan-seating` and the database `yoculan-db`.
2. Render asks for the values marked secret. For now, fill in only:
   - `SQUARE_ACCESS_TOKEN`: the Square **sandbox** access token.
   - Leave `APP_URL`, `AWS_*` and `SQUARE_WEBHOOK_SIGNATURE_KEY` empty for now.
3. Wait for the first deploy to finish. The app is then at the `onrender.com` address Render shows.

Costs: the web service (Starter) and database (Basic 256 MB) are paid plans of a few dollars a month each.
Check Render's pricing page for current figures.

## 2. Create the first admin

In Render, open the `yoculan-seating` service, then **Shell**, and run:

```bash
npm run setup -- --name "Your Name" --email admin@yoculantickets.com --event "Yoculan Gala" --date 2027-11-13
```

It prints a link to choose your password. Open it, sign in, and finish the event details in **Settings**
(date and time, venue time zone, prices and limits).

## 3. Connect yoculantickets.com

1. In Render, open the service, then **Settings → Custom Domains**, and add `yoculantickets.com`, then
   `www.yoculantickets.com`.
2. Render shows the DNS records to create. In GoDaddy, open **My Products → yoculantickets.com → DNS**
   and add exactly those records. Don't change the MX records: they deliver `admin@yoculantickets.com`.
   GoDaddy may already have an `A` record for `@` pointing at a parking page; edit that one to Render's
   value rather than adding a second.
3. When Render shows the domain as verified (minutes to a few hours), set `APP_URL` to
   `https://yoculantickets.com` in the service's **Environment** and save.

## 4. Email through Amazon SES

### Verify the domain

1. In the AWS console, pick the region you'll use (top right; for example US East (N. Virginia)),
   then open **Amazon SES → Identities → Create identity**.
2. Choose **Domain**, enter `yoculantickets.com`.
3. Tick **Use a custom MAIL FROM domain** and enter `mail` (making `mail.yoculantickets.com`).
   For "Behavior on MX failure" choose **Use default MAIL FROM domain**.
4. Leave **Easy DKIM** with **RSA_2048_BIT**, and turn **DKIM signatures** on. Create the identity.
5. SES lists DNS records: three `CNAME` records for DKIM, and an `MX` and a `TXT` for `mail`.
   Add each one in GoDaddy's DNS. In GoDaddy's **Name** box, enter only the part before
   `.yoculantickets.com` (GoDaddy adds the domain itself).
6. Add one more `TXT` record in GoDaddy, unless one named `_dmarc` already exists:
   - Name: `_dmarc`
   - Value: `v=DMARC1; p=none; rua=mailto:admin@yoculantickets.com`
7. Don't add or change the domain's existing `TXT` record that starts with `v=spf1`. SES's sending
   permission lives on `mail.yoculantickets.com` instead.
8. SES shows the identity as **Verified** once it sees the records (usually within an hour).

### Ask to send to customers

New SES accounts can only send to addresses verified in SES. In SES, open **Account dashboard →
Request production access**:
- Mail type: **Transactional**
- Website URL: `https://yoculantickets.com`
- Use case: "Ticket confirmations, guest-detail links, seat tickets with QR codes, and password resets
  for attendees of our annual gala, sent only to people who bought tickets or were invited as staff.
  About 3,000–5,000 emails a year, with up to 1,500 seat emails in one day before the event. Bounces
  and complaints are monitored and addresses that bounce are not mailed again."

Approval usually takes about a day.

### Give the app a sending key

1. In the AWS console, open **IAM → Users → Create user**, name it `yoculan-seating-mail`, no console access.
2. **Attach policies directly → Create policy → JSON**, paste the policy below (replace `REGION` and
   `ACCOUNT_ID`; your account ID is in the top-right menu), name it `yoculan-ses-send`, and attach it.

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": "ses:SendEmail",
         "Resource": "arn:aws:ses:REGION:ACCOUNT_ID:identity/yoculantickets.com"
       }
     ]
   }
   ```

3. Open the new user, then **Security credentials → Create access key → Application running outside AWS**.
4. In Render's **Environment** for the service, set `AWS_REGION` (for example `us-east-1`),
   `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, then change `MAIL_TRANSPORT` from `log` to `ses`. Save.

The key can only send email from `yoculantickets.com`, so a leaked key can't do anything else.

## 5. Square payment notifications

Once the app is reachable at its address:

1. In the Square Developer Dashboard, open the application, then **Webhooks → Subscriptions → Add subscription**
   (Sandbox, to start).
2. URL: `https://yoculantickets.com/api/square/webhook`. Events: `payment.updated` and
   `terminal.checkout.updated`.
3. Copy the subscription's **Signature key** into Render as `SQUARE_WEBHOOK_SIGNATURE_KEY`.

## 6. Going live with real payments

When testing is done: in Square, switch to the **Production** access token, put it in Render's
`SQUARE_ACCESS_TOKEN`, set `SQUARE_ENVIRONMENT` to `production`, repeat step 5 for Production, then in
the app's **Settings** choose the real location and pair the real terminals.
