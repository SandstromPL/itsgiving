/** The site's sections, the same in the header and the footer. */
export const NAV = [
  { id: "examples", href: "/examples", label: "Examples" },
  { id: "studio", href: "/studio", label: "Studio" },
  { id: "about", href: "/about", label: "About" },
] as const;

export type Section = (typeof NAV)[number]["id"];

/** The source code, public under the MIT licence. */
export const REPO = "https://github.com/SandstromPL/itsgiving";
