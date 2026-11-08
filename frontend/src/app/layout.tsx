import type { Metadata } from "next";
import { Sen } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const sen = Sen({
  variable: "--font-sen",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ReFlo · Your study week",
  description:
    "Plan university assignments around your commitments and replan unfinished work.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-type="software"
      className={`${sen.variable} h-full antialiased`}
    >
      <head>
        <Script id="schedule-theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: `(() => {
          let theme;
          try { theme = localStorage.getItem('schedule-maker-theme'); } catch {}
          if (theme !== 'light' && theme !== 'dark') {
            theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
          }
          document.documentElement.dataset.theme = theme;
        })();` }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
