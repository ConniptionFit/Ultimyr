import { NAMING_COOKIE, parseNamingMode, text } from "@ultimyr/lore";
import { cookies } from "next/headers";
import Link from "next/link";

export default async function NotFound() {
  const mode = parseNamingMode((await cookies()).get(NAMING_COOKIE)?.value);
  return (
    <main className="mx-auto max-w-md px-4 py-32 text-center">
      <h1 className="text-3xl">404</h1>
      <p className="mt-3 text-muted">{text("notFound", mode)}</p>
      <Link href="/" className="mt-6 inline-block text-accent underline">
        Return to the entrance
      </Link>
    </main>
  );
}
