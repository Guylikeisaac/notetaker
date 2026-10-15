"use client";

import { formatWhen } from "@/lib/format";

/** Renders in the company timezone (India by default; see TIME_ZONE). */
export function LocalTime({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {formatWhen(new Date(iso))}
    </time>
  );
}
