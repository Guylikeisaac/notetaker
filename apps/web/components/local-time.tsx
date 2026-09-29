"use client";

import { formatWhen } from "@/lib/format";

/** Renders in the viewer's timezone; the server render is replaced on hydration. */
export function LocalTime({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {formatWhen(new Date(iso))}
    </time>
  );
}
