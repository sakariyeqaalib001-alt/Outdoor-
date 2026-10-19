import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Official Sogasho logo from the brand kit. Brand rules (brand/README.md):
 * only on white or black, never stretched or recoloured, minimum 30 px high,
 * 1.5x clear space (x = 0.24 × mark height) — enforced here with padding.
 */
type Variant = "primary" | "mark";

const files: Record<Variant, { src: string; ratio: number; alt: string }> = {
  primary: { src: "/brand/logo/so-logo-primary.svg", ratio: 1.599, alt: "SO! so gasho!" },
  mark: { src: "/brand/logo/so-mark.svg", ratio: 2.353, alt: "SO!" },
};

const MIN_HEIGHT = 30;

export function BrandLogo({
  variant = "primary",
  height = 40,
  className,
  priority,
}: {
  variant?: Variant;
  height?: number;
  className?: string;
  priority?: boolean;
}) {
  const file = files[variant];
  const h = Math.max(height, MIN_HEIGHT);
  const clearSpace = Math.round(h * 0.24 * 1.5 * (variant === "primary" ? 0.67 : 1));
  return (
    <span className={cn("inline-flex bg-white", className)} style={{ padding: clearSpace }}>
      <Image
        src={file.src}
        alt={file.alt}
        height={h}
        width={Math.round(h * file.ratio)}
        priority={priority}
        unoptimized
      />
    </span>
  );
}
