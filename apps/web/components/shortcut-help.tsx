"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";

const Dialog = dynamic(() => import("./shortcut-dialog"), { ssr: false });
const QuickJump = dynamic(() => import("./quick-jump-dialog"), { ssr: false });

/** Press ? anywhere (outside a text box) for the list of keyboard shortcuts. The dialog loads on first use. */
export function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  const [jump, setJump] = useState(false);
  const { state } = useAuth();
  const signedIn = state.status === "authenticated";
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (signedIn && e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setJump((j) => !j);
        return;
      }
      if ((e.key !== "?" && e.key !== "/") || e.ctrlKey || e.metaKey || e.altKey) return;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if (e.key === "/") {
        // Slash jumps to search: the header box when it is showing, else the search page.
        e.preventDefault();
        const box = document.querySelector<HTMLInputElement>('header input[type="search"]');
        if (box && box.offsetParent !== null) box.focus();
        else router.push("/search");
        return;
      }
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, signedIn]);

  return (
    <>
      {open && <Dialog onClose={() => setOpen(false)} />}
      {jump && signedIn && <QuickJump onClose={() => setJump(false)} />}
    </>
  );
}
