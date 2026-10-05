import { NAMING_COOKIE, parseNamingMode } from "@ultimyr/lore";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";
import { TabIcon } from "@/components/tab-icon";
import { ServiceWorker } from "@/components/service-worker";
import { DISPLAY_COOKIE, displayAttrs, parseDisplay } from "@/lib/display-shared";
import { DisplayProvider } from "@/lib/display";
import { NamingProvider } from "@/lib/naming";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Ultimyr", template: "%s | Ultimyr" },
  description: "A quiet place to know things. Study guides, flashcards and practice exams.",
  icons: { icon: [{ url: "/icons/favicon.svg", type: "image/svg+xml" }], apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = { colorScheme: "light dark", themeColor: "#2f6f62" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const mode = parseNamingMode(jar.get(NAMING_COOKIE)?.value);
  const display = parseDisplay(jar.get(DISPLAY_COOKIE)?.value);
  return (
    <html lang="en" {...displayAttrs(display)}>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <NamingProvider initial={mode}>
          <DisplayProvider initial={display}>
            <AuthProvider>{children}</AuthProvider>
            <TabIcon />
            <ServiceWorker />
          </DisplayProvider>
        </NamingProvider>
      </body>
    </html>
  );
}
