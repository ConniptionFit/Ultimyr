"use client";

import dynamic from "next/dynamic";

/** Markdown (react-markdown and its plugins, about 43 KB gzip) loads in its own chunk, so pages open and become usable before it arrives. */
export const Markdown = dynamic(() => import("./markdown-render").then((m) => m.Markdown), {
  loading: () => <div className="prose-ulti min-h-6" aria-busy="true" />,
});
