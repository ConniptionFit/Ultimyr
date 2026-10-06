import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Build with an AI assistant" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
