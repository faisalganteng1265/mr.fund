import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createScanner, SyntaxKind } from "typescript/unstable/ast";
import { expect, it } from "vitest";

it("keeps position's reachable imports free of signing, keys, models, chat and production fixtures", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const pending = [join(root, "apps/web/src/app/api/position/route.ts")];
  const visited = new Set<string>();
  const violations: string[] = [];
  const forbiddenAuthority =
    /^(signAndSendTransactions|signAndSendTransaction|sendTransaction|sendMoney|signMessage|KeyPair|KeyStore|UnencryptedFileSystemKeyStore)$/;
  while (pending.length) {
    const path = pending.pop();
    if (!path || visited.has(path)) continue;
    visited.add(path);
    const name = relative(root, path).replaceAll("\\", "/");
    if (/(?:^|\/)(?:chat|wallet|watcher|fixtures|test|signer|keys)(?:\/|\.)/.test(name))
      violations.push(name);
    // TS 7 exposes lexical utilities separately from its version-only root module.
    const scanner = createScanner(true, undefined, readFileSync(path, "utf8"));
    const tokens: { kind: SyntaxKind; value: string }[] = [];
    for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan())
      tokens.push({ kind, value: scanner.getTokenValue() });
    const imports: string[] = [];
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (!token) continue;
      if (forbiddenAuthority.test(token.value)) violations.push(`${name}: ${token.value}`);
      const previous = tokens[index - 1];
      if (
        token.kind === SyntaxKind.StringLiteral &&
        (previous?.kind === SyntaxKind.FromKeyword || previous?.kind === SyntaxKind.ImportKeyword)
      )
        imports.push(token.value);
      if (
        (token.kind === SyntaxKind.ImportKeyword || token.value === "require") &&
        tokens[index + 1]?.kind === SyntaxKind.OpenParenToken
      ) {
        const target = tokens[index + 2];
        if (target?.kind === SyntaxKind.StringLiteral) imports.push(target.value);
        else violations.push(`${name}: dynamic dependency`);
      }
    }
    for (const target of imports) {
      if (target === "node:crypto" || target === "node:net") continue;
      if (target.startsWith(".")) pending.push(resolve(dirname(path), `${target}.ts`));
      else if (target === "@mrfund/server/position")
        pending.push(join(root, "packages/server/src/position-route.ts"));
      else if (/^@mrfund\/(shared|engine|rhea)$/.test(target))
        pending.push(join(root, "packages", target.slice("@mrfund/".length), "src/index.ts"));
      else violations.push(`${name}: ${target}`);
    }
  }
  expect(violations).toEqual([]);
  console.info(
    `Position dependency inspection: ${visited.size} source modules, no authority/model/fixture violations`,
  );
});
