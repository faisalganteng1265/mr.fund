import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { CHAT_GENERATION_SETTINGS, createNearAIProvider } from "../../server/src/chat/provider";
import { type ManualReview, runEvaluation } from "../eval/run";

// Parent hydrates env without printing secrets. Ordinary suites never call a provider.
// Command: LIVE_CHAT_EVAL=1 pnpm exec vitest run packages/agent/test/live-eval.test.ts --reporter=verbose
// PowerShell: $env:LIVE_CHAT_EVAL='1'; pnpm exec vitest run packages/agent/test/live-eval.test.ts --reporter=verbose
it.skipIf(process.env.LIVE_CHAT_EVAL !== "1")(
  "records authorized real model turns on a Simulated fixture",
  async () => {
    const apiKey = process.env.NEARAI_API_KEY;
    if (!apiKey)
      throw new Error("LIVE_CHAT_EVAL requires NEARAI_API_KEY; credentials were not loaded.");
    const model = process.env.NEARAI_MODEL || "anthropic/claude-haiku-5-5";
    const directory = resolve("scratch/chat-eval");
    await mkdir(directory, { recursive: true });
    let manualReviews: ManualReview[] = [];
    if (process.env.CHAT_EVAL_REVIEW_FILE) {
      const raw: unknown = JSON.parse(await readFile(process.env.CHAT_EVAL_REVIEW_FILE, "utf8"));
      if (!Array.isArray(raw))
        throw new Error("CHAT_EVAL_REVIEW_FILE must contain a review array.");
      manualReviews = raw as ManualReview[]; // Each record is runtime validated against its exact response.
    }
    const report = await runEvaluation(createNearAIProvider({ apiKey, model }), {
      evidence: "live",
      model,
      runAt: new Date().toISOString(),
      settings: CHAT_GENERATION_SETTINGS,
      manualReviews,
    });
    const file = resolve(directory, `${model.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`);
    await writeFile(
      file,
      `${JSON.stringify(report, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2)}\n`,
    );
    await writeFile(
      resolve(directory, "manual-review-template.json"),
      `${JSON.stringify(
        report.results.map((sample) => ({
          caseId: sample.caseId,
          locale: sample.locale,
          text: sample.text,
          reviewer: "",
          reviewedAt: "",
          correctLanguage: false,
          semanticallyCorrect: false,
          noForbiddenClaims: false,
          notes: "",
        })),
        null,
        2,
      )}\n`,
    );
    // A recorded failed candidate remains evidence, not a passing model selection.
    expect(report.results).toHaveLength(36);
    expect(report.evidence).toBe("live");
    expect(report.fixture.label).toBe("Simulated");
  },
  // Allow all cases to reach their own deadline; a slow/failed turn is still scored as such.
  2_400_000,
);
