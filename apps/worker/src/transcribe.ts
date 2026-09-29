import { config } from "./config";
import { log } from "./log";

export type FinalUtterance = { speaker: string; text: string; startMs: number; endMs: number };

type Word = { text: string; start: number; end: number; word_is_final?: boolean };
type Message =
  | { type: "Begin"; id: string }
  | {
      type: "Turn";
      transcript: string;
      end_of_turn: boolean;
      turn_is_formatted: boolean;
      words: Word[];
      speaker_label?: string;
    }
  | { type: "Termination" }
  | { type: "Error"; error: string };

const BASE = "streaming.assemblyai.com/v3";

// Meetings are English/Hindi; background noise sometimes comes back as short
// CJK "words" (嗯, 哎呦). Drop turns written only in those scripts.
const NOISE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{P}\s]+$/u;

/**
 * Streams 16 kHz mono PCM to AssemblyAI Universal-Streaming and emits one
 * utterance per finished, formatted turn.
 */
export class LiveTranscriber {
  private ws: WebSocket | null = null;
  private open: Promise<void>;
  private closed = false;

  constructor(private readonly onFinal: (u: FinalUtterance) => void) {
    this.open = this.connect();
    this.open.catch(() => {});
  }

  private async connect(): Promise<void> {
    // Node's WebSocket can't set headers, so trade the API key for a short-lived token.
    const res = await fetch(`https://${BASE}/token?expires_in_seconds=600`, {
      headers: { authorization: config.assemblyAiApiKey },
    });
    if (!res.ok) throw new Error(`assemblyai token failed: ${res.status} ${await res.text()}`);
    const { token } = (await res.json()) as { token: string };

    const params = new URLSearchParams({
      sample_rate: "16000",
      encoding: "pcm_s16le",
      format_turns: "true",
      speaker_labels: "true",
      token,
    });
    const ws = new WebSocket(`wss://${BASE}/ws?${params}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("message", (ev) => {
        const msg = JSON.parse(String(ev.data)) as Message;
        if (msg.type === "Begin") resolve();
        else if (msg.type === "Turn") this.handle(msg);
        else if (msg.type === "Error") log.warn("assemblyai error", { error: msg.error });
      });
      ws.addEventListener("error", () => reject(new Error("assemblyai websocket error")));
      ws.addEventListener("close", (ev) => {
        reject(new Error(`assemblyai closed before start: ${ev.code} ${ev.reason}`));
        if (!this.closed) log.warn("assemblyai connection closed", { code: ev.code, reason: ev.reason });
      });
    });
  }

  ready(): Promise<void> {
    return this.open;
  }

  send(pcm: Buffer): void {
    if (this.closed || this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(pcm);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Terminate flushes the last turn, then the server closes the socket.
    const done = new Promise<void>((resolve) => {
      ws.addEventListener("close", () => resolve());
      setTimeout(resolve, 5000);
    });
    ws.send(JSON.stringify({ type: "Terminate" }));
    await done;
    ws.close();
  }

  private lastSpeaker = "Speaker";

  private handle(turn: Extract<Message, { type: "Turn" }>): void {
    // With format_turns, each turn arrives once unformatted and once formatted; keep the latter.
    if (!turn.end_of_turn || !turn.turn_is_formatted) return;
    const text = turn.transcript.trim();
    if (!text || NOISE.test(text)) return;
    const words = turn.words ?? [];
    const label = turn.speaker_label;
    // PENDING/UNKNOWN: diarization hasn't decided yet; assume the previous speaker.
    if (label && !/^(PENDING|UNKNOWN)$/i.test(label)) this.lastSpeaker = `Speaker ${label}`;
    this.onFinal({
      speaker: this.lastSpeaker,
      text,
      startMs: words[0]?.start ?? 0,
      endMs: words.at(-1)?.end ?? 0,
    });
  }
}
