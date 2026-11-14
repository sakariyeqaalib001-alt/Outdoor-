"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { t } from "@/lib/i18n";
import { isValidIndex } from "@/lib/sales";
import { submitSwitch } from "@/server/approvals/actions";
import type { SwitchFormData } from "@/server/approvals/queries";

/** Product switch FTTA ↔ FTTH (FR-SW-01…06, D-38). The request id makes a retry safe (no second switch). */
export function SwitchForm({ data }: { data: SwitchFormData }) {
  const router = useRouter();
  const cityStart = data.myCity ?? (data.canOverrideCity ? data.cities[0]?.id ?? "" : "");
  const blank = () => ({
    requestId: crypto.randomUUID(),
    fullName: "",
    phone: "",
    index: "",
    fromId: data.products[0]?.id ?? "",
    planId: "",
    cityId: cityStart,
    branchId: data.branches.find((b) => b.city_id === cityStart)?.id ?? "",
  });
  const [v, setV] = useState(blank);
  const [result, setResult] = useState<{ error?: string; notice?: string }>({});
  const [pending, start] = useTransition();
  const set = (patch: Partial<typeof v>) => setV((old) => ({ ...old, ...patch }));

  const to = data.products.find((p) => p.id !== v.fromId);
  const plans = data.plans.filter((p) => p.product_id === to?.id);
  const branches = [...data.branches].sort((a, b) => Number(b.city_id === v.cityId) - Number(a.city_id === v.cityId) || a.name.localeCompare(b.name));

  const submit = () => {
    if (!isValidIndex(v.index)) {
      setResult({ error: t("sales.errors.index") });
      return;
    }
    setResult({});
    start(async () => {
      const r = await submitSwitch({
        client_request_id: v.requestId,
        full_name: v.fullName,
        phone: v.phone,
        index: v.index.trim(),
        from_product_id: v.fromId,
        to_product_id: to?.id ?? "",
        to_plan_id: v.planId,
        city_id: v.cityId || null,
        branch_id: v.branchId,
      });
      if (!r.ok) {
        setResult({ error: r.error });
        return;
      }
      setV(blank());
      setResult({ notice: r.message });
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="brand-title text-base">{t("switches.newTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="sw-name">{t("switches.fullName")}</Label>
            <Input id="sw-name" required minLength={2} maxLength={120} autoComplete="off" value={v.fullName} onChange={(e) => set({ fullName: e.target.value })} className="h-11 md:h-9" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sw-phone">{t("switches.phone")}</Label>
              <Input id="sw-phone" required inputMode="tel" autoComplete="off" value={v.phone} onChange={(e) => set({ phone: e.target.value })} className="h-11 md:h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sw-index">{t("switches.index")}</Label>
              <Input id="sw-index" required inputMode="numeric" maxLength={8} pattern="[0-9]{8}" autoComplete="off" value={v.index} onChange={(e) => set({ index: e.target.value.replace(/\D/g, "") })} className="h-11 tabular-nums md:h-9" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="sw-from">{t("switches.from")}</Label>
              <NativeSelect id="sw-from" value={v.fromId} onChange={(e) => set({ fromId: e.target.value, planId: "" })}>
                {data.products.map((p) => (
                  <option key={p.id} value={p.id}>{p.code}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <span className="text-sm font-semibold">{t("switches.to")}</span>
              <div className="flex h-11 items-center rounded-md border bg-muted px-3 font-semibold">{to?.code ?? "—"}</div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sw-plan">{t("switches.plan")}</Label>
              <NativeSelect id="sw-plan" required value={v.planId} onChange={(e) => set({ planId: e.target.value })}>
                <option value="">{t("switches.choose")}</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sw-city">{t("switches.city")}</Label>
              <NativeSelect id="sw-city" value={v.cityId} disabled={!data.canOverrideCity} onChange={(e) => set({ cityId: e.target.value })}>
                {data.cities.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </NativeSelect>
              {!data.canOverrideCity && !data.myCity ? <p className="text-xs text-destructive">{t("sales.errors.city")}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sw-branch">{t("switches.branch")}</Label>
              <NativeSelect id="sw-branch" required value={v.branchId} onChange={(e) => set({ branchId: e.target.value })}>
                <option value="">{t("switches.choose")}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <FormMessage error={result.error} notice={result.notice} />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending} className="h-11 px-6 md:h-9">{pending ? t("switches.submitting") : t("switches.submit")}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
