import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EnvironmentBanner } from "@/components/environment-banner";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { isTrainingSite } from "@/lib/environment";
import { t } from "@/lib/i18n";
import "./globals.css";

// Signika — the only brand typeface (brand kit, SIL Open Font License; see ./fonts/OFL.txt).
const signika = localFont({
  variable: "--font-signika",
  display: "swap",
  src: [
    { path: "./fonts/signika-300.woff2", weight: "300", style: "normal" },
    { path: "./fonts/signika-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/signika-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/signika-700.woff2", weight: "700", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: {
    default: t("app.name"),
    template: `%s · ${t("app.shortName")}${isTrainingSite() ? ` (${t("environment.trainingLabel")})` : ""}`,
  },
  description: t("app.description"),
  applicationName: t("app.shortName"),
  icons: {
    icon: [
      { url: "/brand/icons/so-icon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/brand/icons/so-icon-180.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${signika.variable} h-full antialiased`}>
      <body className="min-h-full">
        <EnvironmentBanner />
        <TooltipProvider>{children}</TooltipProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
