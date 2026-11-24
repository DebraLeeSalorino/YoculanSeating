import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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

/** Writes mail to the console and to mail-log/. Used until a real email service is set up. */
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

const globalForMail = globalThis as unknown as { __mailer?: Mailer };

export function getMailer(): Mailer {
  if (!globalForMail.__mailer) {
    globalForMail.__mailer = process.env.MAIL_TRANSPORT === "memory" ? new MemoryMailer() : new LogMailer();
  }
  return globalForMail.__mailer;
}

export function appUrl(pathname: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${pathname}`;
}
