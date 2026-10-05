import type { Metadata } from "next";
import { DotGridBackground } from "@/components/dot-grid-background";
import { Header } from "@/components/header";
import { SetPasswordForm } from "@/components/set-password-form";
import { Shell } from "@/components/ui";

export const metadata: Metadata = { title: "Set your password", robots: { index: false } };

export default function SetPasswordPage() {
  return (
    <>
      <DotGridBackground />
      <Header />
      <Shell narrow>
        <SetPasswordForm />
      </Shell>
    </>
  );
}
