import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { listLists } from "@/server/settings/queries";
import { SettingsShell } from "../settings-shell";
import { ListsView } from "./lists-view";

export const metadata: Metadata = { title: t("settings.tabLists") };

async function Content() {
  const { customerTypes, stockItems } = await listLists();
  return <ListsView customerTypes={customerTypes} stockItems={stockItems} />;
}

export default function Page() {
  return (
    <SettingsShell>
      <Content />
    </SettingsShell>
  );
}
