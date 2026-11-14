"use client";

import { useMemo, useState, useTransition } from "react";
import { MoreHorizontal, Plus, Search } from "lucide-react";
import { FormMessage } from "@/components/auth/form-message";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBusinessDate } from "@/lib/dates";
import { t } from "@/lib/i18n";
import type { Lookups, UserRow } from "@/server/users/queries";
import { resetPassword, setUserActive, type AdminResult } from "@/server/users/actions";
import { PasswordReveal } from "./password-reveal";
import { UserDialog } from "./user-dialog";

type Confirm = { kind: "deactivate" | "reactivate" | "reset"; user: UserRow } | null;

export function UsersTable({
  users,
  lookups,
  canManage,
  canDisable,
}: {
  users: UserRow[];
  lookups: Lookups;
  canManage: boolean;
  canDisable: boolean;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [dialog, setDialog] = useState<{ user?: UserRow; key: number } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [result, setResult] = useState<(AdminResult & { name?: string }) | null>(null);
  const [pending, startTransition] = useTransition();

  const names = useMemo(() => {
    const role = Object.fromEntries(lookups.roles.map((r) => [r.key, r.name]));
    const city = Object.fromEntries(lookups.cities.map((c) => [c.id, c.name]));
    const team = Object.fromEntries(lookups.teams.map((tm) => [tm.id, tm.name]));
    return { role, city, team };
  }, [lookups]);

  const shown = users.filter((u) => {
    if (status === "active" && !u.is_active) return false;
    if (status === "inactive" && u.is_active) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [u.full_name, u.email ?? "", u.login_phone_e164 ?? ""].some((v) => v.toLowerCase().includes(q.replace(/\s/g, "")) || v.toLowerCase().includes(q));
  });

  function runConfirm() {
    if (!confirm) return;
    const { kind, user } = confirm;
    startTransition(async () => {
      const res = kind === "reset" ? await resetPassword(user.id) : await setUserActive(user.id, kind === "reactivate");
      setResult({ ...res, name: user.full_name });
      setConfirm(null);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("users.search")}
            aria-label={t("users.search")}
            className="h-11 bg-white pl-9 md:h-9"
          />
        </div>
        <div className="w-full sm:w-40">
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label={t("users.status")}>
            <option value="all">{t("users.statusAll")}</option>
            <option value="active">{t("users.statusActive")}</option>
            <option value="inactive">{t("users.statusInactive")}</option>
          </NativeSelect>
        </div>
        {canManage ? (
          <Button onClick={() => setDialog({ key: Date.now() })} className="h-11 md:h-9">
            <Plus aria-hidden="true" />
            {t("users.addUser")}
          </Button>
        ) : null}
      </div>

      {result ? (
        <div className="space-y-3">
          <FormMessage error={result.error} notice={result.ok ? result.message : undefined} />
          {result.password ? <PasswordReveal password={result.password} name={result.name ?? ""} /> : null}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("users.name")}</TableHead>
              <TableHead>{t("users.signIn")}</TableHead>
              <TableHead>{t("users.roles")}</TableHead>
              <TableHead>{t("users.team")}</TableHead>
              <TableHead>{t("users.city")}</TableHead>
              <TableHead>{t("users.status")}</TableHead>
              {canManage || canDisable ? <TableHead className="w-12"><span className="sr-only">{t("users.actions")}</span></TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">{t("users.noUsers")}</TableCell>
              </TableRow>
            ) : (
              shown.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-semibold">{u.full_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t(u.employment_type === "temporary" ? "user.temporary" : "user.permanent")} · {formatBusinessDate(new Date(`${u.start_date}T12:00:00Z`))}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    <div>{u.employment_type === "temporary" ? u.login_phone_e164 : u.email}</div>
                    {u.employment_type === "permanent" ? (
                      <div className="text-xs text-muted-foreground">{u.login_phone_e164 ?? t("users.noMobile")}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.length === 0 ? <span className="text-muted-foreground">—</span> : null}
                      {u.roles.map((r) => (
                        <Badge key={r} variant="secondary">{names.role[r] ?? r}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{u.team_id ? names.team[u.team_id] : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    {u.city_id ? names.city[u.city_id] : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={u.is_active ? "active" : "reversed"} label={t(u.is_active ? "users.statusActive" : "users.statusInactive")} />
                      {u.is_active && u.must_change_password ? (
                        <span className="text-xs text-muted-foreground">{t("users.mustChangePassword")}</span>
                      ) : null}
                    </div>
                  </TableCell>
                  {canManage || canDisable ? (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`${t("users.actions")}: ${u.full_name}`}>
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canManage ? (
                            <DropdownMenuItem onSelect={() => setDialog({ user: u, key: Date.now() })}>{t("users.edit")}</DropdownMenuItem>
                          ) : null}
                          {canManage && u.is_active ? (
                            <DropdownMenuItem onSelect={() => setConfirm({ kind: "reset", user: u })}>{t("users.resetPassword")}</DropdownMenuItem>
                          ) : null}
                          {canDisable ? (
                            <DropdownMenuItem
                              onSelect={() => setConfirm({ kind: u.is_active ? "deactivate" : "reactivate", user: u })}
                              className={u.is_active ? "text-[#B81F3A] focus:text-[#B81F3A]" : undefined}
                            >
                              {t(u.is_active ? "users.deactivate" : "users.reactivate")}
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {dialog ? (
        <UserDialog
          key={dialog.key}
          open
          onOpenChange={(open) => !open && setDialog(null)}
          lookups={lookups}
          user={dialog.user}
        />
      ) : null}

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="brand-title text-lg">
              {confirm ? t(confirm.kind === "reset" ? "users.resetPassword" : confirm.kind === "deactivate" ? "users.deactivate" : "users.reactivate") : ""}
            </DialogTitle>
            <DialogDescription>
              {confirm
                ? t(confirm.kind === "reset" ? "users.confirmReset" : confirm.kind === "deactivate" ? "users.confirmDeactivate" : "users.confirmReactivate", {
                    name: confirm.user.full_name,
                  })
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>{t("users.cancel")}</Button>
            <Button variant={confirm?.kind === "deactivate" ? "destructive" : "default"} onClick={runConfirm} disabled={pending}>
              {pending ? t("users.saving") : t("users.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
