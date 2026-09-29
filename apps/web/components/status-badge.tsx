import type { MeetingStatus } from "@notetaker/db/schema";

const STYLES: Record<MeetingStatus, { label: string; className: string; pulse?: boolean }> = {
  scheduled: { label: "Scheduled", className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  joining: { label: "Joining", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300", pulse: true },
  waiting_admission: {
    label: "Waiting to be admitted",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    pulse: true,
  },
  in_call: { label: "Live", className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300", pulse: true },
  processing: {
    label: "Writing report",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
    pulse: true,
  },
  completed: { label: "Completed", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  failed: { label: "Failed", className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  cancelled: { label: "Skipped", className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" },
};

export function StatusBadge({ status }: { status: MeetingStatus }) {
  const s = STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.className}`}>
      {s.pulse && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {s.label}
    </span>
  );
}
