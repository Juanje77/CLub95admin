"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Los barberos ven lo que usan todos los días; el admin/dueño suma los módulos de gestión y "Más".
export default function TabNav({ admin, alertCount }: { admin: boolean; alertCount: number }) {
  const path = usePathname();
  const tabs = admin
    ? [
        { href: "/", label: "Planilla" },
        { href: "/socios", label: "Socios" },
        { href: "/gastos", label: "Gastos" },
        { href: "/efectivo", label: "Efectivo" },
        { href: "/alertas", label: "Alertas" },
        { href: "/mas", label: "Más" },
      ]
    : [
        { href: "/", label: "Planilla" },
        { href: "/socios", label: "Socios" },
        { href: "/efectivo", label: "Efectivo" },
        { href: "/alertas", label: "Alertas" },
      ];
  return (
    <nav className="tabs" aria-label="Secciones">
      <div className="inner">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} aria-current={path === t.href || (t.href !== "/" && path.startsWith(t.href + "/")) ? "page" : undefined}>
            {t.label}
            {t.href === "/alertas" && alertCount > 0 ? <span className="badge">{alertCount}</span> : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}
