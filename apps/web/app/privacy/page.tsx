import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy policy · Notetaker" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-12 leading-relaxed">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Notetaker
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">Privacy policy</h1>
      <p className="text-sm text-zinc-500">Last updated: October 1, 2026</p>

      <p>
        Notetaker is an internal tool operated by SyncUp for its own team. It joins Google Meet calls it is
        invited to, transcribes them, and writes meeting notes.
      </p>

      <h2 className="text-xl font-semibold">What we collect</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <b>Your Google account name and email</b>, when you sign in, to identify you and show you your meetings.
        </li>
        <li>
          <b>Meeting audio, transcripts and AI-generated notes</b>, for calls where the Notetaker bot was invited.
        </li>
        <li>
          <b>Calendar events and Meet invitation emails of the bot account only</b> (not your own calendar or
          email), so the bot knows which meetings to join and who invited it.
        </li>
      </ul>

      <h2 className="text-xl font-semibold">How it is used</h2>
      <p>
        Meeting audio is sent to AssemblyAI for transcription, and transcripts are sent to Google Gemini to produce
        notes. Audio is not stored. Transcripts and notes are stored in our database and are visible only to the
        person who invited the bot to that meeting. We do not sell or share this data for advertising.
      </p>

      <h2 className="text-xl font-semibold">Google user data</h2>
      <p>
        Notetaker&apos;s use of information received from Google APIs adheres to the Google API Services User Data
        Policy, including the Limited Use requirements.
      </p>

      <h2 className="text-xl font-semibold">Deletion and contact</h2>
      <p>
        To have your meetings or account data deleted, or for any question, email{" "}
        <a className="underline" href="mailto:kushagra@syncup.in">
          kushagra@syncup.in
        </a>
        .
      </p>
    </main>
  );
}
