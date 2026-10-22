"use client";

import { useActionState, useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateOnly } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { deleteHoliday, saveHoliday, type SettingsResult } from "@/server/settings/actions";
import type { HolidayRow } from "@/server/settings/queries";

function HolidayDialog({ holiday, onClose }: { holiday?: HolidayRow; onClose: () => void }) {
  const [state, action, pending] = useActionState(saveHoliday, undefined);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="brand-title text-xl">{t(holiday ? "settings.editHoliday" : "settings.addHoliday")}</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          {holiday ? <input type="hidden" name="id" value={holiday.id} /> : null}
          <div className="space-y-2">
            <Label htmlFor="date">{t("settings.date")}</Label>
            <Input id="date" name="date" type="date" required defaultValue={holiday?.holiday_date} className="h-11 md:h-9" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">{t("settings.name")}</Label>
            <Input id="name" name="name" required minLength={2} maxLength={80} defaultValue={holiday?.name} className="h-11 md:h-9" />
          </div>
          <FormMessage error={state?.error} notice={state?.ok ? state.message : undefined} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t("settings.close")}</Button>
            <Button type="submit" disabled={pending}>{pending ? t("settings.saving") : t("settings.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Settings → Public holidays (FR-LEAVE-07, D-18). */
export function HolidaysView({ holidays }: { holidays: HolidayRow[] }) {
  const [editing, setEditing] = useState<{ holiday?: HolidayRow; key: number } | null>(null);
  const [result, setResult] = useState<SettingsResult>();
  const [pending, startTransition] = useTransition();

  const remove = (h: HolidayRow) => {
    if (!window.confirm(`${t("settings.confirmDelete")}\n${formatDateOnly(h.holiday_date)} — ${h.name}`)) return;
    startTransition(async () => setResult(await deleteHoliday(h.id)));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("settings.holidaysIntro")}</p>
        <Button onClick={() => setEditing({ key: Date.now() })} className="h-11 md:h-9">
          <Plus aria-hidden="true" />
          {t("settings.addHoliday")}
        </Button>
      </div>
      <FormMessage error={result?.error} />
      <div className="overflow-x-auto rounded-xl border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("settings.date")}</TableHead>
              <TableHead>{t("settings.name")}</TableHead>
              <TableHead className="w-24"><span className="sr-only">{t("settings.edit")}</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {holidays.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">{t("settings.noHolidays")}</TableCell>
              </TableRow>
            ) : (
              holidays.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="tabular-nums">{formatDateOnly(h.holiday_date)}</TableCell>
                  <TableCell className="font-semibold">{h.name}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" aria-label={`${t("settings.editHoliday")}: ${h.name}`} onClick={() => setEditing({ holiday: h, key: Date.now() })}>
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button variant="ghost" size="icon" disabled={pending} aria-label={`${t("settings.delete")}: ${h.name}`} onClick={() => remove(h)}>
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {editing ? <HolidayDialog key={editing.key} holiday={editing.holiday} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
