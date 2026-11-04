import type { Metadata } from "next";
import { CheckCircle2, CircleAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBusinessDateTime } from "@/lib/dates";
import { t, type MessageKey } from "@/lib/i18n";
import { listCities } from "@/server/settings/queries";
import { environmentChecks, getOpeningStock, getReadiness } from "@/server/readiness/queries";
import { SettingsShell } from "../settings-shell";

export const metadata: Metadata = { title: t("readiness.title") };

type Search = Promise<Record<string, string | string[] | undefined>>;

function Status({ ok, required }: { ok: boolean; required: boolean }) {
  if (ok) return <CheckCircle2 className="size-5 shrink-0 text-brand-link" aria-label={t("readiness.pass")} />;
  if (required) return <XCircle className="size-5 shrink-0 text-destructive" aria-label={t("readiness.fail")} />;
  return <CircleAlert className="size-5 shrink-0 text-muted-foreground" aria-label={t("readiness.advice")} />;
}

/** Settings → Pilot readiness (Roadmap Phase 11): go-live checks for a city, opening stock and server settings. */
async function Content({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const cities = await listCities();
  const pilot = cities.find((c) => c.name === "Hargeisa") ?? cities[0];
  const city = cities.find((c) => c.id === params.city) ?? pilot;
  if (!city) return <p className="text-muted-foreground">{t("readiness.noCities")}</p>;
  const [checks, stock] = await Promise.all([getReadiness(city.id), getOpeningStock()]);
  const env = environmentChecks();
  const required = [...checks.filter((c) => c.required), ...env.filter((e) => e.required)];
  const passed = required.filter((c) => c.ok).length;
  const allPass = passed === required.length && stock.every((s) => s.difference === 0);

  return (
    <div className="grid gap-4">
      <Card className="gap-3 p-5 ring-border">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg text-brand-link">{t("readiness.summaryTitle", { city: city.name })}</h2>
            <p className="text-sm text-muted-foreground">{t("readiness.summary", { passed, total: required.length })}</p>
          </div>
          <form className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="city">{t("readiness.city")}</Label>
              <NativeSelect id="city" name="city" defaultValue={city.id} className="w-44">
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </NativeSelect>
            </div>
            <Button type="submit" variant="outline" className="h-11 md:h-9">{t("readiness.check")}</Button>
          </form>
        </div>
        <p className={allPass ? "font-semibold text-brand-link" : "font-semibold text-destructive"}>
          {t(allPass ? "readiness.ready" : "readiness.notReady")}
        </p>
        <p className="text-xs text-muted-foreground">{t("readiness.checkedAt", { time: formatBusinessDateTime(new Date()) })}</p>
      </Card>

      <Card className="gap-3 p-5 ring-border">
        <h2 className="text-lg text-brand-link">{t("readiness.dataTitle")}</h2>
        <ul className="grid gap-3">
          {checks.map((c) => (
            <li key={c.check_key} className="flex gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
              <Status ok={c.ok} required={c.required} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {t(`readiness.checks.${c.check_key}.label` as MessageKey)}
                  {!c.required ? <span className="ml-2 text-xs font-normal text-muted-foreground">{t("readiness.adviceTag")}</span> : null}
                </p>
                <p className="text-sm text-muted-foreground">{t(`readiness.checks.${c.check_key}.hint` as MessageKey, { n: c.n })}</p>
                {!c.ok && c.detail.length ? <p className="mt-1 text-sm">{c.detail.join(", ")}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="gap-3 p-5 ring-border">
        <h2 className="text-lg text-brand-link">{t("readiness.stockTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("readiness.stockBody")}</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("readiness.stock.item")}</TableHead>
              <TableHead className="text-right">{t("readiness.stock.received")}</TableHead>
              <TableHead className="text-right">{t("readiness.stock.adjusted")}</TableHead>
              <TableHead className="text-right">{t("readiness.stock.central")}</TableHead>
              <TableHead className="text-right">{t("readiness.stock.teams")}</TableHead>
              <TableHead className="text-right">{t("readiness.stock.transit")}</TableHead>
              <TableHead className="text-right">{t("readiness.stock.faulty")}</TableHead>
              <TableHead className="text-right">{t("readiness.stock.issued")}</TableHead>
              <TableHead className="text-right">{t("readiness.stock.removed")}</TableHead>
              <TableHead className="text-right">{t("readiness.stock.difference")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stock.map((s) => (
              <TableRow key={s.item_id}>
                <TableCell className="font-semibold">{s.name}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{s.received}</TableCell>
                <TableCell className="text-right tabular-nums">{s.adjusted}</TableCell>
                <TableCell className="text-right tabular-nums">{s.central}</TableCell>
                <TableCell className="text-right tabular-nums">{s.teams}</TableCell>
                <TableCell className="text-right tabular-nums">{s.in_transit}</TableCell>
                <TableCell className="text-right tabular-nums">{s.faulty}</TableCell>
                <TableCell className="text-right tabular-nums">{s.issued}</TableCell>
                <TableCell className="text-right tabular-nums">{s.removed}</TableCell>
                <TableCell className={s.difference === 0 ? "text-right font-semibold tabular-nums" : "text-right font-semibold text-destructive tabular-nums"}>
                  {s.difference}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="gap-3 p-5 ring-border">
        <h2 className="text-lg text-brand-link">{t("readiness.envTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("readiness.envBody")}</p>
        <ul className="grid gap-3">
          {env.map((e) => (
            <li key={e.key} className="flex gap-3">
              <Status ok={e.ok} required={e.required} />
              <div>
                <p className="font-semibold">{t(`readiness.env.${e.key}.label` as MessageKey)}</p>
                <p className="text-sm text-muted-foreground">{t(`readiness.env.${e.key}.hint` as MessageKey)}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export default function ReadinessPage({ searchParams }: { searchParams: Search }) {
  return (
    <SettingsShell>
      <Content searchParams={searchParams} />
    </SettingsShell>
  );
}
