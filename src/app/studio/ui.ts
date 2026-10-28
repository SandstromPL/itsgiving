// The site's shared button looks. A plain module, not a client one: a client module's exports reach a server page as
// references, which can be passed along whole but not combined with other classes, so these live where both can use
// them.

/** The main action: an ink pill. */
export const primaryButton =
  "press inline-flex min-h-14 items-center justify-center rounded-full bg-foreground px-7 text-[17px] font-bold text-background hover:opacity-90";

/** The action beside it: the same pill, outlined. */
export const secondaryButton =
  "press inline-flex min-h-14 items-center justify-center rounded-full border border-foreground px-7 text-[17px] font-bold hover:bg-card";

/** A smaller outlined action that fills with ink on hover: Save, Save as PDF, the share link's controls. */
export const outlineButton =
  "rounded-full border border-foreground px-4 py-2.5 text-[15px] font-semibold hover:bg-foreground hover:text-background";

/** An outlined pill with an icon: All examples, Share, Back to a treatment. */
export const pillButton =
  "press flex min-h-11 items-center gap-2 rounded-full border border-foreground py-2 pr-5 pl-4 text-[15px] font-bold hover:bg-card";

/** The round back arrow before a treatment's title. */
export const backButton = "-ml-1.5 grid size-10 shrink-0 place-items-center rounded-full hover:bg-card";

/** Stop, beside the brief while a treatment builds. */
export const stopButton = "ml-auto min-h-10 rounded-full border border-foreground px-4 text-sm font-semibold";

/** Done, on a paper window: ink in either theme, since the window is paper in both. */
export const paperButton = "rounded-full bg-ink px-5 py-3 text-[15px] font-bold text-white";

/** A receipt slip's paper, edge and ink: pink when the mock stands in for Qloo, so mock numbers never pass as Qloo's. */
export const slip = (mock: boolean) => (mock ? "border-[#e79ac0] bg-[#fff5fa] text-[#a3195b]" : "border-slip-edge bg-slip text-slip-ink");

/** The highlighter behind a rank on a slip, pink for the mock. */
export const rankMark = (mock: boolean) => `${mock ? "bg-[#ffd6ea]" : "bg-accent"} text-ink`;

/** Qloo evidence in the page's own colours: tungsten for Qloo, tape pink for the mock standing in for it. */
export const evidenceTone = (mock: boolean) => (mock ? "text-tape" : "text-tungsten");

/** The same evidence on paper, which keeps its light-room inks in either theme. */
export const paperEvidence = (mock: boolean) => (mock ? "text-[#a3195b]" : "text-[#855000]");
