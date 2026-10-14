import Link from "next/link";
import Shell from "../../components/Shell";
import { requireAdmin } from "../../lib/auth";
import { db } from "../../lib/db";
import { actionLabel, AUDIT_ENTITIES, entityLabel, listAudit } from "../../services/audit-view";

export const dynamic = "force-dynamic";

const fmt = (d: Date) =>
  new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

export default async function AuditoriaPage({ searchParams }: { searchParams: Promise<{ entidad?: string; usuario?: string; antes?: string }> }) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const entity = sp.entidad && AUDIT_ENTITIES.includes(sp.entidad) ? sp.entidad : undefined;
  const before = sp.antes && !Number.isNaN(Date.parse(sp.antes)) ? new Date(sp.antes) : undefined;
  const [rows, users] = await Promise.all([
    listAudit(db, { entity, userId: sp.usuario || undefined, before, limit: 100 }),
    db.user.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const last = rows[rows.length - 1];
  const q = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ ...(entity ? { entidad: entity } : {}), ...(sp.usuario ? { usuario: sp.usuario } : {}), ...extra });
    return `/auditoria?${p.toString()}`;
  };

  return (
    <Shell user={user}>
      <h1>Auditoría</h1>
      <p className="muted">Quién cargó, modificó o borró cada cosa, y cuándo. Nada se borra de verdad: las bajas quedan acá.</p>
      <form className="row" method="get">
        <select name="entidad" defaultValue={entity ?? ""} aria-label="Qué" style={{ flex: 1 }}>
          <option value="">Todo</option>
          {AUDIT_ENTITIES.map((e) => <option key={e} value={e}>{entityLabel(e)}</option>)}
        </select>
        <select name="usuario" defaultValue={sp.usuario ?? ""} aria-label="Quién" style={{ flex: 1 }}>
          <option value="">Todos</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <button className="btn" type="submit">Filtrar</button>
      </form>
      <ul className="list card" style={{ padding: "4px 14px", marginTop: 10 }}>
        {rows.map((r) => (
          <li key={r.id} style={{ display: "block" }}>
            <div className="row spread">
              <span><b>{r.user}</b> · {actionLabel(r.action)} <b>{entityLabel(r.entity)}</b></span>
              <span className="muted">{fmt(r.at)}</span>
            </div>
            {r.detail && <div className="muted" style={{ wordBreak: "break-word", fontSize: ".82rem" }}>{r.detail}</div>}
          </li>
        ))}
        {rows.length === 0 && <li className="muted">No hay movimientos con ese filtro.</li>}
      </ul>
      {rows.length === 100 && last && <Link className="btn" href={q({ antes: last.at.toISOString() })}>Ver más antiguos</Link>}
    </Shell>
  );
}
