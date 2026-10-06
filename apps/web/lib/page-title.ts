import { useEffect } from "react";

/** Put a record's own name in the tab title ("Network+ | Ultimyr") so tabs, history and screen readers tell pages apart. */
export function usePageTitle(name: string | null | undefined) {
  useEffect(() => {
    if (!name) return;
    const before = document.title;
    document.title = `${name} | Ultimyr`;
    return () => {
      document.title = before;
    };
  }, [name]);
}
