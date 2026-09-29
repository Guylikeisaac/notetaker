import { and, db, eq, meetings } from "@notetaker/db";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export async function requireUserId(): Promise<string> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect("/");
  return id;
}

/** The meeting if it belongs to the user, else null. */
export async function ownedMeeting(userId: string, meetingId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(meetingId)) return null;
  const [m] = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.userId, userId)));
  return m ?? null;
}
