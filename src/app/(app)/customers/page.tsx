import type { Metadata } from "next";
import { Suspense } from "react";
import { Search } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { AppHeader } from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBusinessDate } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { can, getAccess } from "@/server/auth/access";
import { listCustomers } from "@/server/sales/queries";
import { IdentityDialog } from "./identity-dialog";

export const metadata: Metadata = { title: t("nav.customers") };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Customers within the caller's customers.read scope; Super Admin can change phone / Index (FR-SALE-16). */
async function Customers({ searchParams }: { searchParams: SearchParams }) {
  const access = await getAccess();
  if (!can(access, "customers.read")) return <AccessDenied />;
  const q = (await searchParams).q;
  const term = typeof q === "string" ? q.slice(0, 60) : "";
  const customers = await listCustomers(term);
  const canChange = can(access, "customers.change_identity");

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t("customers.intro")}</p>
      <form className="flex gap-2">
        <label htmlFor="q" className="sr-only">{t("customers.search")}</label>
        <Input id="q" name="q" defaultValue={term} placeholder={t("customers.search")} className="h-11 md:h-9" />
        <Button type="submit" variant="outline" className="h-11 md:h-9" aria-label={t("customers.search")}><Search aria-hidden="true" /></Button>
      </form>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("customers.name")}</TableHead>
              <TableHead>{t("customers.phone")}</TableHead>
              <TableHead>{t("customers.index")}</TableHead>
              <TableHead>{t("customers.city")}</TableHead>
              <TableHead className="text-right">{t("customers.sales")}</TableHead>
              <TableHead>{t("customers.since")}</TableHead>
              {canChange ? <TableHead className="w-44"><span className="sr-only">{t("customers.change")}</span></TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canChange ? 7 : 6} className="py-10 text-center text-muted-foreground">{t("customers.none")}</TableCell>
              </TableRow>
            ) : (
              customers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-semibold">{c.full_name}</TableCell>
                  <TableCell className="font-mono text-sm">{c.phone ?? "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{c.index ?? "—"}</TableCell>
                  <TableCell>{c.city}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.sales}</TableCell>
                  <TableCell className="tabular-nums">{formatBusinessDate(new Date(c.created_at))}</TableCell>
                  {canChange ? <TableCell><IdentityDialog customerId={c.id} name={c.full_name} /></TableCell> : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <AppHeader title={t("customers.title")} />
      <div className="p-4 md:p-6">
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <Customers searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
