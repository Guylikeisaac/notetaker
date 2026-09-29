import type { FinalReport, LiveNotes, TranscriptSegment } from "@notetaker/db";
import { config } from "./config";

// Google Gemini API (free tier). Structured output via responseSchema, which
// uses Gemini's OpenAPI subset: `nullable` instead of union types.
type Schema = Record<string, unknown>;

const stringList: Schema = { type: "array", items: { type: "string" } };

const notesProperties: Record<string, Schema> = {
  summary: { type: "string", description: "2-4 sentence summary of the meeting so far." },
  keyPoints: { ...stringList, description: "Important points discussed, most important first." },
  decisions: { ...stringList, description: "Decisions explicitly agreed on. Empty if none." },
  actionItems: {
    type: "array",
    items: {
      type: "object",
      properties: {
        owner: { type: "string", nullable: true, description: "Who owns it, as named or labeled in the transcript." },
        task: { type: "string" },
      },
      required: ["owner", "task"],
    },
  },
  openQuestions: { ...stringList, description: "Questions raised but not resolved." },
};

const notesSchema: Schema = {
  type: "object",
  properties: notesProperties,
  required: ["summary", "keyPoints", "decisions", "actionItems", "openQuestions"],
};

const reportSchema: Schema = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short descriptive title for the meeting." },
    ...notesProperties,
    summary: { type: "string", description: "One-paragraph executive summary of the whole meeting." },
    topics: {
      type: "array",
      description: "The meeting's main topics in the order they were discussed.",
      items: {
        type: "object",
        properties: { title: { type: "string" }, summary: { type: "string" } },
        required: ["title", "summary"],
      },
    },
    nextSteps: stringList,
  },
  required: ["title", "summary", "keyPoints", "decisions", "actionItems", "openQuestions", "topics", "nextSteps"],
};

const SYSTEM = `You take notes for a Google Meet call from its automatic transcript.
Speakers are labeled "Speaker 1", "Speaker 2"... by diarization; use a real name instead only when the transcript makes it clear who is speaking.
The transcript is machine-generated and may contain recognition errors; infer the intended meaning, but never invent facts, decisions or owners that are not supported by the transcript.
Be concise and specific. Write in the language the meeting is held in.`;

function formatTranscript(segments: TranscriptSegment[], maxChars: number): string {
  const lines = segments.map((s) => {
    const t = Math.floor(s.startMs / 1000);
    const ts = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
    return `[${ts}] ${s.speaker}: ${s.text}`;
  });
  let text = lines.join("\n");
  if (text.length > maxChars) text = "[…earlier transcript omitted…]\n" + text.slice(-maxChars);
  return text;
}

async function generateJson<T>(model: string, schema: Schema, prompt: string): Promise<T> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": config.geminiApiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.2 },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${model} failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!text) throw new Error(`gemini ${model} returned no content (${body.candidates?.[0]?.finishReason})`);
  return JSON.parse(text) as T;
}

export function generateLiveNotes(
  title: string,
  segments: TranscriptSegment[],
  previous: LiveNotes | null,
): Promise<LiveNotes> {
  const prompt = [
    `Meeting: ${title}`,
    previous ? `Your previous notes (update them; keep what is still accurate):\n${JSON.stringify(previous)}` : "",
    `Transcript so far:\n${formatTranscript(segments, 120_000)}`,
    "The meeting is still in progress. Return the updated notes.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return generateJson<LiveNotes>(config.liveNotesModel, notesSchema, prompt);
}

export function generateFinalReport(title: string, segments: TranscriptSegment[]): Promise<FinalReport> {
  const prompt = [
    `Meeting: ${title}`,
    `Full transcript:\n${formatTranscript(segments, 500_000)}`,
    "The meeting has ended. Return the final report.",
  ].join("\n\n");
  return generateJson<FinalReport>(config.reportModel, reportSchema, prompt);
}
