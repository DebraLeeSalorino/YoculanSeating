import { tokenIsUsable } from "@/domain/users";
import { AcceptInviteForm } from "../../forms";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const usable = await tokenIsUsable("invite", token);
  return (
    <main className="narrow">
      <div className="card">
        <h1>Set up your account</h1>
        {usable ? (
          <AcceptInviteForm token={token} />
        ) : (
          <p>This invitation has expired or has already been used. Ask an admin to invite you again.</p>
        )}
      </div>
    </main>
  );
}
