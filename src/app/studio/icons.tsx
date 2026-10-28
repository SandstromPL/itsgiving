// The site's small line icons, drawn once. Each is decorative: the control it sits in carries the name.

/** A left arrow, for the ways back from a treatment to the studio. */
export function BackArrow() {
  return (
    <svg
      aria-hidden
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

/** A check mark: a copied colour, a picked face, a saved treatment. */
export function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** A cross, for closing a window. */
export function CloseIcon() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
