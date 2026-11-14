/**
 * Number provenance checker (BUILD-PLAN P3.2, ARCHITECTURE Flow 1 step 4).
 *
 * Rule 2: every number in a reply must come from a tool result. The checker
 * extracts numeric tokens from the reply, reads each one under every plausible
 * locale, and requires an exact match with a source value after rounding the
 * source to the precision the reply displays. It decides nothing about money;
 * it only rejects numbers nobody computed.
 *
 * Does not guarantee: that a matching number is used in a truthful sentence
 * (misleading prose is possible), or that a bare number is the right quantity,
 * since unit-less tokens match any source of equal value.
 */

import { decimalString } from "@mrfund/shared";

/** A value a tool returned, as an exact decimal string with an optional unit. */
export interface SourceNumber {
  /** Optional minus sign, digits, optional fraction. Exact; never a float. */
  readonly value: string;
  /** "%", "USD", a token symbol such as "USDC", a duration unit, or null. */
  readonly unit: string | null;
}

interface Dec {
  readonly int: bigint;
  readonly scale: number;
}

export interface NumberToken {
  /** The reply text for this token, including a `$` prefix or unit. */
  readonly text: string;
  readonly neg: boolean;
  /** Every plausible reading of the digits; empty if malformed. */
  readonly candidates: readonly Dec[];
  readonly unit: string | null;
  readonly ordinal: boolean;
  /** Preceded by a comparison ("below", "di bawah", "por debajo de"): a threshold, never a count. */
  readonly comparison: boolean;
}

export type CheckResult = { ok: true } | { ok: false; violations: string[] };

export interface CheckOptions {
  /** Exact strings (for example today's date) that may appear in prose. */
  allowedLiterals?: readonly string[];
}

const SMALL_COUNT_MAX = 3n;
const ORDINAL_MAX = 31n;
const ORDINAL_SUFFIX = /^(st|nd|rd|th)$/i;
const COMPARISON =
  /(?:\b(?:below|under|above|over|less\s+than|more\s+than|lower\s+than|higher\s+than|di\s+bawah|di\s+atas|kurang\s+dari|lebih\s+dari|menos\s+de|m[aá]s\s+de)|por\s+(?:debajo|encima)\s+de)\s*$/i;
const THOUSANDS_ONLY = /[  '’]/;

// A token starts where no letter, digit, underscore, dot or comma precedes it.
// Accept a leading decimal separator as well as digit-separated groups; a
// sentence-final period is never part of either form.
const TOKEN = /(?<![\p{L}\p{N}_.,])([-−])?(\d+(?:[.,  '’]\d+)*|[.,]\d+)/gu;

function dec(digits: string, scale: number): Dec {
  return { int: BigInt(digits), scale };
}

function candidatesOf(raw: string): Dec[] {
  let s = raw;
  if (THOUSANDS_ONLY.test(s)) {
    if (!/^\d{1,3}(?:[  '’]\d{3})+(?:[.,]\d+)?$/.test(s)) return [];
    s = s.replace(/[  '’]/g, "");
  }
  const dots = s.split(".").length - 1;
  const commas = s.split(",").length - 1;
  if (dots === 0 && commas === 0) return [dec(s, 0)];

  if (dots > 0 && commas > 0) {
    const last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
    const d = s.charAt(last);
    const t = d === "." ? "," : ".";
    const pattern = new RegExp(`^\\d{1,3}(?:\\${t}\\d{3})+\\${d}\\d+$`);
    if (!pattern.test(s)) return [];
    const intPart = s.slice(0, last).split(t).join("");
    const frac = s.slice(last + 1);
    return [dec(intPart + frac, frac.length)];
  }

  const c = dots > 0 ? "." : ",";
  const count = dots > 0 ? dots : commas;
  if (count > 1) {
    const pattern = new RegExp(`^\\d{1,3}(?:\\${c}\\d{3})+$`);
    return pattern.test(s) ? [dec(s.split(c).join(""), 0)] : [];
  }
  const [head = "", frac = ""] = s.split(c);
  const out = [dec(head + frac, frac.length)];
  if (/^[1-9]\d{0,2}$/.test(head) && frac.length === 3) out.push(dec(head + frac, 0));
  return out;
}

function blank(text: string, literals: readonly string[]): string {
  let out = text;
  for (const lit of literals) {
    if (lit.length === 0) continue;
    out = out.split(lit).join(" ".repeat(lit.length));
  }
  return out;
}

const isSymbolLike = (w: string): boolean => /[A-Z].*[A-Z]/.test(w);

/**
 * Extract numeric tokens. A following word counts as a unit only if it looks
 * like a token symbol (two or more capitals, such as USDC or wNEAR) or is in
 * `knownUnits`; plain words like "options" are prose.
 */
export function extractNumbers(
  text: string,
  knownUnits: readonly string[] = [],
  allowedLiterals: readonly string[] = [],
): NumberToken[] {
  const known = new Set(knownUnits.map((u) => u.toLowerCase()));
  const src = blank(text, allowedLiterals);
  const out: NumberToken[] = [];

  for (const m of src.matchAll(TOKEN)) {
    const start = m.index;
    const end = start + m[0].length;
    const rest = src.slice(end);

    let unit: string | null = null;
    let ordinal = false;
    let tail = end;
    let from = start;

    const pct = /^\s?%/.exec(rest);
    const word = /^(\s?)([A-Za-z][A-Za-z0-9]*)/.exec(rest);
    if (pct) {
      unit = "%";
      tail = end + pct[0].length;
    } else if (word) {
      const w = word[2] ?? "";
      if (word[1] === "" && ORDINAL_SUFFIX.test(w)) {
        ordinal = true;
        tail = end + w.length;
      } else if (isSymbolLike(w) || known.has(w.toLowerCase())) {
        unit = w;
        tail = end + word[0].length;
      }
    }
    if (unit === null && !ordinal && src.charAt(start - 1) === "$") {
      unit = "USD";
      from = start - 1;
    }

    out.push({
      text: text.slice(from, tail),
      neg: m[1] !== undefined,
      candidates: candidatesOf(m[2] ?? ""),
      unit,
      ordinal,
      comparison: COMPARISON.test(src.slice(Math.max(0, from - 24), from)),
    });
  }
  return out;
}

function parseSource(v: string): { neg: boolean; d: Dec } {
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(v);
  if (!m) throw new RangeError(`source number is not an exact decimal: ${v}`);
  const frac = m[3] ?? "";
  return { neg: m[1] !== undefined, d: dec((m[2] ?? "") + frac, frac.length) };
}

/** Does the source, rounded to the candidate's precision, equal the candidate? */
function sameValue(source: Dec, cand: Dec): boolean {
  const p = cand.scale;
  if (source.scale <= p) return source.int * 10n ** BigInt(p - source.scale) === cand.int;
  const div = 10n ** BigInt(source.scale - p);
  const q = source.int / div;
  const up = (source.int % div) * 2n >= div ? q + 1n : q;
  return cand.int === q || cand.int === up;
}

function matches(tok: NumberToken, sources: readonly SourceNumber[]): boolean {
  for (const s of sources) {
    if (tok.unit !== null && (s.unit ?? "").toLowerCase() !== tok.unit.toLowerCase()) continue;
    const parsed = parseSource(s.value);
    if (tok.neg && !parsed.neg) continue;
    if (tok.candidates.some((c) => sameValue(parsed.d, c))) return true;
  }
  return false;
}

function allowedAsProse(tok: NumberToken): boolean {
  if (tok.unit !== null || tok.neg || tok.comparison) return false;
  const c = tok.candidates;
  if (c.length === 0 || c.some((x) => x.scale !== 0)) return false;
  const n = c[0]?.int ?? 0n;
  return tok.ordinal ? n >= 1n && n <= ORDINAL_MAX : n >= 1n && n <= SMALL_COUNT_MAX;
}

export function checkNumbers(
  reply: string,
  sources: readonly SourceNumber[],
  opts: CheckOptions = {},
): CheckResult {
  const units = sources.flatMap((s) => (s.unit === null ? [] : [s.unit]));
  const tokens = extractNumbers(reply, units, opts.allowedLiterals ?? []);
  const violations: string[] = [];
  for (const tok of tokens) {
    if (matches(tok, sources) || allowedAsProse(tok)) continue;
    if (!violations.includes(tok.text)) violations.push(tok.text);
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

/** Exact decimal string for `atomic / 10^decimals`; trailing zeros dropped. */
export function fromAtomic(atomic: bigint, decimals: number, unit: string | null): SourceNumber {
  return { value: decimalString(atomic, decimals), unit };
}

/** Basis points shown as a percentage: 12050 bps is "120.5" %. */
export const percentFromBps = (bps: bigint): SourceNumber => fromAtomic(bps, 2, "%");

/** Basis points shown as a ratio, for health factors: 14250 bps is 1.425. */
export const ratioFromBps = (bps: bigint): SourceNumber => fromAtomic(bps, 4, null);

export interface EnforceInput {
  reply: string;
  sources: readonly SourceNumber[];
  /** Ask the model again, naming the numbers that had no source. */
  regenerate: (violations: string[]) => Promise<string>;
  /** Built from tool results only; used after a second failure. */
  template: () => string;
  options?: CheckOptions;
  /** Extra checks on the reply text (for example banned phrases); each string is a violation. */
  extraViolations?: (text: string) => string[];
}

export interface EnforceOutput {
  text: string;
  via: "model" | "template";
  /** Number of failed checks; logged as checker hits. */
  hits: number;
}

/** Number violations first, then any extra ones; empty means the reply passes. */
function violationsOf(text: string, input: EnforceInput): string[] {
  const nums = checkNumbers(text, input.sources, input.options);
  const out = nums.ok ? [] : nums.violations;
  return [...out, ...(input.extraViolations?.(text) ?? [])];
}

/** Check once, regenerate once, then fall back to the template. */
export async function enforceNumbers(input: EnforceInput): Promise<EnforceOutput> {
  const first = violationsOf(input.reply, input);
  if (first.length === 0) return { text: input.reply, via: "model", hits: 0 };

  let retry: string;
  try {
    retry = await input.regenerate(first);
  } catch {
    return { text: input.template(), via: "template", hits: 1 };
  }
  if (violationsOf(retry, input).length === 0) return { text: retry, via: "model", hits: 1 };
  return { text: input.template(), via: "template", hits: 2 };
}
