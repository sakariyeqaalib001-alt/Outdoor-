import { Badge } from "@/components/ui/badge";
import { statusColors, type StatusKey } from "@/lib/brand";
import { t } from "@/lib/i18n";

/** Workflow status badge in brand colours. Always shows a text label — never colour alone. */
export function StatusBadge({ status, label }: { status: StatusKey; label?: string }) {
  const { bg, fg } = statusColors[status];
  return (
    <Badge className="border-transparent" style={{ backgroundColor: bg, color: fg }}>
      {label ?? t(`status.${status}`)}
    </Badge>
  );
}
