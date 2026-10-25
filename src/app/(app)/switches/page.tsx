import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessDenied } from "@/components/access-denied";
import { AppHeader } from "@/components/layout/app-header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBusinessDateTime } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { getSwitchFormData, listSwitches } from "@/server/approvals/queries";
import { can, getAccess } from "@/server/auth/access";
import { SwitchForm } from "./switch-form";

export const metadata: Metadata = { title: t("nav.switches") };

const BADGE = { pending_approval: "pending", approved: "approved", rejected: "rejected" } as const;

async function Switches() {
  const access = await getAccess();
  if (!can(access, "switches.create")) return <AccessDenied />;
  const canCreate = !access.roles.includes("super_admin"); // D-38
  const [data, switches] = await Promise.all([getSwitchFormData(can(access, "sales.override_city")), listSwitches()]);
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <p className="text-sm text-muted-foreground">{t("switches.intro")}</p>
      {canCreate ? <SwitchForm data={data} /> : <p className="rounded-lg border bg-white p-4 text-sm text-muted-foreground">{t("sales.errors.superAdmin")}</p>}
      <Card>
        <CardHeader>
          <CardTitle className="brand-title text-lg">{t("switches.mine")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("switches.when")}</TableHead>
                <TableHead>{t("switches.customer")}</TableHead>
                <TableHead>{t("switches.change")}</TableHead>
                <TableHead>{t("switches.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {switches.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">{t("switches.none")}</TableCell>
                </TableRow>
              ) : (
                switches.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatBusinessDateTime(new Date(s.submitted_at))}</TableCell>
                    <TableCell className="font-semibold">{s.customer_name}</TableCell>
                    <TableCell>{s.change}</TableCell>
                    <TableCell><StatusBadge status={BADGE[s.status]} label={t(`switches.statuses.${s.status}`)} /></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SwitchesPage() {
  return (
    <>
      <AppHeader title={t("switches.title")} />
      <div className="p-4 md:p-6">
        <Suspense fallback={<Skeleton className="mx-auto h-96 w-full max-w-3xl" />}>
          <Switches />
        </Suspense>
      </div>
    </>
  );
}
