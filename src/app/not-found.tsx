import Link from "next/link";
import { BrandLogo } from "@/components/layout/brand-logo";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-6 text-center">
      <BrandLogo variant="primary" height={56} />
      <h1 className="text-3xl">{t("states.notFoundTitle")}</h1>
      <p className="max-w-md text-muted-foreground">{t("states.notFoundBody")}</p>
      <Button asChild>
        <Link href="/">
          {t("states.backHome")}
        </Link>
      </Button>
    </div>
  );
}
