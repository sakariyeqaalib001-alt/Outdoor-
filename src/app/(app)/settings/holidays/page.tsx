import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { listHolidays } from "@/server/settings/queries";
import { SettingsShell } from "../settings-shell";
import { HolidaysView } from "./holidays-view";

export const metadata: Metadata = { title: t("settings.tabHolidays") };

async function Content() {
  return <HolidaysView holidays={await listHolidays()} />;
}

export default function Page() {
  return (
    <SettingsShell>
      <Content />
    </SettingsShell>
  );
}
