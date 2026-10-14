import { currentUser } from "../../../../lib/auth";
import { db } from "../../../../lib/db";
import { isAdmin } from "../../../../services/common";
import { getReceipt } from "../../../../services/expenses";

export const dynamic = "force-dynamic";

// Sirve la foto de un comprobante solo a admin/dueño con sesión.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user || !isAdmin(user)) return new Response("No autorizado", { status: 401 });
  const { id } = await ctx.params;
  const data = await getReceipt(db, id);
  if (!data) return new Response("No encontrado", { status: 404 });
  const bytes = Buffer.from(data.slice(data.indexOf(",") + 1), "base64");
  return new Response(bytes, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
