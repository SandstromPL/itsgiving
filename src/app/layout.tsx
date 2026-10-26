import type { Metadata } from "next";
import { fontVariables } from "./fonts";
import { THEME_SCRIPT } from "./studio/theme-script";
import "./globals.css";

export const metadata: Metadata = {
  title: "itsgiving: treatments with taste",
  description: "An agentic pre-production assistant for music-video and short-film directors, grounded in Qloo's taste graph.",
  // A shared link shows the full-width card (opengraph-image.tsx), not a thumbnail.
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // The theme script may set data-theme before React hydrates, so <html> is allowed to differ from the server's.
  return (
    <html lang="en" className={`${fontVariables} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
