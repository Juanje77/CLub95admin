"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function TabNav({ admin, alertCount }: { admin: boolean; alertCount: number }) {
  const path = usePathname();
  const tabs = [
    { href: "/", label: "Hoy" },
    { href: "/cierre", label: "Cierre" },
    { href: "/efectivo", label: "Efectivo" },
    { href: "/alertas", label: "Alertas" },
  ];
  void admin;
  return (
    <nav className="tabs" aria-label="Secciones">
      <div className="inner">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} aria-current={path === t.href ? "page" : undefined}>
            {t.label}
            {t.href === "/alertas" && alertCount > 0 ? <span className="badge">{alertCount}</span> : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}
