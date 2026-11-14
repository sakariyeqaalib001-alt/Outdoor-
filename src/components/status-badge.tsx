import { Badge } from "@/components/ui/badge";
import { statusColors, type StatusKey } from "@/lib/brand";
import { t } from "@/lib/i18n";

/** Workflow status badge: a brand-colour dot beside the text label — never colour alone. */
export function StatusBadge({ status, label }: { status: StatusKey; label?: string }) {
  const { bg } = statusColors[status];
  return (
    <Badge variant="outline" className="gap-1.5 bg-white text-foreground">
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: bg }} />
      {label ?? t(`status.${status}`)}
    </Badge>
  );
}
