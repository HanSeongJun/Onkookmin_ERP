import localFont from "next/font/local"

/**
 * Paperlogy (페이퍼로지): the app's font, free for commercial use under the
 * SIL Open Font License (see README.md and OFL.txt in this folder).
 * Regular (400) is used for body text, Bold (700) for titles, labels and
 * buttons. next/font serves the files from our own domain (no external
 * requests). Put `paperlogy.variable` on <html>; globals.css makes
 * --font-paperlogy the default font.
 */
export const paperlogy = localFont({
  src: [
    { path: "./Paperlogy-4Regular.woff2", weight: "400", style: "normal" },
    { path: "./Paperlogy-7Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-paperlogy",
  display: "swap",
})
