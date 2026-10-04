import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { Header } from "@/components/header";
import { Shell } from "@/components/ui";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <>
      <Header />
      <Shell narrow>
        <AuthForm mode="login" />
      </Shell>
    </>
  );
}
