import { CircleAlert, CircleCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** Error or notice under a form, announced to screen readers. */
export function FormMessage({ error, notice }: { error?: string; notice?: string }) {
  if (error) {
    return (
      <Alert variant="destructive" role="alert">
        <CircleAlert aria-hidden="true" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (notice) {
    return (
      <Alert role="status">
        <CircleCheck aria-hidden="true" className="text-brand-highlight" />
        <AlertDescription className="text-foreground">{notice}</AlertDescription>
      </Alert>
    );
  }
  return null;
}
