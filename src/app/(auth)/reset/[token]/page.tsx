import Link from "next/link";
import { tokenIsUsable } from "@/domain/users";
import { ResetForm } from "../../forms";

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const usable = await tokenIsUsable("password_reset", token);
  return (
    <main className="narrow">
      <div className="card">
        <h1>Choose a new password</h1>
        {usable ? (
          <ResetForm token={token} />
        ) : (
          <p>
            This link has expired or has already been used. <Link href="/forgot">Ask for a new one</Link>.
          </p>
        )}
      </div>
    </main>
  );
}
