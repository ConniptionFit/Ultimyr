import { NAMING_COOKIE, parseNamingMode } from "@ultimyr/lore";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";
import { NamingProvider } from "@/lib/naming";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Ultimyr", template: "%s | Ultimyr" },
  description: "A quiet place to know things. Study guides, flashcards and practice exams.",
};
export const viewport: Viewport = { colorScheme: "light dark" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const mode = parseNamingMode(jar.get(NAMING_COOKIE)?.value);
  return (
    <html lang="en">
      <body>
        <NamingProvider initial={mode}>
          <AuthProvider>{children}</AuthProvider>
        </NamingProvider>
      </body>
    </html>
  );
}
