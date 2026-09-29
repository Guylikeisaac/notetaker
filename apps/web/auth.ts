import { db, users } from "@notetaker/db";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowedEmail } from "@/lib/access";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/" },
  callbacks: {
    // Only company accounts (see ALLOWED_EMAIL_DOMAINS / ALLOWED_EMAILS) may sign in.
    signIn({ profile }) {
      if (!profile?.email || profile.email_verified === false) return false;
      return isAllowedEmail(profile.email) ? true : "/?error=not_allowed";
    },
    async jwt({ token, profile }) {
      // Only present on the sign-in request itself.
      if (profile?.email) {
        const [user] = await db
          .insert(users)
          .values({ email: profile.email, name: profile.name ?? null, image: (profile.picture as string) ?? null })
          .onConflictDoUpdate({
            target: users.email,
            set: { name: profile.name ?? null, image: (profile.picture as string) ?? null },
          })
          .returning({ id: users.id });
        token.uid = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.uid === "string") session.user.id = token.uid;
      return session;
    },
  },
});
