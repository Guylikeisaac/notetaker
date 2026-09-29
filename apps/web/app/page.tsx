import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { signInWithGoogle } from "./actions";

export default async function Home() {
  const session = await auth();
  if (session?.user?.id) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-8 px-6">
      <div className="space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight">Notetaker</h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          Invite a bot to your Google Meet calls. It joins through the normal lobby, transcribes the
          conversation live, and writes the notes and action items for you.
        </p>
      </div>
      <form action={signInWithGoogle}>
        <button className="rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
          Sign in with Google
        </button>
      </form>
    </main>
  );
}
