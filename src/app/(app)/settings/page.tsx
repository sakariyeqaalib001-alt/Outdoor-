import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { listSettings } from "@/server/settings/queries";
import { GeneralSettings } from "./general-settings";
import { SettingsShell } from "./settings-shell";

export const metadata: Metadata = { title: t("nav.settings") };

async function GeneralContent() {
  const rows = await listSettings();
  return <GeneralSettings values={Object.fromEntries(rows.map((r) => [r.key, r.value]))} />;
}

export default function SettingsPage() {
  return (
    <SettingsShell>
      <GeneralContent />
    </SettingsShell>
  );
}
