"use server";

import { and, botAccounts, canSeeMeeting, db, eq, inArray, meetings, setAttendees } from "@notetaker/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { requireUser } from "@/lib/user";

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/dashboard" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

/** Admin only: removes the company bot account. Upcoming meetings are skipped. */
export async function disconnectBot() {
  const user = await requireUser();
  if (!user.isAdmin) return;
  await db.delete(botAccounts);
  await db
    .update(meetings)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(meetings.status, "scheduled"));
  revalidatePath("/dashboard");
}

/** Skips an upcoming meeting, or makes a bot that's already in the call leave (notes are still generated). */
export async function stopBot(meetingId: string) {
  const user = await requireUser();
  await db
    .update(meetings)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(meetings.id, meetingId),
        canSeeMeeting(user.id, user.email),
        inArray(meetings.status, ["scheduled", "joining", "waiting_admission", "in_call"]),
      ),
    );
  revalidatePath("/dashboard");
  revalidatePath(`/meetings/${meetingId}`);
}

export async function restoreMeeting(meetingId: string) {
  const user = await requireUser();
  await db
    .update(meetings)
    .set({ status: "scheduled", updatedAt: new Date() })
    .where(and(eq(meetings.id, meetingId), canSeeMeeting(user.id, user.email), eq(meetings.status, "cancelled")));
  revalidatePath("/dashboard");
}

/** Sends the bot into a Meet right now, without a calendar event. */
export async function sendBotNow(formData: FormData) {
  const user = await requireUser();
  const raw = String(formData.get("meetUrl") ?? "");
  const match = raw.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
  if (!match) redirect("/dashboard?bot_error=" + encodeURIComponent("Paste a Google Meet link like https://meet.google.com/abc-defg-hij"));
  const [bot] = await db.select({ id: botAccounts.id }).from(botAccounts).limit(1);
  if (!bot) redirect("/dashboard?bot_error=" + encodeURIComponent("The company bot isn't connected yet. Ask an admin."));

  const now = new Date();
  const [m] = await db
    .insert(meetings)
    .values({
      userId: user.id,
      calendarEventId: `manual-${crypto.randomUUID()}`,
      title: String(formData.get("title") || "").trim() || `Meet ${match[1].toLowerCase()}`,
      meetUrl: `https://meet.google.com/${match[1].toLowerCase()}`,
      startsAt: now,
      endsAt: new Date(now.getTime() + 2 * 60 * 60_000),
    })
    .returning({ id: meetings.id });
  await setAttendees(db, m.id, [user.email]);
  redirect(`/meetings/${m.id}`);
}
