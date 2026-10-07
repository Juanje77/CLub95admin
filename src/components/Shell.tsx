import Link from "next/link";
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

export default async function Shell({ user, children, alertCount, wide }: { user: SessionUser; children: React.ReactNode; alertCount?: number; wide?: boolean }) {
  const count = alertCount ?? (await loadAlerts(user)).length;
  return (
    <>
      <main className={wide ? "wide" : undefined}>
        <header className="top">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="logo" src="/logo-club95.png" alt="Club 95" width={44} height={44} />
            <div>
              <div className="brand">
                CLUB <span>95</span>
              </div>
              <div className="muted">
                {user.name} · {user.role === "DUENO" ? "dueño" : user.role === "ADMIN" ? "admin" : "barbero"}
              </div>
            </div>
          </div>
          <div className="row">
            <Link className="btn" href="/cuenta" style={{ textDecoration: "none" }}>Mi PIN</Link>
            <form action={logout}>
              <button className="btn" type="submit">
                Salir
              </button>
            </form>
          </div>
        </header>
        {children}
      </main>
      <TabNav admin={isAdmin(user)} alertCount={count} />
    </>
  );
}
