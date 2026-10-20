"use client";

import { useState, useTransition } from "react";
import { Lock } from "lucide-react";
import { FormMessage } from "@/components/auth/form-message";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { t, type MessageKey } from "@/lib/i18n";
import type { MatrixData } from "@/server/users/queries";
import { setRolePermission } from "@/server/users/actions";

const SCOPES: { value: string; label: MessageKey }[] = [
  { value: "", label: "users.scopeNone" },
  { value: "own", label: "users.scopeOwn" },
  { value: "team", label: "users.scopeTeam" },
  { value: "city", label: "users.scopeCity" },
  { value: "all", label: "users.scopeAll" },
];

/** Permission matrix (SDD §7.2). Editable only with roles.manage; the database enforces it either way. */
export function RoleMatrix({ data, canEdit }: { data: MatrixData; canEdit: boolean }) {
  const [grants, setGrants] = useState(data.grants);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  function change(role: string, permission: string, scope: string) {
    const previous = grants[role]?.[permission];
    setGrants((g) => {
      const next = { ...g, [role]: { ...g[role] } };
      if (scope) next[role][permission] = scope;
      else delete next[role][permission];
      return next;
    });
    startTransition(async () => {
      const res = await setRolePermission(role, permission, scope || null);
      if (res?.error) {
        setError(res.error);
        setGrants((g) => ({ ...g, [role]: { ...g[role], ...(previous ? { [permission]: previous } : {}) } }));
      } else {
        setError(undefined);
      }
    });
  }

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-muted-foreground">{t("users.matrixIntro")}</p>
      <FormMessage error={error} />
      <div className="overflow-x-auto rounded-xl border bg-white" aria-busy={pending}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 min-w-56 bg-white">{t("users.permission")}</TableHead>
              {data.roles.map((r) => (
                <TableHead key={r.key} className="min-w-28 text-center">{r.name}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.permissions.map((p) => (
              <TableRow key={p.key}>
                <TableCell className="sticky left-0 z-10 bg-white">
                  <div className="font-semibold">{p.description}</div>
                  <div className="font-mono text-xs text-muted-foreground">{p.key}</div>
                </TableCell>
                {data.roles.map((r) => {
                  const value = grants[r.key]?.[p.key] ?? "";
                  const locked = r.key === "super_admin";
                  return (
                    <TableCell key={r.key} className="text-center">
                      {locked || !canEdit ? (
                        <span className="inline-flex items-center gap-1 text-sm">
                          {locked ? <Lock className="size-3 text-muted-foreground" aria-label={t("users.locked")} /> : null}
                          {value ? t(SCOPES.find((s) => s.value === value)!.label) : <span className="text-muted-foreground">—</span>}
                        </span>
                      ) : (
                        <select
                          value={value}
                          onChange={(e) => change(r.key, p.key, e.target.value)}
                          aria-label={`${r.name}: ${p.description}`}
                          className="h-8 rounded-md border border-input bg-white px-2 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                        >
                          {SCOPES.map((s) => (
                            <option key={s.value} value={s.value}>{t(s.label)}</option>
                          ))}
                        </select>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
