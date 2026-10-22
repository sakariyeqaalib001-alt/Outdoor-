"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { t } from "@/lib/i18n";
import {
  dayLabel,
  formatPrefixes,
  SETTING_GROUPS,
  SETTINGS,
  settingHint,
  settingLabel,
  WEEK_DAYS,
  type SettingKey,
} from "@/lib/settings";
import { saveSetting } from "@/server/settings/actions";

function ValueInput({ settingKey, kind, value }: { settingKey: SettingKey; kind: string; value: unknown }) {
  const id = `setting-${settingKey}`;
  const described = `${id}-hint`;
  switch (kind) {
    case "day":
      return (
        <NativeSelect id={id} name="value" defaultValue={String(value ?? "")} aria-describedby={described}>
          {WEEK_DAYS.map((d) => (
            <option key={d} value={d}>{t(dayLabel(d))}</option>
          ))}
        </NativeSelect>
      );
    case "days":
      return (
        <fieldset className="flex flex-wrap gap-x-4 gap-y-2" aria-describedby={described}>
          <legend className="sr-only">{t(settingLabel(settingKey))}</legend>
          {WEEK_DAYS.map((d) => (
            <label key={d} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="value" value={d} defaultChecked={Array.isArray(value) && value.includes(d)} className="size-4 accent-[#047B95]" />
              {t(dayLabel(d))}
            </label>
          ))}
        </fieldset>
      );
    case "boolean":
      return (
        <label className="flex items-center gap-2 text-sm">
          <input id={id} type="checkbox" name="value" value="true" defaultChecked={value === true} className="size-4 accent-[#047B95]" aria-describedby={described} />
          {t("settings.on")}
        </label>
      );
    case "prefixes":
      return <Input id={id} name="value" defaultValue={formatPrefixes(value)} inputMode="numeric" className="h-11 md:h-9" aria-describedby={described} />;
    default:
      return (
        <Input
          id={id}
          name="value"
          defaultValue={typeof value === "number" ? String(value) : ""}
          inputMode={kind === "amount" ? "decimal" : "numeric"}
          className="h-11 md:h-9 tabular-nums"
          aria-describedby={described}
        />
      );
  }
}

function SettingForm({ settingKey, kind, value }: { settingKey: SettingKey; kind: string; value: unknown }) {
  const [state, action, pending] = useActionState(saveSetting, undefined);
  return (
    <form action={action} className="grid gap-2 border-b py-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-start md:gap-4">
      <input type="hidden" name="key" value={settingKey} />
      <div>
        <Label htmlFor={`setting-${settingKey}`}>{t(settingLabel(settingKey))}</Label>
        <p id={`setting-${settingKey}-hint`} className="mt-1 text-xs text-muted-foreground">{t(settingHint(settingKey))}</p>
      </div>
      <div className="space-y-2">
        <ValueInput settingKey={settingKey} kind={kind} value={value} />
        <FormMessage error={state?.error} notice={state?.ok ? state.message : undefined} />
      </div>
      <Button type="submit" variant="outline" disabled={pending} className="h-11 md:h-9">
        {pending ? t("settings.saving") : t("settings.save")}
      </Button>
    </form>
  );
}

/** Settings → General: each business value is saved on its own and logged (before/after). */
export function GeneralSettings({ values }: { values: Record<string, unknown> }) {
  return (
    <div className="grid gap-4">
      {SETTING_GROUPS.map((group) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle className="brand-title text-lg">{t(`settings.groups.${group}`)}</CardTitle>
          </CardHeader>
          <CardContent>
            {SETTINGS.filter((s) => s.group === group).map((s) => (
              <SettingForm key={s.key} settingKey={s.key} kind={s.kind} value={values[s.key]} />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
