"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/** The form reads its draft from this device's storage, so it renders only in the browser. */
export const SaleFormLoader = dynamic(() => import("./sale-form").then((m) => m.SaleForm), {
  ssr: false,
  loading: () => <Skeleton className="mx-auto h-[640px] w-full max-w-2xl" />,
});
