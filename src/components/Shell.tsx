import { logout } from "../app/actions";
import { alertsFor } from "../domain/alerts";
import { db } from "../lib/db";
import type { SessionUser } from "../services/auth";
import { isAdmin } from "../services/common";
import { syncAlerts } from "../services/alerts";
import TabNav from "./TabNav";

export async function loadAlerts(user: SessionUser) {
  const all = await syncAlerts(db);
  return alertsFor(all, user.role);
}

export default async function Shell({ user, children, alertCount }: { user: SessionUser; children: React.ReactNode; alertCount?: number }) {
  const count = alertCount ?? (await loadAlerts(user)).length;
  return (
    <>
      <main>
        <header className="top">
          <div>
            <div className="brand">
              CLUB <span>95</span>
            </div>
            <div className="muted">
              {user.name} · {user.role === "DUENO" ? "dueño" : user.role === "ADMIN" ? "admin" : "barbero"}
            </div>
          </div>
          <form action={logout}>
            <button className="btn" type="submit">
              Salir
            </button>
          </form>
        </header>
        {children}
      </main>
      <TabNav admin={isAdmin(user)} alertCount={count} />
    </>
  );
}
