import { PinForm } from "../../components/ConfigForms";
import Shell from "../../components/Shell";
import { requireUser } from "../../lib/auth";

export const dynamic = "force-dynamic";

export default async function CuentaPage() {
  const user = await requireUser();
  return (
    <Shell user={user}>
      <h1>Mi PIN</h1>
      <p className="muted">Usuario: <b>{user.username}</b>. Elegí un PIN que solo conozcas vos; no uses fechas ni números repetidos.</p>
      <PinForm />
    </Shell>
  );
}
