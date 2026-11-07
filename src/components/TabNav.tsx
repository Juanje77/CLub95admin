"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS: Record<string, React.ReactNode> = {
  "/": <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M9.5 10v9.5" /></>,
  "/socios": <><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19c.5-3.2 2.8-5 5.5-5s5 1.8 5.5 5" /><path d="M16 5.6a3 3 0 0 1 0 5.8M17.5 14.3c2 .5 3.2 2.2 3.5 4.7" /></>,
  "/gastos": <><path d="M6 3.5h12v17l-3-1.8-3 1.8-3-1.8-3 1.8z" /><path d="M9 8.5h6M9 12h6" /></>,
  "/panel": <><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></>,
  "/alertas": <><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z" /><path d="M10 21a2.2 2.2 0 0 0 4 0" /></>,
  "/mas": <><circle cx="6" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="18" cy="12" r="1.4" /></>,
  "/efectivo": <><rect x="3" y="6.5" width="18" height="11" rx="2.5" /><circle cx="12" cy="12" r="2.6" /></>,
};

function Icon({ href }: { href: string }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[href]}
    </svg>
  );
}

// Los barberos ven lo que usan todos los días; el admin/dueño suma los módulos de gestión y "Más".
export default function TabNav({ admin, alertCount }: { admin: boolean; alertCount: number }) {
  const path = usePathname();
  const tabs = admin
    ? [
        { href: "/", label: "Planilla" },
        { href: "/socios", label: "Socios" },
        { href: "/gastos", label: "Gastos" },
        { href: "/panel", label: "Panel" },
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
      <div className="side-brand" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-club95.png" alt="" width={40} height={40} />
        <span>CLUB <b>95</b></span>
      </div>
      <div className="inner">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} aria-current={path === t.href || (t.href !== "/" && path.startsWith(t.href + "/")) ? "page" : undefined}>
            <Icon href={t.href} />
            <span className="lbl">{t.label}</span>
            {t.href === "/alertas" && alertCount > 0 ? <span className="badge">{alertCount}</span> : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}
