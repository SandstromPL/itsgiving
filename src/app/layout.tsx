import type { Metadata } from "next";
import { fontVariables } from "./fonts";
import { ConsoleNote, DirectorsCut } from "./studio/eggs";
import { LingoProvider } from "./studio/lingo";
import { SiteFooter } from "./studio/site-footer";
import { THEME_SCRIPT } from "./studio/theme-script";
import "./globals.css";

export const metadata: Metadata = {
  title: "itsgiving: treatments with taste",
  description: "An agentic pre-production assistant for music-video and short-film directors, grounded in Qloo's taste graph.",
  // A shared link shows the full-width card (opengraph-image.tsx), not a thumbnail.
  twitter: { card: "summary_large_image" },
};

/**
 * Every page: the homepage (the pitch), /studio (the tool) and /t/<slug> (a featured treatment). Each brings its own
 * header; the copy register, the footer and the eggs are shared. Nothing here reads the request, so every page can
 * stay as static as its own content allows.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  // The theme script may set data-theme before React hydrates, so <html> is allowed to differ from the server's.
  return (
    <html lang="en" className={`${fontVariables} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <LingoProvider>
          {children}
          <SiteFooter />
          <DirectorsCut />
          <ConsoleNote />
        </LingoProvider>
      </body>
    </html>
  );
}
