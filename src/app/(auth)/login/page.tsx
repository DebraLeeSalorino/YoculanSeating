import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { SignInForm } from "../forms";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return (
    <main className="narrow">
      <div className="card">
        <h1>Sign in</h1>
        <SignInForm />
      </div>
    </main>
  );
}
