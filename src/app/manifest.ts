import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Club 95",
    short_name: "Club 95",
    description: "Caja diaria, gastos y membresías",
    start_url: "/",
    display: "standalone",
    background_color: "#efeae6",
    theme_color: "#ff4701",
    lang: "es-AR",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
