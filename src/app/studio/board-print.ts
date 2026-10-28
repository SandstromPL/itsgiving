import { useEffect, type RefObject } from "react";
import { cssString } from "@/lib/text";

// How a board sits on paper: a film or a place as one row, and the printed page's running title.

/**
 * On paper a film or a place is one row: its picture with Qloo's receipt under it on the left, the writing on the right
 * (the card's `read` part, which on screen is no box at all). The third row takes whatever height the writing needs past
 * them; a place's map link sits in the fourth, under the writing.
 */
export const printRow = "print:grid print:grid-cols-[40%_minmax(0,1fr)] print:grid-rows-[auto_auto_1fr_auto]";
export const printPicture = "print:col-start-1 print:row-start-1";
export const printRead = "contents print:col-start-2 print:row-span-3 print:row-start-1 print:flex print:flex-col print:gap-3 print:p-5";
export const printReceipt = "print:col-start-1 print:row-start-2 print:m-4";

/**
 * Printing names the pages after the treatment. Chrome takes the PDF's file name from the tab's title, and the running
 * footer (globals.css) can only take words from a style rule, so both get the title as printing starts; the tab's own
 * title comes back after. Only the board on screen answers: Next keeps pages it has left in the document, hidden.
 */
export function usePrintTitle(title: string, article: RefObject<HTMLElement | null>) {
  useEffect(() => {
    let tab: string | null = null;
    const before = () => {
      if (!article.current?.getClientRects().length) return;
      tab = document.title;
      document.title = `${title} (itsgiving treatment)`;
      let footer = document.getElementById("print-footer");
      if (!footer) {
        footer = document.createElement("style");
        footer.id = "print-footer";
        document.head.append(footer);
      }
      // In Chrome this later rule beats the stylesheet's :first one, so the cover page's empty footer comes again after it.
      footer.textContent = `@page { @bottom-left { content: ${cssString(title)}; } } @page :first { @bottom-left { content: ""; } }`;
    };
    const after = () => {
      if (tab !== null) document.title = tab;
      tab = null;
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [title, article]);
}
