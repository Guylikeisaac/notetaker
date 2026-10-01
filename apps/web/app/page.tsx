import { redirect } from "next/navigation";
import { getUser } from "@/lib/user";
import { signInWithGoogle } from "./actions";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getUser()) redirect("/dashboard");
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-8 px-6">
      <div className="space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight">Notetaker</h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          Invite a bot to your Google Meet calls. It joins through the normal lobby, transcribes the
          conversation live, and writes the notes and action items for you.
        </p>
      </div>
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error === "not_allowed" || error === "AccessDenied"
            ? "Sign in with your company Google account."
            : "Sign-in failed. Please try again."}
        </p>
      )}
      <form action={signInWithGoogle}>
        <button className="rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
          Sign in with Google
        </button>
      </form>
      <a href="/privacy" className="text-sm text-zinc-500 hover:underline">
        Privacy policy
      </a>
    </main>
  );
}
