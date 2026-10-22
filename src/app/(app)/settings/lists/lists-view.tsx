"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";
import { renameCustomerType, saveStockItem } from "@/server/settings/actions";
import type { CustomerTypeRow, StockItemRow } from "@/server/settings/queries";

function CustomerTypeForm({ row }: { row: CustomerTypeRow }) {
  const [state, action, pending] = useActionState(renameCustomerType, undefined);
  const id = `type-${row.code}`;
  return (
    <form action={action} className="grid gap-2 border-b py-3 last:border-b-0 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-end sm:gap-4">
      <input type="hidden" name="code" value={row.code} />
      <div>
        <span className="text-xs text-muted-foreground">{t("settings.code")}</span>
        <div className="font-mono text-sm">{row.code}</div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={id}>{t("settings.name")}</Label>
        <Input id={id} name="name" required minLength={2} maxLength={40} defaultValue={row.name} className="h-11 md:h-9" />
        <FormMessage error={state?.error} notice={state?.ok ? state.message : undefined} />
      </div>
      <Button type="submit" variant="outline" disabled={pending} className="h-11 md:h-9">
        {pending ? t("settings.saving") : t("settings.save")}
      </Button>
    </form>
  );
}

function StockItemForm({ row }: { row: StockItemRow }) {
  const [state, action, pending] = useActionState(saveStockItem, undefined);
  const id = `item-${row.code}`;
  return (
    <form action={action} className="grid gap-2 border-b py-3 last:border-b-0 sm:grid-cols-[8rem_minmax(0,1fr)_auto_auto] sm:items-end sm:gap-4">
      <input type="hidden" name="id" value={row.id} />
      <div>
        <span className="text-xs text-muted-foreground">{t("settings.code")}</span>
        <div className="font-mono text-sm">{row.code}</div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={id}>{t("settings.displayName")}</Label>
        <Input id={id} name="name" required minLength={2} maxLength={60} defaultValue={row.display_name} className="h-11 md:h-9" />
        <FormMessage error={state?.error} notice={state?.ok ? state.message : undefined} />
      </div>
      <label className="flex h-11 items-center gap-2 text-sm md:h-9">
        <input type="checkbox" name="active" value="true" defaultChecked={row.is_active} className="size-4 accent-[#047B95]" />
        {t("settings.active")}
      </label>
      <Button type="submit" variant="outline" disabled={pending} className="h-11 md:h-9">
        {pending ? t("settings.saving") : t("settings.save")}
      </Button>
    </form>
  );
}

/** Settings → Lists: customer types (FR-USER-04) and stock items (SDD §9). Codes are fixed. */
export function ListsView({ customerTypes, stockItems }: { customerTypes: CustomerTypeRow[]; stockItems: StockItemRow[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="brand-title text-lg">{t("settings.customerTypes")}</CardTitle>
          <CardDescription>{t("settings.customerTypesIntro")}</CardDescription>
        </CardHeader>
        <CardContent>
          {customerTypes.map((row) => (
            <CustomerTypeForm key={row.code} row={row} />
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="brand-title text-lg">{t("settings.stockItems")}</CardTitle>
          <CardDescription>{t("settings.stockItemsIntro")}</CardDescription>
        </CardHeader>
        <CardContent>
          {stockItems.map((row) => (
            <StockItemForm key={row.id} row={row} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
