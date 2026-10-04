import type { Metadata } from "next";
import { Header } from "@/components/header";
import { SetPasswordForm } from "@/components/set-password-form";
import { Shell } from "@/components/ui";

export const metadata: Metadata = { title: "Set your password", robots: { index: false } };

export default function SetPasswordPage() {
  return (
    <>
      <Header />
      <Shell narrow>
        <SetPasswordForm />
      </Shell>
    </>
  );
}
