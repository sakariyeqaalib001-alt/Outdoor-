import { palette } from "@/lib/brand";
import { isTrainingSite } from "@/lib/environment";
import { t } from "@/lib/i18n";

/** "Training site" strip on every page of the training copy (T-24). Brand orange-700 / white passes AA. */
export function EnvironmentBanner() {
  if (!isTrainingSite()) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-2 px-4 py-1.5 text-center text-sm font-semibold"
      style={{ backgroundColor: palette.orange700, color: palette.white }}
    >
      <span>{t("environment.trainingLabel")}</span>
      <span className="font-normal">{t("environment.trainingNote")}</span>
    </div>
  );
}
