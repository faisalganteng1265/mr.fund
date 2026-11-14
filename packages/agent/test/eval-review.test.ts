import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyManualReviews, type EvaluationReport, type ManualReview } from "../eval/run";

// No provider call or credentials. Review the saved samples, preserving original usage/time.
// CHAT_EVAL_REVIEW_ONLY=1 CHAT_EVAL_REPORT_FILE=scratch/chat-eval/z-ai-glm-5.3-flash.json CHAT_EVAL_REVIEW_FILE=scratch/chat-eval/manual-review.json pnpm exec vitest run packages/agent/test/eval-review.test.ts
it.skipIf(process.env.CHAT_EVAL_REVIEW_ONLY !== "1")(
  "records manual review of the original saved evaluation",
  async () => {
    const reportPath = process.env.CHAT_EVAL_REPORT_FILE;
    const reviewPath = process.env.CHAT_EVAL_REVIEW_FILE;
    if (!reportPath || !reviewPath)
      throw new Error(
        "Set CHAT_EVAL_REPORT_FILE and CHAT_EVAL_REVIEW_FILE to local evaluation JSON files.",
      );
    const report = JSON.parse(await readFile(reportPath, "utf8")) as EvaluationReport;
    const reviews: unknown = JSON.parse(await readFile(reviewPath, "utf8"));
    if (!Array.isArray(reviews) || !Array.isArray(report.results))
      throw new Error("Invalid local evaluation report or review array.");
    // JSON reports use decimal strings; restore only typed atomic fields, never payload argument strings.
    for (const sample of report.results) {
      for (const card of sample.cards) {
        for (const fee of card.fees) fee.amount = BigInt(fee.amount);
        for (const transaction of card.payload) {
          for (const action of transaction.actions) {
            action.gas = BigInt(action.gas);
            action.deposit = BigInt(action.deposit);
          }
        }
      }
    }
    const reviewed = applyManualReviews(report, reviews as ManualReview[]);
    await writeFile(
      resolve("scratch/chat-eval/reviewed-evaluation.json"),
      `${JSON.stringify(reviewed, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2)}\n`,
    );
    expect(reviewed.results).toHaveLength(report.results.length);
    expect(reviewed.runAt).toBe(report.runAt);
    expect(reviewed.aggregates.manualReviewsPending).toBe(0);
  },
);
