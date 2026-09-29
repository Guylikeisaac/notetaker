import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/user";

// Step 2: OAuth consent for the *bot's* Google account (not the user's own).
// Offline access to its calendar lets the worker see the Meet invites it gets.
export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/", req.url));
  if (!user.isAdmin) return NextResponse.redirect(new URL("/dashboard", req.url));

  const state = randomBytes(24).toString("base64url");
  (await cookies()).set("bot_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/api/bot",
  });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: new URL("/api/bot/callback", req.url).toString(),
    response_type: "code",
    scope: "openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly",
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state,
  });
  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
