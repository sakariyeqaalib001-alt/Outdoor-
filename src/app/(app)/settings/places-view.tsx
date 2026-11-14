"use client";

import { useActionState, useMemo, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { FormMessage } from "@/components/auth/form-message";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { t } from "@/lib/i18n";
import { savePlace } from "@/server/settings/actions";
import type { CityOption, PlaceRow } from "@/server/settings/queries";

type Kind = "branch" | "district";
const TEXT = {
  branch: { add: "settings.addBranch", edit: "settings.editBranch", intro: "settings.branchesIntro", empty: "settings.noBranches" },
  district: { add: "settings.addDistrict", edit: "settings.editDistrict", intro: "settings.districtsIntro", empty: "settings.noDistricts" },
} as const;

function PlaceDialog({ kind, place, cities, cityId, onClose }: { kind: Kind; place?: PlaceRow; cities: CityOption[]; cityId: string; onClose: () => void }) {
  const [state, action, pending] = useActionState(savePlace, undefined);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="brand-title text-lg">{t(place ? TEXT[kind].edit : TEXT[kind].add)}</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="kind" value={kind} />
          {place ? <input type="hidden" name="id" value={place.id} /> : null}
          <div className="space-y-1.5">
            <Label htmlFor="cityId">{t("settings.city")}</Label>
            <NativeSelect id="cityId" name="cityId" defaultValue={place?.city_id ?? cityId}>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="name">{t("settings.name")}</Label>
            <Input id="name" name="name" required minLength={2} maxLength={80} defaultValue={place?.name} className="h-11 md:h-9" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" value="true" defaultChecked={place?.is_active ?? true} className="size-4 accent-[#047B95]" aria-describedby="inactive-hint" />
            {t("settings.isActive")}
          </label>
          <p id="inactive-hint" className="text-xs text-muted-foreground">{t("settings.inactiveHint")}</p>
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

/** Branches (seeded, D-29) and districts (entered by Super Admin, FR-USER-10), grouped by city. */
export function PlacesView({ kind, places, cities }: { kind: Kind; places: PlaceRow[]; cities: CityOption[] }) {
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [editing, setEditing] = useState<{ place?: PlaceRow; key: number } | null>(null);
  const cityName = useMemo(() => Object.fromEntries(cities.map((c) => [c.id, c.name])), [cities]);
  const shown = places
    .filter((p) => cityFilter === "all" || p.city_id === cityFilter)
    .sort((a, b) => (cityName[a.city_id] ?? "").localeCompare(cityName[b.city_id] ?? "") || a.name.localeCompare(b.name));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t(TEXT[kind].intro)}</p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full space-y-1.5 sm:w-56">
          <Label htmlFor="city-filter">{t("settings.city")}</Label>
          <NativeSelect id="city-filter" value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
            <option value="all">{t("settings.allCities")}</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </NativeSelect>
        </div>
        <Button onClick={() => setEditing({ key: Date.now() })} className="h-11 md:h-9">
          <Plus aria-hidden="true" />
          {t(TEXT[kind].add)}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("settings.name")}</TableHead>
              <TableHead>{t("settings.city")}</TableHead>
              <TableHead>{t("settings.status")}</TableHead>
              <TableHead className="w-12"><span className="sr-only">{t("settings.edit")}</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">{t(TEXT[kind].empty)}</TableCell>
              </TableRow>
            ) : (
              shown.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-semibold">{p.name}</TableCell>
                  <TableCell>{cityName[p.city_id]}</TableCell>
                  <TableCell>
                    <StatusBadge status={p.is_active ? "active" : "reversed"} label={t(p.is_active ? "settings.active" : "settings.inactive")} />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" aria-label={`${t(TEXT[kind].edit)}: ${p.name}`} onClick={() => setEditing({ place: p, key: Date.now() })}>
                      <Pencil aria-hidden="true" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {editing ? (
        <PlaceDialog
          key={editing.key}
          kind={kind}
          place={editing.place}
          cities={cities}
          cityId={cityFilter === "all" ? cities[0]?.id ?? "" : cityFilter}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
