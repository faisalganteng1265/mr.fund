import { runChatTurn } from "../src/chat";
import type { ChatProvider, TokenUsage, TurnResult, TurnSummary } from "../src/chat-types";
import { EVALUATION_CASES, type EvaluationCase } from "./cases";
import { type EvaluationChecks, evaluateResponse, type ManualReview } from "./evaluate";
import { createEvaluationContext, EVALUATION_FIXTURE } from "./fixture";

export { evaluateResponse, type ManualReview } from "./evaluate";
export type EvidenceKind = "offline" | "live";
export interface EvaluationSample {
  caseId: string;
  scenario: EvaluationCase["scenario"];
  locale: EvaluationCase["locale"];
  prompt: string;
  reviewCriteria: string;
  text: string;
  cards: TurnResult["cards"];
  sources: TurnResult["sources"];
  summary: TurnSummary;
  usage: TokenUsage;
  latencyMs: number;
  status: TurnSummary["status"];
  guardHits: number;
  checks: EvaluationChecks;
}
export interface EvaluationAggregates {
  total: number;
  completeDataset: boolean;
  successfulModelTurns: number;
  allNumbersPass: boolean;
  allSemanticChecksPass: boolean;
  zeroForbiddenClaims: boolean;
  allCardsWithinBounds: boolean;
  heuristicLanguagePasses: number;
  reviewedCorrectLanguage: number;
  manualReviewsPending: number;
  allReviewedContentChecksPass: boolean;
  guardHits: number;
  guardAffectedTurns: number;
  statuses: Record<string, number>;
  usage: TokenUsage;
  totalLatencyMs: number;
  meanLatencyMs: number;
  maxLatencyMs: number;
  modelAccepted: boolean;
}
export interface EvaluationReport {
  evidence: EvidenceKind;
  model: string;
  runAt: string;
  settings: Readonly<Record<string, string | number | boolean>>;
  fixture: typeof EVALUATION_FIXTURE;
  languageRubric: string;
  usageDisclosure: string;
  pricing: { costComputed: false; reason: string };
  results: EvaluationSample[];
  aggregates: EvaluationAggregates;
}
export interface EvaluationOptions {
  evidence: EvidenceKind;
  model: string;
  runAt: string;
  settings: Readonly<Record<string, string | number | boolean>>;
  cases?: readonly EvaluationCase[];
  manualReviews?: readonly ManualReview[];
}

/** Offline samples prove plumbing only. A complete live set and recorded independent review are mandatory. */
export function summarizeEvaluation(
  results: readonly EvaluationSample[],
  evidence: EvidenceKind,
): EvaluationAggregates {
  const usage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
  };
  let totalLatencyMs = 0;
  for (const result of results) {
    for (const key of [
      "inputTokens",
      "outputTokens",
      "cachedInputTokens",
      "reasoningTokens",
    ] as const)
      usage[key] += result.usage[key];
    totalLatencyMs += result.latencyMs;
  }
  const completeDataset =
    results.length === 36 &&
    new Set(results.map((sample) => sample.caseId)).size === 36 &&
    EVALUATION_CASES.every((testCase) =>
      results.some(
        (sample) =>
          sample.caseId === testCase.id &&
          sample.prompt === testCase.prompt &&
          sample.locale === testCase.locale,
      ),
    );
  const successfulModelTurns = results.filter(
    (sample) => sample.status === "ok" && sample.summary.via === "model",
  ).length;
  const allNumbersPass =
    results.length > 0 && results.every((sample) => sample.checks.numbers.pass);
  const allSemanticChecksPass =
    results.length > 0 && results.every((sample) => sample.checks.semantic.pass);
  const zeroForbiddenClaims =
    results.length > 0 && results.every((sample) => sample.checks.honesty.pass);
  const allCardsWithinBounds =
    results.length > 0 && results.every((sample) => sample.checks.cards.pass);
  const heuristicLanguagePasses = results.filter((sample) => sample.checks.language.pass).length;
  const reviewedCorrectLanguage = results.filter(
    (sample) =>
      sample.checks.language.pass &&
      (sample.checks.manualReview.status === "approved" ||
        sample.checks.manualReview.status === "rejected") &&
      sample.checks.manualReview.record?.correctLanguage === true,
  ).length;
  const manualReviewsPending = results.filter(
    (sample) =>
      sample.checks.manualReview.status === "pending" ||
      sample.checks.manualReview.status === "invalid",
  ).length;
  const allReviewedContentChecksPass =
    results.length > 0 &&
    results.every(
      (sample) =>
        sample.checks.manualReview.record?.semanticallyCorrect === true &&
        sample.checks.manualReview.record?.noForbiddenClaims === true,
    );
  return {
    total: results.length,
    completeDataset,
    successfulModelTurns,
    allNumbersPass,
    allSemanticChecksPass,
    zeroForbiddenClaims,
    allCardsWithinBounds,
    heuristicLanguagePasses,
    reviewedCorrectLanguage,
    manualReviewsPending,
    allReviewedContentChecksPass,
    guardHits: results.reduce((total, sample) => total + sample.guardHits, 0),
    guardAffectedTurns: results.filter((sample) => sample.guardHits > 0).length,
    statuses: Object.fromEntries(
      ["ok", "unavailable", "timeout", "cancelled", "tool_limit", "invalid_provider"].map(
        (status) => [status, results.filter((sample) => sample.status === status).length],
      ),
    ),
    usage,
    totalLatencyMs,
    meanLatencyMs: results.length === 0 ? 0 : totalLatencyMs / results.length,
    maxLatencyMs: Math.max(0, ...results.map((sample) => sample.latencyMs)),
    modelAccepted:
      evidence === "live" &&
      completeDataset &&
      successfulModelTurns === 36 &&
      allNumbersPass &&
      allSemanticChecksPass &&
      zeroForbiddenClaims &&
      allCardsWithinBounds &&
      reviewedCorrectLanguage >= 34 &&
      manualReviewsPending === 0 &&
      allReviewedContentChecksPass,
  };
}

/** Executes actual orchestration and actual tools; only the provider is injected. No signing or network fixture reads. */
export async function runEvaluation(
  provider: ChatProvider,
  options: EvaluationOptions,
): Promise<EvaluationReport> {
  const results: EvaluationSample[] = [];
  for (const testCase of options.cases ?? EVALUATION_CASES) {
    const started = performance.now();
    const turn = await runChatTurn({
      message: testCase.prompt,
      locale: testCase.locale,
      context: createEvaluationContext(testCase.contextVariant),
      provider,
    });
    const matchingReviews =
      options.manualReviews?.filter((review) => review?.caseId === testCase.id) ?? [];
    const review = matchingReviews.length === 1 ? matchingReviews[0] : undefined;
    const checks = evaluateResponse(testCase, turn, review);
    if (matchingReviews.length > 1) checks.manualReview = { status: "invalid" };
    results.push({
      caseId: testCase.id,
      scenario: testCase.scenario,
      locale: testCase.locale,
      prompt: testCase.prompt,
      reviewCriteria: testCase.reviewCriteria,
      text: turn.text,
      cards: turn.cards,
      sources: turn.sources,
      summary: turn.summary,
      usage: turn.summary.usage,
      latencyMs: Math.max(0, performance.now() - started),
      status: turn.summary.status,
      guardHits: turn.summary.guardHits,
      checks,
    });
  }
  return {
    evidence: options.evidence,
    model: options.model,
    runAt: options.runAt,
    settings: { ...options.settings },
    fixture: EVALUATION_FIXTURE,
    languageRubric:
      "Distinct function-word markers must favor the requested language; recorded independent review of every exact saved answer must assess fluent target language, correct semantic associations, and equivalent forbidden claims. Reviewer provenance must be explicit, not provider self-assessment. Symbols/names may remain unchanged. At least 34/36 must pass both language checks; all content and number/card checks must pass. Offline evidence never selects a model.",
    usageDisclosure:
      "Observed provider-reported usage from completed validated replies only. Absent provider usage is represented as zero; failed, cancelled or timed-out calls may consume unreported tokens. Totals are not a complete billing measurement.",
    pricing: {
      costComputed: false,
      reason:
        "No verified pricing supplied. Token usage is reported without estimating monetary cost or using floating-point prices.",
    },
    results,
    aggregates: summarizeEvaluation(results, options.evidence),
  };
}

/** Review the original saved outputs, not a fresh non-reproducible inference run. */
export function applyManualReviews(
  report: EvaluationReport,
  reviews: readonly ManualReview[],
): EvaluationReport {
  const results = report.results.map((sample) => {
    const testCase = EVALUATION_CASES.find((candidate) => candidate.id === sample.caseId);
    if (!testCase) throw new Error("Unknown evaluation case in saved report");
    const matching = reviews.filter((review) => review?.caseId === sample.caseId);
    const checks = evaluateResponse(
      testCase,
      { text: sample.text, cards: sample.cards, sources: sample.sources, summary: sample.summary },
      matching.length === 1 ? matching[0] : undefined,
    );
    if (matching.length > 1) checks.manualReview = { status: "invalid" };
    return { ...sample, checks };
  });
  return { ...report, results, aggregates: summarizeEvaluation(results, report.evidence) };
}
