"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the server component periodically so meeting statuses stay current. */
export function AutoRefresh({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}
