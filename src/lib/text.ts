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
