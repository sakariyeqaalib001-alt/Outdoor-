import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { listCities, listPlaces } from "@/server/settings/queries";
import { PlacesView } from "../places-view";
import { SettingsShell } from "../settings-shell";

export const metadata: Metadata = { title: t("settings.tabDistricts") };

async function Content() {
  const [places, cities] = await Promise.all([listPlaces("districts"), listCities()]);
  return <PlacesView kind="district" places={places} cities={cities} />;
}

export default function Page() {
  return (
    <SettingsShell>
      <Content />
    </SettingsShell>
  );
}
