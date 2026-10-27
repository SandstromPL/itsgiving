import { useCallback, useEffect, useRef, useState } from "react";

/** Copies text, quietly reporting whether the browser allowed it. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remembers for a moment what was just copied, so a control can say "Copied" and then go back to its label. `copy`
 * returns whether the browser allowed it; `copied` is the key of the last success, until `ms` passes.
 */
export function useCopied(ms = 1600) {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(
    async (text: string, key: string = text) => {
      const ok = await copyText(text);
      clearTimeout(timer.current);
      setCopied(ok ? key : null);
      if (ok) timer.current = setTimeout(() => setCopied(null), ms);
      return ok;
    },
    [ms],
  );
  return { copied, copy };
}
