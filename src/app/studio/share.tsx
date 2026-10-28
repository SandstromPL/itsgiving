"use client";

import { useId, useRef, useState, type Ref, type ToggleEvent } from "react";
import { useCopied } from "./clipboard";
import { useLingo } from "./lingo";
import { PaperWindow } from "./paper-window";
import { pillButton } from "./ui";

// Sharing a board that has a link of its own (an example's page, or a saved treatment while its share link is on):
// the link to copy, the phone's own share sheet, WhatsApp and email, and a QR code to open it on a phone at once. The
// QR code is drawn here (lean-qr, loaded when the window first opens), so nothing leaves the browser until the person
// picks a way to send it.

const LINES = {
  genz: { title: "send it to the group chat" },
  plain: { title: "Share this treatment" },
};

/** WhatsApp and email links that carry the treatment's title and link, and nothing else. */
export function shareLinks(url: string, title: string): { whatsapp: string; email: string } {
  const text = `${title}, a treatment on itsgiving`;
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text}: ${url}`)}`,
    email: `mailto:?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(`${text}\n\n${url}`)}`,
  };
}

const outline = "rounded-full border border-[#121211] px-4 py-2.5 text-[15px] font-semibold hover:bg-[#121211] hover:text-white";

/** The QR code as an SVG path in module units, with a quiet zone of four modules around it. */
interface Qr {
  url: string;
  size: number;
  path: string;
}

/**
 * The share window: a `.window` popover (a sheet along the bottom on a phone). `path` is the page's own path; the link
 * is that path on whichever site is serving it, read when the window opens.
 */
export function ShareWindow({ id, title, path, ref }: { id: string; title: string; path: string; ref?: Ref<HTMLDivElement> }) {
  const { unc } = useLingo();
  const lines = unc ? LINES.plain : LINES.genz;
  const [url, setUrl] = useState<string | null>(null);
  const [qr, setQr] = useState<Qr | null>(null);
  const [native, setNative] = useState(false);
  const { copied, copy } = useCopied();
  const field = useRef<HTMLInputElement>(null);

  const opened = async (event: ToggleEvent<HTMLDivElement>) => {
    if (event.newState !== "open") return;
    const link = `${window.location.origin}${path}`;
    setUrl(link);
    setNative(typeof navigator.share === "function");
    if (qr?.url === link) return;
    try {
      const [{ generate }, { toSvgPath }] = await Promise.all([import("lean-qr"), import("lean-qr/extras/svg")]);
      const code = generate(link);
      setQr({ url: link, size: code.size, path: toSvgPath(code) });
    } catch {
      setQr(null);
    }
  };
  const links = url ? shareLinks(url, title) : null;

  return (
    <PaperWindow id={id} label="share" ref={ref} onToggle={opened}>
      <div className="flex flex-col gap-5 p-5">
        <div className="flex flex-col gap-2">
          <h2 id={`${id}-title`} className="type-head text-[2.1rem] leading-none text-[#121211]">
            {lines.title}
          </h2>
          <p className="font-serif text-[1.3rem] leading-snug text-[#2b2925] italic">{title}</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Dark modules on white in either theme, with the quiet zone a scanner needs. */}
          <span className="grid size-[9.5rem] shrink-0 place-items-center rounded-xl bg-white ring-1 ring-[#dad5ca]">
            {qr && (
              <svg role="img" aria-label="QR code for the link" viewBox={`-4 -4 ${qr.size + 8} ${qr.size + 8}`} className="size-full">
                <path d={qr.path} fill="#121211" />
              </svg>
            )}
          </span>
          <p className="text-[15px] leading-6 text-[#4a4741]">Scan to open on your phone.</p>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-link`} className="text-[14px] font-semibold text-[#4a4741]">
            Link
          </label>
          <div className="flex gap-2">
            <input
              ref={field}
              id={`${id}-link`}
              readOnly
              value={url ?? ""}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 rounded-xl border border-[#c9c1af] bg-[#fffdf6] px-3 py-2.5 font-mono text-[13px] text-[#2b2925]"
            />
            <button
              type="button"
              autoFocus
              onClick={async () => {
                if (url && !(await copy(url))) field.current?.select();
              }}
              className="shrink-0 rounded-full bg-[#121211] px-4 py-2.5 text-[15px] font-bold text-white"
            >
              {copied ? "Link copied" : "Copy link"}
            </button>
          </div>
        </div>
        {links && (
          <div className="flex flex-wrap gap-2">
            {native && (
              <button
                type="button"
                onClick={() => navigator.share({ title, url: url ?? undefined }).catch(() => undefined)}
                className={outline}
              >
                Share…
              </button>
            )}
            <a href={links.whatsapp} target="_blank" rel="noreferrer" className={outline}>
              WhatsApp<span className="sr-only"> (opens in a new tab)</span>
            </a>
            <a href={links.email} className={outline}>
              Email
            </a>
          </div>
        )}
        <p role="status" className="sr-only">
          {copied ? "Link copied." : ""}
        </p>
      </div>
    </PaperWindow>
  );
}

/** A Share button that opens the share window, for a board with a link of its own. */
export function ShareButton({ title, path, className = "" }: { title: string; path: string; className?: string }) {
  const id = useId();
  return (
    <>
      <button type="button" popoverTarget={id} className={`${pillButton} print:hidden ${className}`}>
        <svg
          aria-hidden
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
        </svg>
        Share
      </button>
      <ShareWindow id={id} title={title} path={path} />
    </>
  );
}
