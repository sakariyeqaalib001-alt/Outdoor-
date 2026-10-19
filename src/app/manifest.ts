import type { MetadataRoute } from "next";
import { t } from "@/lib/i18n";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: t("app.name"),
    short_name: t("app.shortName"),
    description: t("app.description"),
    start_url: "/",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#FFFFFF",
    icons: [
      { src: "/brand/icons/so-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icons/so-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/brand/icons/so-icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
