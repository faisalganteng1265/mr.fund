import { describe, expect, it } from "vitest";
import { apiUrl } from "../src/play/source/apiBase";

describe("apiUrl", () => {
  it("stays on the same origin when no base is configured", () => {
    expect(apiUrl("/api/chat", undefined)).toBe("/api/chat");
    expect(apiUrl("/api/chat", "")).toBe("/api/chat");
  });
  it("points at a configured HTTPS origin, with or without a trailing slash", () => {
    expect(apiUrl("/api/chat", "https://api.example.com")).toBe("https://api.example.com/api/chat");
    expect(apiUrl("/api/position", "https://api.example.com/")).toBe(
      "https://api.example.com/api/position",
    );
  });
  it("allows plain HTTP only for localhost", () => {
    expect(apiUrl("/api/chat", "http://localhost:8787")).toBe("http://localhost:8787/api/chat");
    expect(apiUrl("/api/chat", "http://api.example.com")).toBe("/api/chat");
  });
  it.each([
    "https://api.example.com/v1",
    "https://api.example.com/?x=1",
    "https://api.example.com/#x",
    "https://user:pass@api.example.com",
    "https://user@api.example.com",
    "https://:pass@api.example.com",
    "javascript:alert(1)",
    "ftp://api.example.com",
    "not a url",
  ])("ignores %s and falls back to the same origin", (base) => {
    expect(apiUrl("/api/chat", base)).toBe("/api/chat");
  });
});
