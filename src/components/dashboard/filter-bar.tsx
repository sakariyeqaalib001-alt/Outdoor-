"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PERIODS, PERIOD_LABEL, type Filters } from "@/lib/dashboard";
import { t } from "@/lib/i18n";

type Option = { id: string; name: string; city_id?: string | null };

/**
 * Period and filter selector — a plain GET form, so every view can be shared or bookmarked. Choosing a value
 * reloads the view; a custom range is applied with the button. Lists only hold what the user may see.
 */
export function FilterBar({
  path,
  filters,
  cities,
  branches,
  products,
  agents,
  showAgents,
  today,
}: {
  path: string;
  filters: Filters;
  cities: Option[];
  branches: Option[];
  products: Option[];
  agents: Option[];
  showAgents: boolean;
  today: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [period, setPeriod] = useState(filters.period);
  const [city, setCity] = useState(filters.city_id ?? "");
  const submit = () => form.current?.requestSubmit();
  const cityBranches = city ? branches.filter((b) => b.city_id === city) : branches;
  const cityAgents = city ? agents.filter((a) => a.city_id === city) : agents;
  const changed = filters.period !== "month" || Boolean(filters.city_id || filters.branch_id || filters.product_id || filters.agent_id);

  return (
    <form ref={form} action={path} className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
      <div className="col-span-2 space-y-1.5 sm:w-44">
        <Label htmlFor="period">{t("dashboard.filter.period")}</Label>
        <NativeSelect
          id="period"
          name="period"
          value={period}
          onChange={(e) => {
            setPeriod(e.target.value as Filters["period"]);
            if (e.target.value !== "custom") requestAnimationFrame(submit);
          }}
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>{t(PERIOD_LABEL[p])}</option>
          ))}
        </NativeSelect>
      </div>
      {period === "custom" ? (
        <>
          <div className="space-y-1.5 sm:w-40">
            <Label htmlFor="from">{t("dashboard.filter.from")}</Label>
            <Input id="from" name="from" type="date" required max={today} defaultValue={filters.from} className="h-11 md:h-9" />
          </div>
          <div className="space-y-1.5 sm:w-40">
            <Label htmlFor="to">{t("dashboard.filter.to")}</Label>
            <Input id="to" name="to" type="date" required max={today} defaultValue={filters.to ?? today} className="h-11 md:h-9" />
          </div>
          <Button type="submit" className="col-span-2 h-11 sm:col-span-1 md:h-9">{t("dashboard.filter.apply")}</Button>
        </>
      ) : null}
      <div className="space-y-1.5 sm:w-40">
        <Label htmlFor="city_id">{t("dashboard.filter.city")}</Label>
        <NativeSelect
          id="city_id"
          name="city_id"
          value={city}
          onChange={(e) => {
            setCity(e.target.value);
            requestAnimationFrame(submit);
          }}
        >
          <option value="">{t("dashboard.filter.allCities")}</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5 sm:w-44">
        <Label htmlFor="branch_id">{t("dashboard.filter.branch")}</Label>
        <NativeSelect id="branch_id" name="branch_id" defaultValue={filters.branch_id ?? ""} key={`b-${city}`} onChange={submit}>
          <option value="">{t("dashboard.filter.allBranches")}</option>
          {cityBranches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5 sm:w-36">
        <Label htmlFor="product_id">{t("dashboard.filter.product")}</Label>
        <NativeSelect id="product_id" name="product_id" defaultValue={filters.product_id ?? ""} onChange={submit}>
          <option value="">{t("dashboard.filter.allProducts")}</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </NativeSelect>
      </div>
      {showAgents ? (
        <div className="space-y-1.5 sm:w-48">
          <Label htmlFor="agent_id">{t("dashboard.filter.agent")}</Label>
          <NativeSelect id="agent_id" name="agent_id" defaultValue={filters.agent_id ?? ""} key={`a-${city}`} onChange={submit}>
            <option value="">{t("dashboard.filter.allAgents")}</option>
            {cityAgents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
      <noscript>
        <Button type="submit" variant="outline">{t("dashboard.filter.apply")}</Button>
      </noscript>
      {changed ? (
        <Button asChild variant="ghost" className="col-span-2 h-11 sm:col-span-1 md:h-9">
          <Link href={path}>{t("dashboard.filter.reset")}</Link>
        </Button>
      ) : null}
    </form>
  );
}
