"use client";

import { useActionState, useMemo, useState } from "react";
import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { t } from "@/lib/i18n";
import type { Lookups, UserRow } from "@/server/users/queries";
import { createUser, updateUser } from "@/server/users/actions";
import { PasswordReveal } from "./password-reveal";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lookups: Lookups;
  user?: UserRow; // edit when set, create otherwise
};

export function UserDialog({ open, onOpenChange, lookups, user }: Props) {
  const editing = Boolean(user);
  const [state, action, pending] = useActionState(editing ? updateUser : createUser, undefined);
  const [type, setType] = useState<"temporary" | "permanent">(user?.employment_type ?? "temporary");
  const [cityId, setCityId] = useState(user?.city_id ?? lookups.cities[0]?.id ?? "");
  const [name, setName] = useState(user?.full_name ?? "");
  const teams = useMemo(() => lookups.teams.filter((tm) => tm.city_id === cityId && tm.is_active), [lookups.teams, cityId]);
  const defaultRoles = user?.roles ?? ["agent"];

  const created = !editing && state?.password;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="brand-title text-xl">{t(editing ? "users.editUser" : "users.addUser")}</DialogTitle>
          {editing ? <DialogDescription>{user?.email ?? user?.login_phone_e164}</DialogDescription> : null}
        </DialogHeader>

        {created ? (
          <div className="space-y-4">
            <FormMessage notice={state?.ok ? state.message : undefined} error={state?.error} />
            <PasswordReveal password={state.password!} name={name} />
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{t("users.close")}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form action={action} className="space-y-4">
            {user ? <input type="hidden" name="userId" value={user.id} /> : null}

            {!editing ? (
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold">{t("users.employmentType")}</legend>
                {(["temporary", "permanent"] as const).map((value) => (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="employmentType"
                      value={value}
                      checked={type === value}
                      onChange={() => setType(value)}
                      className="size-4 accent-[#047B95]"
                    />
                    {t(value === "temporary" ? "users.temporaryAgent" : "users.permanentStaff")}
                  </label>
                ))}
              </fieldset>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="fullName">{t("users.fullName")}</Label>
              <Input id="fullName" name="fullName" required value={name} onChange={(e) => setName(e.target.value)} className="h-11 md:h-9" />
            </div>

            {!editing && type === "permanent" ? (
              <div className="space-y-2">
                <Label htmlFor="email">{t("users.email")}</Label>
                <Input id="email" name="email" type="email" required autoComplete="off" className="h-11 md:h-9" />
              </div>
            ) : null}
            {!editing && type === "temporary" ? (
              <div className="space-y-2">
                <Label htmlFor="phone">{t("users.phone")}</Label>
                <Input id="phone" name="phone" inputMode="tel" required autoComplete="off" className="h-11 md:h-9" aria-describedby="phone-hint" />
                <p id="phone-hint" className="text-xs text-muted-foreground">{t("users.phoneHint")}</p>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cityId">{t("users.city")}</Label>
                <NativeSelect id="cityId" name="cityId" value={cityId} onChange={(e) => setCityId(e.target.value)} required>
                  {lookups.cities.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="teamId">{t("users.team")}</Label>
                <NativeSelect id="teamId" name="teamId" defaultValue={user?.team_id ?? ""} key={`team-${cityId}`}>
                  <option value="">{t("users.noTeam")}</option>
                  {teams.map((tm) => (
                    <option key={tm.id} value={tm.id}>{tm.name}</option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="startDate">{t("users.startDate")}</Label>
                <Input id="startDate" name="startDate" type="date" defaultValue={user?.start_date ?? ""} className="h-11 md:h-9" />
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">{t("users.roles")}</legend>
              <p className="text-xs text-muted-foreground">{t("users.rolesHint")}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {lookups.roles.map((role) => (
                  <label key={role.key} className="flex items-start gap-2 text-sm">
                    <Checkbox name="roles" value={role.key} defaultChecked={defaultRoles.includes(role.key)} className="mt-0.5" />
                    <span>{role.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <FormMessage error={state?.error} notice={state?.ok ? state.message : undefined} />
            {state?.password ? <PasswordReveal password={state.password} name={name} /> : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("users.cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t("users.saving") : t(editing ? "users.save" : "users.create")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
