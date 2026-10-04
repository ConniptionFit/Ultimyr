import { DEFAULT_NAMING, NAMING_COOKIE, parseNamingMode, text } from "@ultimyr/lore";
import { UIcon } from "@ultimyr/ui-icons";
import { BookOpen } from "lucide-react";
import { cookies } from "next/headers";
import { SplashCta } from "@/components/splash-cta";

export default async function Splash() {
  const mode = parseNamingMode((await cookies()).get(NAMING_COOKIE)?.value ?? DEFAULT_NAMING);
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 text-center">
      <div className="ulti-fade space-y-8">
        <UIcon icon={BookOpen} size={36} strokeWidth={1.25} className="mx-auto text-accent" />
        <h1 className="text-6xl tracking-tight sm:text-7xl">Ultimyr</h1>
        <p className="font-serif text-2xl text-muted">{text("splashTitle", mode)}</p>
        <p className="mx-auto max-w-md text-muted">{text("splashSub", mode)}</p>
        <div className="flex justify-center gap-3 pt-2">
          <SplashCta label={text("splashCta", mode)} />
        </div>
      </div>
    </main>
  );
}
