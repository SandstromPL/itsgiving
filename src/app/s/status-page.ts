import { NextResponse } from "next/server";
import { THEME_SCRIPT } from "../studio/theme-script";

// A saved treatment's refusals that must carry their status, 429 and 503. An app page can't: Next fixes a page's
// status once it starts streaming, and only notFound and its kind set one before then. So the proxy answers with this
// page: plain HTML in the site's colours, light or dark as the visitor chose, with the way back.

const STYLE = `:root{color-scheme:light;--bg:#f2f0ea;--fg:#121211;--dim:#4a4741}
:root[data-theme=dark]{color-scheme:dark;--bg:#1b1916;--fg:#f2f0ea;--dim:#d6d1c7}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;background:var(--bg);color:var(--fg);font-family:system-ui,sans-serif}
header{padding:20px 16px}
header a{color:inherit;font-size:22px;font-weight:800;letter-spacing:-.03em;text-decoration:none}
main{flex:1;display:flex;flex-direction:column;justify-content:center;gap:24px;box-sizing:border-box;width:100%;max-width:80rem;margin:0 auto;padding:96px 16px}
h1{margin:0;max-width:14ch;font-size:clamp(3rem,7vw,6rem);font-weight:800;line-height:.95;letter-spacing:-.04em}
p{margin:0;max-width:46ch;font-size:1.2rem;line-height:1.45;color:var(--dim)}
main a{align-self:flex-start;display:inline-flex;align-items:center;min-height:56px;padding:0 28px;border:1px solid var(--fg);border-radius:999px;color:inherit;font-size:17px;font-weight:700;text-decoration:none}
a:focus-visible{outline:2px solid var(--fg);outline-offset:3px}
@media(min-width:40rem){header,main{padding-inline:32px}}`;

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The page for a refusal, with its status, and Retry-After in whole seconds. Never cached: it's about this moment. */
export function statusPage(
  status: 429 | 503,
  { title, heading, text }: { title: string; heading: string; text: string },
  retryAfterSeconds: number,
): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escape(title)}</title><script>${THEME_SCRIPT}</script><style>${STYLE}</style></head><body><header><a href="/">itsgiving</a></header><main><h1>${escape(heading)}</h1><p>${escape(text)}</p><a href="/">Back to the homepage</a></main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": String(retryAfterSeconds) },
  });
}
