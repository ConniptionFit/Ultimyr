import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { Header } from "@/components/header";
import { Shell } from "@/components/ui";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <>
      <Header />
      <Shell narrow>
        <AuthForm mode="register" />
      </Shell>
    </>
  );
}
