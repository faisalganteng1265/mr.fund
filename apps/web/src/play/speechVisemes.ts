/** Browser boundary events anchor this approximation; it is not phoneme-timed audio lip-sync. */
export type SpeechCue = { id: number; text: string; charIndex: number | null };
export function textViseme(text: string, index: number) {
  const character = text[index]?.toLowerCase() ?? " ";
  const pair = text.slice(index, index + 2).toLowerCase();
  if (/\s|[.,!?;:]/.test(character)) return "sil";
  if (["ch", "sh", "sy"].includes(pair)) return "CH";
  if (pair === "th") return "TH";
  if (/[bmp]/.test(character)) return "PP";
  if (/[fv]/.test(character)) return "FF";
  if (/[td]/.test(character)) return "DD";
  if (/[kg]/.test(character)) return "kk";
  if (/[szjc]/.test(character)) return "SS";
  if (/[nl]/.test(character)) return "nn";
  if (character === "r") return "RR";
  if (/[aiueo]/.test(character))
    return { a: "aa", i: "I", u: "U", e: "E", o: "O" }[character] ?? "aa";
  return "I";
}
