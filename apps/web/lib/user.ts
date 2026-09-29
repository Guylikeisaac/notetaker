import { and, canSeeMeeting, db, eq, meetings } from "@notetaker/db";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdminEmail, isAllowedEmail } from "@/lib/access";

export type CurrentUser = { id: string; email: string; isAdmin: boolean };

export async function getUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  const email = session?.user?.email;
  if (!id || !email || !isAllowedEmail(email)) return null;
  return { id, email, isAdmin: isAdminEmail(email) };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getUser();
  if (!user) redirect("/");
  return user;
}

/** The meeting if the user was on its guest list or sent the bot, else null. */
export async function visibleMeeting(user: CurrentUser, meetingId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(meetingId)) return null;
  const [m] = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), canSeeMeeting(user.id, user.email)));
  return m ?? null;
}
