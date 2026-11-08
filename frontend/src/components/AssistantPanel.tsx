import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Schedule } from "@/datatypes";
import { chatAssistant, generateSchedule } from "@/lib/api";
import { candidateFromDraft, completeDraft, draftItemId, restoreChat,
  type AssistantDraft, type ChatMessage, type ChatState } from "@/lib/assistantChat";
import { hours } from "@/lib/calendar";
import TimeShortagePanel from "./TimeShortagePanel";

const KEY = "schedule-maker-chat:backend:v1";
const empty = (): ChatState => ({ messages: [], draft: null, ready: false });
const when = (date: Date) => date.toLocaleString(undefined, {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
});
const finish = (messages: ChatMessage[], text: string): ChatMessage[] => {
  const message: ChatMessage = { role: "assistant", content: text };
  return messages.length < 40 ? [...messages, message] : [...messages.slice(0, -1), message];
};

export default function AssistantPanel({ schedule, onApply, onBusy }: {
  schedule: Schedule;
  onApply: (next: Schedule) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [chat, setChat] = useState<ChatState>(empty);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [storageNotice, setStorageNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState<ChatMessage[] | null>(null);
  const [preview, setPreview] = useState<{ base: Schedule; next: Schedule; draft: AssistantDraft } | null>(null);
  const working = useRef(false);
  const applied = useRef(new Set<string>());
  const transcript = useRef<HTMLDivElement>(null);
  const currentPreview = preview?.base === schedule ? preview : null;

  useEffect(() => {
    const timer = setTimeout(() => {
      try { setChat(restoreChat(localStorage.getItem(KEY))); }
      catch { setStorageNotice("Chat cannot be restored in this browser. You can still use it for this visit."); }
      setLoaded(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(KEY, JSON.stringify(chat)); }
    catch {
      const timer = setTimeout(() => setStorageNotice("Chat could not be saved. This conversation is available for this visit only."), 0);
      return () => clearTimeout(timer);
    }
  }, [chat, loaded]);
  useEffect(() => {
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [chat.messages, pending]);

  function reset() {
    setPreview(null); setChat(empty()); setInput(""); setError(""); setRetry(null);
  }
  function cancel() {
    setPreview(null); setInput(""); setError(""); setRetry(null);
    setChat(current => ({ messages: finish(current.messages, "Draft cancelled. Your calendar has not changed."), draft: null, ready: false }));
  }
  async function buildPreview(draft: AssistantDraft, base: Schedule, now: Date) {
    if (applied.current.has(draft.id)) throw new Error("This draft has already been applied. Start a new request.");
    const candidate = candidateFromDraft(base, draft, now);
    const revised = await generateSchedule(candidate.schedule, now);
    setPreview({ base, next: { ...candidate.schedule, ...revised, source: "backend", needsReplan: false }, draft });
  }
  async function send(messages: ChatMessage[]) {
    if (working.current) return;
    if (messages.length >= 40 || messages.reduce((sum, message) => sum + message.content.length, 0) > 22000) {
      setError("This conversation is too long. Use Start over to begin a new request."); return;
    }
    working.current = true; setPending(true); onBusy(true); setError(""); setPreview(null); setRetry(null);
    setInput("");
    // A submitted correction must be answered before the older draft can apply.
    setChat(current => ({ ...current, messages, ready: false }));
    try {
      const now = new Date();
      const response = await chatAssistant(messages, chat.draft, now);
      const nextMessages: ChatMessage[] = [...messages, { role: "assistant", content: response.message }];
      setChat({ messages: nextMessages, draft: response.draft, ready: response.status === "ready" });
      if (response.status === "ready" && response.draft) {
        try { await buildPreview(response.draft, schedule, now); }
        catch (error) { setError(error instanceof Error ? error.message : "Could not prepare a preview. Your calendar has not changed."); }
      }
    } catch (error) {
      setRetry(messages);
      setError(error instanceof Error ? error.message : "Assistant request failed. Your calendar has not changed.");
    } finally { working.current = false; setPending(false); onBusy(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const content = input.trim();
    if (!content || working.current || !loaded) return;
    void send([...chat.messages, { role: "user", content }]);
  }
  async function previewAgain() {
    if (!chat.draft || !chat.ready || working.current || input.trim()) return;
    working.current = true; setPending(true); onBusy(true); setError("");
    try { await buildPreview(chat.draft, schedule, new Date()); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not prepare a preview."); }
    finally { working.current = false; setPending(false); onBusy(false); }
  }
  function applyPreview() {
    if (!currentPreview || pending || applied.current.has(currentPreview.draft.id)) return;
    const id = draftItemId(currentPreview.draft);
    if (schedule.tasks.some(task => task.id === id) || schedule.events.some(event => event.id === id)) {
      setError("This draft has already been applied."); setPreview(null); return;
    }
    applied.current.add(currentPreview.draft.id);
    onApply(currentPreview.next);
    setChat(current => ({ messages: finish(current.messages, `${currentPreview.draft.kind === "assignment" ? "Assignment" : "Event"} added and study plan updated.`), draft: null, ready: false }));
    setPreview(null); setInput(""); setError(""); setRetry(null);
  }
  const draft = chat.draft;
  const ready = chat.ready && !!draft && completeDraft(draft);
  const field = (value: string | number | null) => value === null || value === "" ? "Not provided" : String(value);

  return (
    <section className="assistant-panel form-stack" aria-label="Schedule assistant">
      <h2>Schedule assistant</h2>
      <p className="muted">Add an assignment or event through chat. I’ll ask for missing details, then show a plan for you to review.</p>
      {storageNotice && <p className="muted small" role="status">{storageNotice}</p>}
      <div className="assistant-transcript" role="log" aria-label="Assistant conversation" aria-live="polite" ref={transcript}>
        {!chat.messages.length && <p className="muted small">Try “Add my integration worksheet, due Tuesday.”</p>}
        {chat.messages.map((message, index) => (
          <div key={index} className={`chat-message chat-${message.role}`}>
            <span className="chat-speaker">{message.role === "user" ? "You" : "Assistant"}</span>
            <p>{message.content}</p>
          </div>
        ))}
        {pending && <p className="muted small" role="status">Checking your draft and preparing the next step…</p>}
      </div>
      {draft?.kind && (
        <section className="chat-draft" aria-label="Pending draft">
          <h3>{draft.kind === "assignment" ? "Assignment draft" : "Event draft"}</h3>
          <dl>
            <div><dt>Name</dt><dd>{field(draft.title)}</dd></div>
            {draft.kind === "assignment" ? <>
              <div><dt>Deadline</dt><dd>{draft.deadline ? (Number.isFinite(Date.parse(draft.deadline)) ? when(new Date(draft.deadline)) : "Needs clarification") : "Not provided"}</dd></div>
              <div><dt>Estimated study time</dt><dd>{draft.estimated_minutes === null ? "Not provided" : `${draft.estimated_minutes} minutes`}</dd></div>
              <div><dt>Grade weight</dt><dd>{draft.grade_weight === null ? "Not provided" : `${draft.grade_weight}%`}</dd></div>
            </> : <>
              <div><dt>Start</dt><dd>{draft.start && Number.isFinite(Date.parse(draft.start)) ? when(new Date(draft.start)) : "Not provided"}</dd></div>
              <div><dt>End</dt><dd>{draft.end && Number.isFinite(Date.parse(draft.end)) ? when(new Date(draft.end)) : "Not provided"}</dd></div>
            </>}
          </dl>
          <p className="muted small">Not saved to your calendar. {ready ? "Review the preview or send a correction." : "Reply with the missing or corrected details."}</p>
        </section>
      )}
      <form className="form-stack" onSubmit={submit}>
        <label>
          Assistant message
          <textarea required maxLength={10000} rows={2} value={input} disabled={!loaded || pending}
            onChange={(event) => { setInput(event.target.value); setPreview(null); }}
            placeholder="Ask to add an assignment or event, or answer a question…" />
        </label>
        <div className="assistant-actions">
          <button className="button primary" disabled={pending || !input.trim() || !loaded} type="submit">Send message</button>
          {!!chat.messages.length && <button className="button" disabled={pending} type="button" onClick={reset}>Start over</button>}
          {draft && <button className="button" disabled={pending} type="button" onClick={cancel}>Cancel draft</button>}
          {retry && <button className="button" disabled={pending || !!input.trim()} type="button" onClick={() => void send(retry)}>Retry message</button>}
          {ready && !currentPreview && <button className="button" disabled={pending || !!input.trim()} type="button" onClick={() => void previewAgain()}>Preview changes</button>}
        </div>
      </form>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {preview && !currentPreview && <p className="muted small" role="status">Your schedule changed. Generate a new preview before applying this draft.</p>}
      {currentPreview && (
        <section className="assistant-preview form-stack" aria-label="Revised schedule preview">
          <h3>Revised schedule preview</h3>
          <p><strong>{currentPreview.draft.title}</strong><br />
            {currentPreview.draft.kind === "assignment"
              ? `Due ${when(new Date(currentPreview.draft.deadline!))} · ${hours(currentPreview.draft.estimated_minutes!)} estimated · ${currentPreview.draft.grade_weight}% of grade`
              : `${when(new Date(currentPreview.draft.start!))} – ${when(new Date(currentPreview.draft.end!))}`}</p>
          <p className="muted">Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}. Fixed commitments and study history are preserved. Your calendar has not changed.</p>
          <h4>Revised study sessions</h4>
          {currentPreview.next.studyBlocks.length ? <ul className="assistant-sessions">
            {[...currentPreview.next.studyBlocks].sort((a, b) => +a.startTime - +b.startTime).map((block) => (
              <li key={block.id}>
                <strong>{currentPreview.next.tasks.find((task) => task.id === block.taskId)?.name}</strong>
                <span>{when(block.startTime)} – {when(block.endTime)} ({block.status})</span>
              </li>
            ))}
          </ul> : <p>No study sessions in the revised plan.</p>}
          {currentPreview.next.warnings.length > 0 && <TimeShortagePanel schedule={currentPreview.next} demo={false} />}
          <div className="assistant-actions">
            <button className="button primary" disabled={pending} onClick={applyPreview}>Apply</button>
            <button className="button" disabled={pending} onClick={() => setPreview(null)}>Discard preview</button>
          </div>
        </section>
      )}
    </section>
  );
}
