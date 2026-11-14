import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("keeps simulation imports out of the hook and presentation modules", () => {
  const root = new URL("../src/play/", import.meta.url);
  const files = readdirSync(root, { recursive: true }).filter(
    (file) =>
      typeof file === "string" &&
      /\.(ts|tsx)$/.test(file) &&
      !file.startsWith("source") &&
      file !== "Playground.tsx" &&
      file !== "PlayViewport.tsx" &&
      file !== "demo.ts",
  );
  expect(files).toContain("useConsultation.ts");
  for (const file of files) {
    const text = readFileSync(
      fileURLToPath(new URL(String(file).replaceAll("\\", "/"), root)),
      "utf8",
    );
    expect(text, String(file)).not.toMatch(/from\s+["'][^"']*\/(?:demo|source\/demo)[^"']*["']/);
  }
});
