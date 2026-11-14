import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { formatMonthLabel } from "@/lib/dates";
import { t } from "@/lib/i18n";
import type { Option } from "@/server/sales/queries";

/** Month (and, for Team Leaders / Super Admin, agent) selector — a plain GET form, so the URL can be shared. */
export function MonthFilter({ months, month, sellers, agent }: { months: string[]; month: string; sellers?: Option[]; agent?: string }) {
  return (
    <form className="flex flex-wrap items-end gap-3">
      <div className="w-full space-y-1.5 sm:w-48">
        <Label htmlFor="month">{t("sales.month")}</Label>
        <NativeSelect id="month" name="month" defaultValue={month}>
          {months.map((m) => (
            <option key={m} value={m}>{formatMonthLabel(m)}</option>
          ))}
        </NativeSelect>
      </div>
      {sellers ? (
        <div className="w-full space-y-1.5 sm:w-56">
          <Label htmlFor="agent">{t("sales.agent")}</Label>
          <NativeSelect id="agent" name="agent" defaultValue={agent ?? ""}>
            <option value="">{t("sales.allAgents")}</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
      <Button type="submit" variant="outline" className="h-11 md:h-9">{t("stock.show")}</Button>
    </form>
  );
}
