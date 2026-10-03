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
