import { redirect } from "next/navigation";
import { currentUser } from "../../lib/auth";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return (
    <div className="login">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="logo" src="/logo-club95.png" alt="Club 95" width={96} height={96} />
      <h1 className="brand" style={{ fontSize: "1.8rem", marginBottom: 4 }}>
        CLUB <span>95</span>
      </h1>
      <p className="muted" style={{ marginTop: 0 }}>Ingresá con tu usuario y PIN.</p>
      <LoginForm />
    </div>
  );
}
