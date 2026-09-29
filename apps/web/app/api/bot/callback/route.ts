import { botAccounts, db, ne } from "@notetaker/db";
import { encrypt } from "@notetaker/db/crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/user";

function back(req: NextRequest, error?: string) {
  const url = new URL("/dashboard", req.url);
  if (error) url.searchParams.set("bot_error", error);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/", req.url));
  if (!user.isAdmin) return back(req, "Only admins can connect the company bot.");

  const jar = await cookies();
  const expected = jar.get("bot_oauth_state")?.value;
  jar.delete({ name: "bot_oauth_state", path: "/api/bot" });

  const { searchParams } = req.nextUrl;
  if (searchParams.get("error")) return back(req, "Google sign-in was cancelled.");
  const code = searchParams.get("code");
  if (!code || !expected || searchParams.get("state") !== expected) {
    return back(req, "The connection request expired. Please try again.");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: new URL("/api/bot/callback", req.url).toString(),
      grant_type: "authorization_code",
    }),
  });
  const tokens = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; scope?: string };
  if (!tokenRes.ok || !tokens.access_token) return back(req, "Google rejected the connection.");
  if (!tokens.refresh_token) return back(req, "Google did not grant offline access. Please try again.");
  if (!tokens.scope?.includes("calendar.readonly") || !tokens.scope?.includes("gmail.readonly")) {
    return back(req, "Allow both calendar and email access so the bot can see its meeting invites.");
  }

  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const info = (await infoRes.json()) as { email?: string };
  if (!info.email) return back(req, "Could not read the bot account's email address.");

  if (user.email.toLowerCase() === info.email.toLowerCase()) {
    return back(req, "Use a separate Google account for the bot, not the one you signed in with.");
  }

  const refreshTokenEnc = encrypt(tokens.refresh_token);
  // One company-wide bot: replace any other account.
  await db.delete(botAccounts).where(ne(botAccounts.email, info.email));
  await db
    .insert(botAccounts)
    .values({ userId: user.id, email: info.email, refreshTokenEnc })
    .onConflictDoUpdate({
      target: botAccounts.email,
      set: { userId: user.id, refreshTokenEnc, connectedAt: new Date(), lastSyncError: null },
    });

  return back(req);
}
