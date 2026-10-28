import type { ReactNode, Ref, ToggleEventHandler } from "react";
import { CloseIcon } from "./icons";
import { paperButton } from "./ui";

/**
 * A window on paper, the same in either theme (the share window, the title-card window): a bar with its name and
 * Close, a body that alone scrolls, so Close and Done stay in view on a phone too, and Done. The window is named by
 * the heading with the id `${id}-title`, which the body brings.
 */
export function PaperWindow({
  id,
  label,
  ref,
  onToggle,
  children,
}: {
  id: string;
  /** The bar's name for the window, in the receipts' mono ("share", "title card"). */
  label: string;
  ref?: Ref<HTMLDivElement>;
  onToggle?: ToggleEventHandler<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div id={id} ref={ref} popover="auto" className="window" role="dialog" aria-labelledby={`${id}-title`} onToggle={onToggle}>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-[#121211] bg-[#f7f5f0] py-1 pr-1 pl-4">
        <span aria-hidden className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-2 border-[#121211]" />
          <span className="size-2.5 rounded-full border-2 border-[#121211]" />
          <span className="size-2.5 rounded-full border-2 border-[#121211] bg-[#121211]" />
        </span>
        <span className="font-mono text-[13px] text-[#2b2925]">{label}</span>
        <button
          type="button"
          popoverTarget={id}
          popoverTargetAction="hide"
          aria-label="Close"
          className="grid size-11 place-items-center rounded-xl text-[#121211] hover:bg-[#eeebe4]"
        >
          <CloseIcon />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      <div className="flex shrink-0 justify-end border-t border-[#dad5ca] px-5 pt-3.5 pb-5">
        <button type="button" popoverTarget={id} popoverTargetAction="hide" className={paperButton}>
          Done
        </button>
      </div>
    </div>
  );
}
