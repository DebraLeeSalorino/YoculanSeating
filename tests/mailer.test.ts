import { describe, expect, it } from "vitest";
import type { SESv2Client } from "@aws-sdk/client-sesv2";
import { SesMailer } from "@/lib/mail/mailer";

describe("SES mailer", () => {
  it("sends plain-text mail from the configured address with the reply-to set", async () => {
    const sent: unknown[] = [];
    const client = { send: async (cmd: { input: unknown }) => void sent.push(cmd.input) } as unknown as SESv2Client;
    const mailer = new SesMailer("Yoculan Tickets <tickets@yoculantickets.com>", "admin@yoculantickets.com", client);
    await mailer.send({ to: "ann@buyer.test", subject: "Your tickets", text: "Hello" });
    expect(sent).toEqual([
      {
        FromEmailAddress: "Yoculan Tickets <tickets@yoculantickets.com>",
        Destination: { ToAddresses: ["ann@buyer.test"] },
        ReplyToAddresses: ["admin@yoculantickets.com"],
        Content: {
          Simple: {
            Subject: { Data: "Your tickets", Charset: "UTF-8" },
            Body: { Text: { Data: "Hello", Charset: "UTF-8" } },
          },
        },
      },
    ]);
  });
});
