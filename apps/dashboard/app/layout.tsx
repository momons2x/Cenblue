import type { Metadata } from "next";
import "./globals.css";

const themeBootstrap = `(function(){try{var t=localStorage.getItem("cenblu-theme");var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.dataset.theme=d?"dark":"light";document.documentElement.style.colorScheme=d?"dark":"light"}catch(e){}})()`;

export const metadata: Metadata = {
  title: "Cenblue",
  description: "Local-first video repost pipeline",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script id="theme-init" dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        {children}
      </body>
    </html>
  );
}
