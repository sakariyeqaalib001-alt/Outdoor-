"use client";

import { useActionState, useState } from "react";
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
import type { Lookups, TeamOption, UserRow } from "@/server/users/queries";
import { saveTeam } from "@/server/users/actions";

function TeamDialog({
  team,
  lookups,
  leaders,
  onClose,
}: {
  team?: TeamOption;
  lookups: Lookups;
  leaders: UserRow[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(saveTeam, undefined);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="brand-title text-xl">{t(team ? "users.editTeam" : "users.addTeam")}</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          {team ? <input type="hidden" name="teamId" value={team.id} /> : null}
          <div className="space-y-2">
            <Label htmlFor="name">{t("users.teamName")}</Label>
            <Input id="name" name="name" required defaultValue={team?.name} className="h-11 md:h-9" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cityId">{t("users.city")}</Label>
            <NativeSelect id="cityId" name="cityId" defaultValue={team?.city_id ?? lookups.cities[0]?.id}>
              {lookups.cities.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="leaderId">{t("users.teamLeader")}</Label>
            <NativeSelect id="leaderId" name="leaderId" defaultValue={team?.team_leader_id ?? ""} aria-describedby="leaderHint">
              <option value="">{t("users.noLeader")}</option>
              {leaders.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name}</option>
              ))}
            </NativeSelect>
            <p id="leaderHint" className="text-sm text-muted-foreground">{t("users.leaderHint")}</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" value="true" defaultChecked={team?.is_active ?? true} className="size-4 accent-[#047B95]" />
            {t("users.teamActive")}
          </label>
          <input type="hidden" name="active" value="false" />
          <FormMessage error={state?.error} notice={state?.ok ? state.message : undefined} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t("users.close")}</Button>
            <Button type="submit" disabled={pending}>{pending ? t("users.saving") : t("users.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TeamsView({ lookups, users, canManage }: { lookups: Lookups; users: UserRow[]; canManage: boolean }) {
  const [editing, setEditing] = useState<{ team?: TeamOption; key: number } | null>(null);
  const city = Object.fromEntries(lookups.cities.map((c) => [c.id, c.name]));
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const leaders = users.filter((u) => u.is_active && u.roles.includes("team_leader"));
  const memberCount = (teamId: string) => users.filter((u) => u.team_id === teamId).length;

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={() => setEditing({ key: Date.now() })} className="h-11 md:h-9">
            <Plus aria-hidden="true" />
            {t("users.addTeam")}
          </Button>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("users.teamName")}</TableHead>
              <TableHead>{t("users.city")}</TableHead>
              <TableHead>{t("users.teamLeader")}</TableHead>
              <TableHead>{t("users.members")}</TableHead>
              <TableHead>{t("users.status")}</TableHead>
              {canManage ? <TableHead className="w-12"><span className="sr-only">{t("users.edit")}</span></TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lookups.teams.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">{t("users.noTeams")}</TableCell>
              </TableRow>
            ) : (
              lookups.teams.map((team) => (
                <TableRow key={team.id}>
                  <TableCell className="font-semibold">{team.name}</TableCell>
                  <TableCell>{city[team.city_id]}</TableCell>
                  <TableCell>{team.team_leader_id ? byId[team.team_leader_id]?.full_name ?? "—" : <span className="text-muted-foreground">{t("users.noLeader")}</span>}</TableCell>
                  <TableCell className="tabular-nums">{memberCount(team.id)}</TableCell>
                  <TableCell>
                    <StatusBadge status={team.is_active ? "active" : "reversed"} label={t(team.is_active ? "users.statusActive" : "users.statusInactive")} />
                  </TableCell>
                  {canManage ? (
                    <TableCell>
                      <Button variant="ghost" size="icon" aria-label={`${t("users.editTeam")}: ${team.name}`} onClick={() => setEditing({ team, key: Date.now() })}>
                        <Pencil aria-hidden="true" />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {editing ? (
        <TeamDialog key={editing.key} team={editing.team} lookups={lookups} leaders={leaders} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}
