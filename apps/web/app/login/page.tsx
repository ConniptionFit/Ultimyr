import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { DotGridBackground } from "@/components/dot-grid-background";
import { Header } from "@/components/header";
import { Shell } from "@/components/ui";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <>
      <DotGridBackground />
      <Header />
      <Shell narrow>
        <AuthForm mode="login" />
      </Shell>
    </>
  );
}
