import type { Metadata } from "next";
import "./globals.css";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { GlobalErrorHandler } from "@/components/GlobalErrorHandler";
import { PersistentShell } from "@/components/PersistentShell";

export const metadata: Metadata = {
  title: "AutoClean AI",
  description: "AI-powered data cleaning and quality intelligence",
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      {/* Early capture-phase suppressor — runs before React/Next.js hydration.
          Prevents ApiError and AbortError from ever reaching the dev overlay. */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
(function(){
  window.addEventListener('unhandledrejection', function(e){
    var r = e.reason;
    if(r && (r.name==='ApiError' || r.name==='AbortError')) { e.preventDefault(); }
  }, true);
})();
        `}} />
      </head>
      <body>
        <ThemeProvider>
          <GlobalErrorHandler />
          <ErrorBoundary>
            <PersistentShell>{children}</PersistentShell>
          </ErrorBoundary>
        </ThemeProvider>
      </body>
    </html>
  );
}
