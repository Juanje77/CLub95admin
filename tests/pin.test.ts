import { describe, expect, it } from "vitest";
import { hashPin, verifyPin } from "../src/auth/pin";

describe("PIN", () => {
  it("verifica el PIN correcto y rechaza el incorrecto", () => {
    const h = hashPin("1234");
    expect(verifyPin("1234", h)).toBe(true);
    expect(verifyPin("1235", h)).toBe(false);
    expect(verifyPin("1234", null)).toBe(false);
  });
  it("no guarda el PIN en claro y usa sal distinta cada vez", () => {
    const a = hashPin("1234");
    const b = hashPin("1234");
    expect(a).not.toContain("1234");
    expect(a).not.toBe(b);
  });
  it("rechaza PIN mal formado", () => {
    expect(() => hashPin("12")).toThrow();
    expect(() => hashPin("abcd")).toThrow();
  });
});
