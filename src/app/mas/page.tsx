import Link from "next/link";
import Shell from "../../components/Shell";
import { requireAdmin } from "../../lib/auth";

export const dynamic = "force-dynamic";

const ITEMS: { href: string; title: string; text: string }[] = [
  { href: "/config", title: "Configuración", text: "Equipo y comisiones, tarifas, productos y stock, PIN de cada usuario." },
];

export default async function MasPage() {
  const user = await requireAdmin();
  return (
    <Shell user={user}>
      <h1>Más</h1>
      <div className="grid" style={{ marginTop: 12 }}>
        {ITEMS.map((i) => (
          <Link key={i.href} href={i.href} className="big alt" style={{ textDecoration: "none" }}>
            {i.title}
            <small>{i.text}</small>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
