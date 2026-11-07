import MarkClosedDay from "../../components/MarkClosedDay";
import Shell, { loadAlerts } from "../../components/Shell";
import { requireUser } from "../../lib/auth";
import { isAdmin } from "../../services/common";

export const dynamic = "force-dynamic";

export default async function AlertasPage() {
  const user = await requireUser();
  const alerts = await loadAlerts(user);
  const admin = isAdmin(user);
  return (
    <Shell user={user} alertCount={alerts.length}>
      <h1>Alertas</h1>
      {alerts.length === 0 && <div className="alert INFO" style={{ marginTop: 12 }}>Todo en orden: no hay alertas.</div>}
      {alerts.map((a) => (
        <div key={a.key} className={`alert ${a.severity}`}>
          <div>{a.message}</div>
          {admin && a.code === "DIA_SIN_MOVIMIENTO" && a.date && (
            <div style={{ marginTop: 8 }}>
              <MarkClosedDay date={a.date} />
            </div>
          )}
        </div>
      ))}
    </Shell>
  );
}
