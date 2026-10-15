// Everyone using it is in India. Formatting in a fixed zone also keeps the
// server render (UTC on Vercel) and the browser render identical.
export const TIME_ZONE = process.env.NEXT_PUBLIC_TIME_ZONE ?? "Asia/Kolkata";

export function formatWhen(d: Date): string {
  const s = d.toLocaleString("en-IN", {
    timeZone: TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return TIME_ZONE === "Asia/Kolkata" ? `${s} IST` : s;
}

export function formatOffset(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
