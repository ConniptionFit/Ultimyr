import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ultimyr",
    short_name: "Ultimyr",
    description: "A quiet place to know things. Study guides, flashcards and practice exams.",
    start_url: "/reading-room",
    scope: "/",
    display: "standalone",
    background_color: "#faf7f0",
    theme_color: "#2f6f62",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
