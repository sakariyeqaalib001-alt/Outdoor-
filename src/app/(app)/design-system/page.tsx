import type { Metadata } from "next";
import { ArrowUpRight, Plus } from "lucide-react";
import { AppHeader } from "@/components/layout/app-header";
import { BrandLogo } from "@/components/layout/brand-logo";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { contrastRatio, palette, statusColors, type StatusKey } from "@/lib/brand";
import { formatBusinessDate } from "@/lib/dates";
import { Suspense } from "react";
import { AccessDenied } from "@/components/access-denied";
import { Skeleton } from "@/components/ui/skeleton";
import { can, getAccess } from "@/server/auth/access";
import { t } from "@/lib/i18n";
import { formatUSD } from "@/lib/money";

export const metadata: Metadata = { title: t("nav.designSystem") };

const swatches: Array<{ name: string; hex: string; use: string }> = [
  { name: "green-900", hex: palette.green900, use: "Links, small coloured text, hover" },
  { name: "green-700", hex: palette.green700, use: "Primary buttons, active nav" },
  { name: "green-500", hex: palette.green500, use: "Highlights, focus ring, charts" },
  { name: "green-300", hex: palette.green300, use: "Success, Active" },
  { name: "orange-500", hex: palette.orange500, use: "Brand accent" },
  { name: "orange-300", hex: palette.orange300, use: "Warning, Pending" },
  { name: "orange-700", hex: palette.orange700, use: "Danger, Rejected" },
  { name: "blue-500", hex: palette.blue500, use: "Info, charts" },
  { name: "purple-500", hex: palette.purple500, use: "Flagged, charts" },
  { name: "pink-500", hex: palette.pink500, use: "Expire, charts" },
  { name: "gray-900", hex: palette.gray900, use: "Body text" },
  { name: "gray-700", hex: palette.gray700, use: "Muted text" },
  { name: "gray-200", hex: palette.gray200, use: "Borders" },
  { name: "gray-100", hex: palette.gray100, use: "Page background" },
];

function textOn(hex: string) {
  return contrastRatio(palette.white, hex) >= 4.5 ? palette.white : palette.gray900;
}

async function BrandCheckGuard({ children }: { children: React.ReactNode }) {
  const access = await getAccess();
  return can(access, "settings.manage") ? <>{children}</> : <AccessDenied />;
}

export default function DesignSystemPage() {
  const sampleDate = new Date("2026-10-19T09:00:00Z"); // fixed sample value; real dates come from the server
  return (
    <>
      <AppHeader title={t("designSystem.title")} />
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <BrandCheckGuard>
        <p className="max-w-3xl text-muted-foreground">{t("designSystem.intro")}</p>

        <Card>
          <CardHeader>
            <CardTitle className="brand-title text-base">logo</CardTitle>
            <CardDescription>Official SVG files, white background only, 1.5x clear space.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-6">
            <BrandLogo variant="primary" height={64} />
            <BrandLogo variant="primary" height={40} />
            <BrandLogo variant="mark" height={30} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="brand-title text-base">{t("designSystem.colors")}</CardTitle>
            <CardDescription>Brand kit palette. Lavender family is not used (source values are incorrect).</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {swatches.map((s) => (
              <div key={s.name} className="overflow-hidden rounded-lg border">
                <div
                  className="flex h-16 items-end p-2 text-xs font-semibold"
                  style={{ backgroundColor: s.hex, color: textOn(s.hex) }}
                >
                  {s.hex}
                </div>
                <div className="p-2 text-xs">
                  <div className="font-semibold">{s.name}</div>
                  <div className="text-muted-foreground">{s.use}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="brand-title text-base">{t("designSystem.typography")}</CardTitle>
              <CardDescription>Signika only. Titles semibold and lowercase.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <h2 className="text-3xl">page title 30px semibold</h2>
              <h3 className="text-2xl">section title 24px semibold</h3>
              <p className="text-base">Body text 16px regular — Customer Name, Index Number 50091293.</p>
              <p className="text-sm">Table text 14px regular — {formatBusinessDate(sampleDate)} · {formatUSD(1250)}</p>
              <p className="text-sm text-muted-foreground">Muted label 14px</p>
              <p className="text-sm">
                <a href="#" className="text-brand-link underline underline-offset-4">Link text in green-900</a>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="brand-title text-base">{t("designSystem.buttons")}</CardTitle>
              <CardDescription>All text/background pairs meet WCAG AA.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button>
                <Plus /> New sale
              </Button>
              <Button variant="outline">Cancel</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Reject</Button>
              <Button variant="link">View all</Button>
              <Button size="lg">Large button</Button>
              <Button disabled>Disabled</Button>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="brand-title text-base">{t("designSystem.statuses")}</CardTitle>
              <CardDescription>Always a text label, never colour alone.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {(Object.keys(statusColors) as StatusKey[]).map((status) => (
                <StatusBadge key={status} status={status} />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Units sold this month</CardDescription>
              <CardTitle className="text-3xl font-semibold tabular-nums">18</CardTitle>
              <CardAction>
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand-link">
                  <ArrowUpRight className="size-4" aria-hidden="true" /> 12.5%
                </span>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>Example KPI card layout (Phase 10). Values here are sample data.</p>
              <div className="h-2 w-full rounded-full bg-muted">
                <div className="h-2 rounded-full bg-brand-highlight" style={{ width: "90%" }} />
              </div>
              <p>18 of 20 — Baseline</p>
            </CardContent>
          </Card>
        </div>
        </BrandCheckGuard>
        </Suspense>
      </div>
    </>
  );
}
