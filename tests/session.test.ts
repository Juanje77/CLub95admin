import { describe, expect, it } from "vitest";
import { SESSION_HOURS, signSession, verifySession } from "../src/lib/session";

const NOW = new Date("2026-10-03T12:00:00Z");

describe("cookie de sesión firmada", () => {
  it("firma y verifica", () => {
    expect(verifySession(signSession("u1", NOW), NOW)).toBe("u1");
  });
  it("vence a las 12 horas", () => {
    const t = signSession("u1", NOW);
    expect(verifySession(t, new Date(NOW.getTime() + (SESSION_HOURS * 3600 - 1) * 1000))).toBe("u1");
    expect(verifySession(t, new Date(NOW.getTime() + (SESSION_HOURS * 3600 + 1) * 1000))).toBeNull();
  });
  it("rechaza una cookie alterada", () => {
    const t = signSession("u1", NOW);
    const [payload, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "admin", exp: NOW.getTime() + 1e9 })).toString("base64url");
    expect(verifySession(`${forged}.${sig}`, NOW)).toBeNull();
    expect(verifySession(`${payload}.AAAA`, NOW)).toBeNull();
    expect(verifySession("basura", NOW)).toBeNull();
    expect(verifySession(undefined, NOW)).toBeNull();
  });
});

describe("sesión atada al PIN", () => {
  it("la huella del PIN viaja firmada y no se puede cambiar", async () => {
    const { readSession } = await import("../src/lib/session");
    const t = signSession("u1", NOW, "abc123");
    expect(readSession(t, NOW)).toEqual({ uid: "u1", stamp: "abc123" });
    const [payload, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "u1", exp: NOW.getTime() + 1e9, s: "otra" })).toString("base64url");
    expect(readSession(`${forged}.${sig}`, NOW)).toBeNull();
    expect(payload).toBeTruthy();
  });

  it("al cambiar el PIN cambia la huella, así las sesiones viejas dejan de valer", async () => {
    const { getSessionUser } = await import("../src/services/auth");
    const { changeOwnPin } = await import("../src/services/admin");
    const { freshDb, seed } = await import("./helpers/db");
    const db = freshDb();
    const ids = await seed(db);
    const before = (await getSessionUser(db, ids.lucio))!.stamp;
    expect((await getSessionUser(db, ids.lucio))!.stamp).toBe(before);
    await changeOwnPin(db, { userId: ids.lucio, current: "1234", next: "7391" });
    expect((await getSessionUser(db, ids.lucio))!.stamp).not.toBe(before);
    await db.$disconnect();
  });
});
