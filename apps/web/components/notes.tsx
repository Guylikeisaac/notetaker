import type { FinalReport, LiveNotes } from "@notetaker/db/schema";

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function NotesView({ notes }: { notes: LiveNotes | FinalReport }) {
  const report = "topics" in notes ? notes : null;
  return (
    <div className="space-y-6">
      <p className="leading-relaxed">{notes.summary}</p>

      {report && report.topics.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Topics</h3>
          {report.topics.map((t, i) => (
            <div key={i}>
              <p className="font-medium">{t.title}</p>
              <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{t.summary}</p>
            </div>
          ))}
        </section>
      )}

      <Section title="Key points" items={notes.keyPoints} />
      <Section title="Decisions" items={notes.decisions} />

      {notes.actionItems.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Action items</h3>
          <ul className="space-y-1.5 text-sm">
            {notes.actionItems.map((a, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-0.5 size-4 shrink-0 rounded border border-zinc-300 dark:border-zinc-600" />
                <span>
                  {a.owner && <span className="font-medium">{a.owner}: </span>}
                  {a.task}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Section title="Open questions" items={notes.openQuestions} />
      {report && <Section title="Next steps" items={report.nextSteps} />}
    </div>
  );
}
