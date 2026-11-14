import { findBannedPhrases } from "./persona";

/**
 * Spaces keep a range endpoint positive: "5–10" must not become "5-10",
 * which the provenance tokenizer reads as a negative second token.
 * ASCII hyphen/minus and the mathematical minus sign remain untouched.
 */
export function normalizeReplyDashes(text: string): string {
  return text.replace(/[—–]/g, " - ");
}

const EXECUTION = [
  /\b(?:I|we)(?:['’](?:ve|ll))?\s+(?:(?:have|had|already|just|successfully|will|can|did|do|am|are|was|were|not|never|cannot|can't|don't|didn't|haven't|won't)\s+){0,5}(?:signed|sign|sent|send|transferred|transfer|executed|execute|repaid|repay|deposited|deposit|borrowed|borrow)\b/gi,
  /\b(?:saya|aku|kami)\s+(?:(?:sudah|telah|akan|bisa|dapat|berhasil|tidak|belum|tak|pernah)\s+){0,5}(?:mengirim|mentransfer|menandatangani|mengeksekusi|melunasi|membayar|meminjam|menyetor|mendeposit)\b/gi,
  /\b(?:(?:yo|nosotros)\s+)?(?:ya\s+)?(?:he|hemos|voy\s+a|puedo)\s+(?:(?:ya|no|nunca)\s+){0,3}(?:enviado|firmado|transferido|ejecutado|pagado|depositado|enviar|firmar|transferir|ejecutar|pagar|depositar)\b/gi,
  /\b(?:your|the|this)\s+(?:transaction|tokens?|funds|repayment)\s+(?:(?:has|have|had)\s+)?(?:(?:already|not|never)\s+)*(?:been|was|were|is|are)\s+(?:(?:already|not|never|successfully)\s+)*(?:signed|sent|transferred|executed|repaid)\b/gi,
  /\b(?:transaksi|tokens?|dana|pembayaran)(?:\s+(?:Anda|kamu|ini|tersebut))?\s+(?:(?:sudah|telah|berhasil|tidak|belum|pernah|akan)\s+)*(?:dikirim|ditransfer|ditandatangani|dieksekusi|dilunasi)\b/gi,
  /\b(?:(?:tu|tus|su|sus|la|el|los|las)\s+)?(?:transacci[oó]n|tokens?|fondos|pago)\s+(?:(?:no|nunca|ya)\s+)*(?:(?:ha|han|hab[ií]a|hab[ií]an)\s+sido|fue|fueron|est[aá]n?)\s+(?:(?:no|nunca|ya)\s+)*(?:firmad[oa]s?|enviad[oa]s?|transferid[oa]s?|ejecutad[oa]s?|pagad[oa]s?)\b/gi,
];
const NEGATED_EXECUTION =
  /\b(?:not|never|cannot|can't|don't|didn't|haven't|won't|tidak|belum|tak|no|nunca)\b/i;
const GUARANTEES =
  /\b(?:aman|terjamin|dijamin|bebas\s+risiko|pasti\s+untung|seguros?|seguras?|garantizad[oa]s?|sin\s+riesgos?|libre\s+de\s+riesgos?)\b/gi;
const NEGATED_GUARANTEE = /\b(?:tidak|belum|bukan|tak|no|nunca|sin\s+garant[ií]as?)\b/i;
const LIQUIDATION_GUARANTEE =
  /\b(?:tidak\s+(?:akan\s+)?(?:pernah\s+)?dilikuidasi|no\s+hay\s+riesgo\s+de\s+liquidaci[oó]n|nunca\s+(?:ser[aá]s?\s+)?liquidad[oa])\b/i;

/**
 * Preserve the existing English persona checks, adding narrowly scoped ID/ES guarantees,
 * impossible execution claims, and numeric glyphs the ASCII provenance tokenizer cannot read.
 * Explicit historical Guardian descriptions and negated disclosures remain useful prose.
 * This is a deterministic rejection layer, not a general semantic truthfulness classifier.
 */
export function chatOutputViolations(text: string): string[] {
  const violations = findBannedPhrases(text);
  // No normalization exemption: supported ASCII digits still pass the full source/unit guard.
  for (const match of text.matchAll(/\p{N}/gu)) {
    if (!/^[0-9]$/.test(match[0])) {
      violations.push("unsupported numeric characters");
      break;
    }
  }
  const clauses = text.split(/[.!?;\n]|\b(?:but|however|tetapi|namun|pero|sin\s+embargo)\b/i);
  for (const clause of clauses) {
    for (const pattern of EXECUTION) {
      for (const match of clause.matchAll(pattern)) {
        // Spanish places "no" before the auxiliary; English/Indonesian negate inside the match.
        const prefix = clause.slice(Math.max(0, match.index - 6), match.index);
        if (!NEGATED_EXECUTION.test(match[0]) && !/\b(?:no|nunca)\s*$/i.test(prefix)) {
          violations.push("unsupported execution claim");
        }
      }
    }
    if (LIQUIDATION_GUARANTEE.test(clause)) violations.push("liquidation guarantee");
    for (const match of clause.matchAll(GUARANTEES)) {
      const prefix = clause.slice(Math.max(0, match.index - 45), match.index);
      // Naming the word lets the single retry replace it instead of repeating it.
      if (!NEGATED_GUARANTEE.test(prefix))
        violations.push(`unsupported guarantee: "${match[0].toLowerCase()}"`);
    }
  }
  return [...new Set(violations)];
}
