import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Keeps mail in memory. Used by tests. */
export class MemoryMailer implements Mailer {
  sent: Mail[] = [];
  async send(mail: Mail) {
    this.sent.push(mail);
  }
  clear() {
    this.sent = [];
  }
  last(to?: string): Mail | undefined {
    const list = to ? this.sent.filter((m) => m.to.toLowerCase() === to.toLowerCase()) : this.sent;
    return list[list.length - 1];
  }
}

/** Writes mail to the console and to mail-log/. Used in development and until email is set up. */
export class LogMailer implements Mailer {
  async send(mail: Mail) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const body = `To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n`;
    console.log(`[mail] ${body}`);
    try {
      const dir = path.join(process.cwd(), "mail-log");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${stamp}.txt`), body);
    } catch {
      // The console copy is enough if the folder can't be written.
    }
  }
}

/**
 * Sends through Amazon SES (spec section 13). Configuration:
 * - MAIL_FROM, e.g. "Yoculan Tickets <tickets@yoculantickets.com>" (a verified SES domain)
 * - MAIL_REPLY_TO, where customer replies go
 * - AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (read by the AWS client itself)
 */
export class SesMailer implements Mailer {
  private client: SESv2Client;
  constructor(
    private readonly from: string,
    private readonly replyTo: string | null,
    client?: SESv2Client,
  ) {
    this.client = client ?? new SESv2Client({});
  }

  async send(mail: Mail) {
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [mail.to] },
        ReplyToAddresses: this.replyTo ? [this.replyTo] : undefined,
        Content: {
          Simple: {
            Subject: { Data: mail.subject, Charset: "UTF-8" },
            Body: { Text: { Data: mail.text, Charset: "UTF-8" } },
          },
        },
      }),
    );
  }
}

const globalForMail = globalThis as unknown as { __mailer?: Mailer };

export function getMailer(): Mailer {
  if (!globalForMail.__mailer) {
    const transport = process.env.MAIL_TRANSPORT;
    if (transport === "memory") globalForMail.__mailer = new MemoryMailer();
    else if (transport === "ses") {
      const from = process.env.MAIL_FROM;
      if (!from) throw new Error("MAIL_FROM must be set to send email through SES.");
      globalForMail.__mailer = new SesMailer(from, process.env.MAIL_REPLY_TO || null);
    } else globalForMail.__mailer = new LogMailer();
  }
  return globalForMail.__mailer;
}

export function appUrl(pathname: string): string {
  // Render sets RENDER_EXTERNAL_URL, which is used until the app's own domain is connected.
  const base = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}${pathname}`;
}
