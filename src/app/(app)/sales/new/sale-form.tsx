"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { formatMonthLabel } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { formatUSD } from "@/lib/money";
import { amountCollected, freeMonthQualifies, isValidIndex, MONTHS_PAID_MAX, type CustomerType } from "@/lib/sales";
import { submitSale } from "@/server/sales/actions";
import type { SaleFormData } from "@/server/sales/queries";

const DRAFT_KEY = "sogasho.outdoor.saleDraft.v1";

type Values = {
  customerType: CustomerType;
  fullName: string;
  phone: string;
  index: string;
  cityId: string;
  districtId: string;
  area: string;
  branchId: string;
  productId: string;
  planId: string;
  monthsPaid: number;
  freeMonth: boolean;
};
type Draft = { requestId: string; startedMonth: string; values: Values };

function newDraft(data: SaleFormData, currentMonth: string): Draft {
  const cityId = data.myCity ?? data.cities[0]?.id ?? "";
  return {
    requestId: crypto.randomUUID(),
    startedMonth: currentMonth,
    values: {
      customerType: "new",
      fullName: "",
      phone: "",
      index: "",
      cityId,
      districtId: "",
      area: "",
      branchId: data.branches.find((b) => b.city_id === cityId)?.id ?? "",
      productId: "",
      planId: "",
      monthsPaid: 1,
      freeMonth: false,
    },
  };
}

function loadDraft(data: SaleFormData, currentMonth: string): Draft {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const draft = JSON.parse(raw) as Draft;
      if (draft?.requestId && draft.values) return draft;
    }
  } catch {
    // Storage unavailable (private mode): start a fresh form.
  }
  return newDraft(data, currentMonth);
}

/**
 * Sales form (FR-SALE-01…22, FR-FREE-01…04). No date field (D-30). No equipment: the Supervisor records it at
 * approval (D-37). The draft — with its request id, so a
 * retry never creates a second sale (FR-SALE-15) — is kept on this device until the sale is saved.
 */
export function SaleForm({ data, currentMonth }: { data: SaleFormData; currentMonth: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => loadDraft(data, currentMonth));
  const [result, setResult] = useState<{ error?: string; notice?: string }>({});
  const [pending, startTransition] = useTransition();
  const v = draft.values;

  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Not saved on this device; the form still works.
    }
  }, [draft]);

  const set = (patch: Partial<Values>) => setDraft((d) => ({ ...d, values: { ...d.values, ...patch } }));

  const products = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of data.plans) seen.set(p.product_id, p.product_code);
    return [...seen].map(([id, code]) => ({ id, code }));
  }, [data.plans]);
  const plans = data.plans.filter((p) => p.product_id === v.productId);
  const plan = data.plans.find((p) => p.id === v.planId);
  const districts = data.districts.filter((d) => d.city_id === v.cityId);
  const branches = [...data.branches].sort((a, b) => Number(b.city_id === v.cityId) - Number(a.city_id === v.cityId) || a.name.localeCompare(b.name));
  const freeOk = plan ? freeMonthQualifies(plan.recharge, data.freeMonthAmount) : false;
  const freeMonth = v.freeMonth && freeOk;
  const months = freeMonth ? 2 : v.monthsPaid;
  const total = plan ? amountCollected(plan.recharge, plan.installation, months, freeMonth) : null;

  const reset = () => {
    const fresh = newDraft(data, currentMonth);
    setDraft(fresh);
    setResult({});
  };

  const submit = () => {
    if (!isValidIndex(v.index)) {
      setResult({ error: t("sales.errors.index") });
      return;
    }
    setResult({});
    startTransition(async () => {
      const r = await submitSale({
        client_request_id: draft.requestId,
        customer_type: v.customerType,
        full_name: v.fullName,
        phone: v.phone,
        index: v.index.trim(),
        city_id: v.cityId || null,
        district_id: v.districtId,
        area: v.area,
        branch_id: v.branchId,
        plan_id: v.planId,
        months_paid: months,
        free_month: freeMonth,
      });
      if (!r.ok) {
        setResult({ error: r.error });
        return;
      }
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore
      }
      setDraft(newDraft(data, currentMonth));
      const note = r.existing ? "existing" : "pending";
      router.push(`/sales/${r.saleId}?saved=${note}`);
    });
  };

  return (
    <form
      className="mx-auto grid w-full max-w-2xl gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="text-sm text-muted-foreground">{t("sales.formIntro")}</p>
      {draft.startedMonth !== currentMonth ? (
        <FormMessage error={t("sales.monthWarning", { started: formatMonthLabel(draft.startedMonth), current: formatMonthLabel(currentMonth) })} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="brand-title text-lg">{t("sales.customerSection")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold">{t("sales.customerType")}</legend>
            {(["new", "retention"] as const).map((type) => (
              <label key={type} className="flex items-start gap-2 text-sm">
                <input type="radio" name="customerType" value={type} checked={v.customerType === type} onChange={() => set({ customerType: type })} className="mt-0.5 size-5 accent-[#047B95]" />
                <span>
                  <span className="font-semibold">{t(`sales.types.${type}`)}</span>
                  <span className="block text-xs text-muted-foreground">{t(type === "new" ? "sales.newHint" : "sales.retentionHint")}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="space-y-1">
            <Label htmlFor="fullName">{t("sales.fullName")}</Label>
            <Input id="fullName" required minLength={2} maxLength={120} autoComplete="off" value={v.fullName} onChange={(e) => set({ fullName: e.target.value })} className="h-11" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="phone">{t("sales.phone")}</Label>
              <Input id="phone" required inputMode="tel" autoComplete="off" value={v.phone} onChange={(e) => set({ phone: e.target.value })} className="h-11" aria-describedby="phone-hint" />
              <p id="phone-hint" className="text-xs text-muted-foreground">{t("sales.phoneHint")}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="index">{t("sales.index")}</Label>
              <Input id="index" required inputMode="numeric" maxLength={8} pattern="[0-9]{8}" autoComplete="off" value={v.index} onChange={(e) => set({ index: e.target.value.replace(/\D/g, "") })} className="h-11 tabular-nums" aria-describedby="index-hint" />
              <p id="index-hint" className="text-xs text-muted-foreground">{t("sales.indexHint")}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="brand-title text-lg">{t("sales.saleSection")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cityId">{t("sales.city")}</Label>
              <NativeSelect
                id="cityId"
                value={v.cityId}
                disabled={!data.canOverrideCity}
                onChange={(e) => set({ cityId: e.target.value, districtId: "", branchId: data.branches.find((b) => b.city_id === e.target.value)?.id ?? v.branchId })}
                aria-describedby={data.canOverrideCity ? undefined : "city-hint"}
              >
                {data.cities.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </NativeSelect>
              {!data.canOverrideCity ? <p id="city-hint" className="text-xs text-muted-foreground">{t("sales.cityLocked")}</p> : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="districtId">{t("sales.district")}</Label>
              <NativeSelect id="districtId" required value={v.districtId} onChange={(e) => set({ districtId: e.target.value })}>
                <option value="">{t("sales.choose")}</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </NativeSelect>
              {districts.length === 0 ? <p className="text-xs text-destructive">{t("sales.noDistricts")}</p> : null}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="area">{t("sales.area")}</Label>
            <Input id="area" required maxLength={100} value={v.area} onChange={(e) => set({ area: e.target.value })} className="h-11" placeholder={t("sales.areaHint")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="branchId">{t("sales.branch")}</Label>
            <NativeSelect id="branchId" required value={v.branchId} onChange={(e) => set({ branchId: e.target.value })} aria-describedby="branch-hint">
              <option value="">{t("sales.choose")}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </NativeSelect>
            <p id="branch-hint" className="text-xs text-muted-foreground">{t("sales.branchHint")}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="productId">{t("sales.productLabel")}</Label>
              <NativeSelect id="productId" required value={v.productId} onChange={(e) => set({ productId: e.target.value, planId: "" })}>
                <option value="">{t("sales.choose")}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.code}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="planId">{t("sales.planLabel")}</Label>
              <NativeSelect id="planId" required value={v.planId} disabled={!v.productId} onChange={(e) => set({ planId: e.target.value })}>
                <option value="">{t("sales.choose")}</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{`${p.name} — ${formatUSD(p.recharge)}`}</option>
                ))}
              </NativeSelect>
              {plan ? (
                <p className="text-xs text-muted-foreground">
                  {t("sales.priceLine", { recharge: formatUSD(plan.recharge), installation: formatUSD(plan.installation) })} · {plan.download_mbps}/{plan.upload_mbps} Mbps
                </p>
              ) : null}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="monthsPaid">{t("sales.monthsPaid")}</Label>
              <NativeSelect id="monthsPaid" value={String(months)} disabled={freeMonth} onChange={(e) => set({ monthsPaid: Number(e.target.value) })}>
                {Array.from({ length: MONTHS_PAID_MAX }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <span className="text-sm font-semibold">&nbsp;</span>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={freeMonth} disabled={!freeOk} onChange={(e) => set({ freeMonth: e.target.checked })} className="size-5 accent-[#047B95]" />
                {t("sales.freeMonthOption")}
              </label>
              {plan && !freeOk ? (
                <p className="text-xs text-muted-foreground">{t("sales.freeMonthNotQualified", { amount: formatUSD(data.freeMonthAmount) })}</p>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div>
            <div className="text-sm text-muted-foreground">{t("sales.total")}</div>
            <div className="text-2xl font-semibold tabular-nums">{total === null ? "—" : formatUSD(total)}</div>
            {plan ? (
              <div className="text-xs text-muted-foreground">
                {t("sales.totalHint", { recharge: formatUSD(plan.recharge), months, installation: formatUSD(plan.installation) })}
              </div>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={reset} disabled={pending} className="h-11">{t("sales.clearDraft")}</Button>
            <Button type="submit" disabled={pending} className="h-11 px-6">{pending ? t("sales.submitting") : t("sales.submit")}</Button>
          </div>
        </CardContent>
      </Card>

      <FormMessage error={result.error} notice={result.notice} />
      <p className="text-center text-xs text-muted-foreground">{t("sales.draftSaved")}</p>
    </form>
  );
}
