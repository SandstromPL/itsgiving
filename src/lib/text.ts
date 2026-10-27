/**
 * A short excerpt of a longer text: whole sentences when one fits, else whole words and an ellipsis. Never cut
 * mid-word, as a plain slice or a CSS line clamp does ("a quiet dining experi…").
 */
export function excerpt(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const end = clean.lastIndexOf(". ", max - 1);
  if (end > max / 2) return clean.slice(0, end + 1);
  const space = clean.lastIndexOf(" ", max - 1);
  return `${clean.slice(0, space > 0 ? space : max - 1).replace(/[,;:]$/, "")}…`;
}

/**
 * Tags that name who people are rather than what they like: sexual orientation and gender identity, religion,
 * ethnicity, health, party politics. Qloo has some as film themes ("LGBT", "lesbian"), but "the audience over-indexes
 * on lesbian" or "it's giving gay" reads as profiling the people in it, so they never become tone or evidence, or a
 * word in a summary. The kit's SAFE_USE rules out inferring health or politics from taste.
 */
const IDENTITY_TAG =
  /\b(lgbt\w*|lesbian\w*|gay|gays|queer\w*|bisexual\w*|homosexual\w*|transgender\w*|transsexual\w*|non-?binary|same-sex|coming out|sexual orientation|gender identity|muslims?|islam\w*|jewish|jews?|judaism|christians?|christianity|hindus?|hinduism|sikhs?|sikhism|buddhis[mt]s?|catholics?|catholicism|african[- ]americans?|asian[- ]americans?|latin[oax]s?|hispanics?|mental (illness|health)|depression|autis(m|tic)|disabilit(y|ies)|disabled|addiction|alcoholism|suicid\w*|democrats?|republicans?|right-wing|left-wing)\b/i;

export function isIdentityTag(name: string): boolean {
  return IDENTITY_TAG.test(name);
}
