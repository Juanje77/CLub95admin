"use client";
import { useEffect, useRef, useState } from "react";

export interface PanelTab {
  id: string;
  label: string;
  /** Aviso corto al lado del nombre (por ejemplo, cuántas cosas hay para mirar). */
  badge?: string;
  content: React.ReactNode;
}

/**
 * Pestañas del panel: una sola sección a la vez para encontrar las cosas rápido. La pestaña se elige con el nombre en la dirección (#socios),
 * así los enlaces de "A mirar" llevan directo. Al imprimir o exportar a PDF se muestran todas.
 */
export default function PanelTabs({ tabs }: { tabs: PanelTab[] }) {
  const [active, setActive] = useState(tabs[0]!.id);
  const ids = tabs.map((t) => t.id).join(",");
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => {
      const h = window.location.hash.slice(1);
      if (ids.split(",").includes(h)) {
        setActive(h);
        top.current?.scrollIntoView({ block: "start" });
      }
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [ids]);

  const pick = (id: string) => {
    setActive(id);
    try {
      window.history.replaceState(null, "", `#${id}`);
    } catch {
      /* sin historial: igual cambia la pestaña */
    }
  };

  return (
    <>
      <div ref={top} className="ptabs noprint" role="tablist" aria-label="Secciones del panel">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={active === t.id} aria-controls={`panel-${t.id}`} className="ptab" onClick={() => pick(t.id)}>
            {t.label}
            {t.badge ? <span className="pbadge">{t.badge}</span> : null}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <section key={t.id} id={`panel-${t.id}`} role="tabpanel" aria-labelledby={`tab-${t.id}`} className="tabpanel" hidden={active !== t.id}>
          <h2 className="onlyprint">{t.label}</h2>
          {t.content}
        </section>
      ))}
    </>
  );
}
