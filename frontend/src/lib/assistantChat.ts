import { Task, type Event, type Schedule } from "../datatypes";
import { releaseConflictingPlacements } from "./plan";

export type ChatField = "title" | "deadline" | "estimated_minutes" | "grade_weight" | "start" | "end";
export interface ChatMessage { role: "user" | "assistant"; content: string }
export interface AssistantDraft {
  id: string;
  started_at: number;
  kind: "assignment" | "event" | null;
  title: string | null;
  deadline: string | null;
  estimated_minutes: number | null;
  grade_weight: number | null;
  start: string | null;
  end: string | null;
  sources: Partial<Record<ChatField, number>>;
}
export interface ChatResponse {
  status: "needs_input" | "ready" | "cancelled";
  message: string;
  draft: AssistantDraft | null;
  missing_fields: ChatField[];
}
export interface ChatState { messages: ChatMessage[]; draft: AssistantDraft | null; ready: boolean }
const FIELDS: ChatField[] = ["title", "deadline", "estimated_minutes", "grade_weight", "start", "end"];
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const failure = () => new Error("Invalid assistant response. Your existing schedule is preserved.");
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function validChatDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number(value.slice(0, 4)) >= 2 && Number(value.slice(0, 4)) <= 9997 && Number.isFinite(+day) && day.toISOString().slice(0, 10) === value.slice(0, 10);
}

export function validateDraft(value: unknown): AssistantDraft {
  if (!object(value) || typeof value.id !== "string" || !UUID.test(value.id) ||
      !Number.isInteger(value.started_at) || (value.started_at as number) < 0 ||
      ![null, "assignment", "event"].includes(value.kind as string | null)) throw failure();
  for (const field of ["title", "deadline", "start", "end"] as const) {
    if (value[field] !== null && (typeof value[field] !== "string" || (value[field] as string).length > 10000)) throw failure();
  }
  for (const field of ["estimated_minutes", "grade_weight"] as const) {
    if (value[field] !== null && (typeof value[field] !== "number" || !Number.isFinite(value[field]))) throw failure();
  }
  if (!object(value.sources) || Object.entries(value.sources).some(([field, index]) =>
    !FIELDS.includes(field as ChatField) || !Number.isInteger(index) || (index as number) < 0)) throw failure();
  return value as unknown as AssistantDraft;
}

export function completeDraft(draft: AssistantDraft, now = new Date()): boolean {
  if (!draft.title?.trim() || draft.title.trim().length > 150) return false;
  const validDate = (value: unknown) => validChatDate(value) && +new Date(value) <= +now + 366 * 86400000;
  if (draft.kind === "assignment") return validDate(draft.deadline) &&
    Number.isInteger(draft.estimated_minutes) && draft.estimated_minutes! >= 1 && draft.estimated_minutes! <= 60000 &&
    draft.grade_weight !== null && Number.isFinite(draft.grade_weight) && draft.grade_weight >= 0 && draft.grade_weight <= 100;
  return draft.kind === "event" && validDate(draft.start) && validDate(draft.end) &&
    +new Date(draft.end!) - +new Date(draft.start!) >= 60000;
}

export function validateChatResponse(value: unknown, now = new Date()): ChatResponse {
  if (!object(value) || !["needs_input", "ready", "cancelled"].includes(value.status as string) ||
      typeof value.message !== "string" || !value.message.trim() || value.message.length > 10000 ||
      !Array.isArray(value.missing_fields) || value.missing_fields.some(field => !FIELDS.includes(field))) throw failure();
  const draft = value.draft === null ? null : validateDraft(value.draft);
  if (value.status === "ready" && (!draft || !completeDraft(draft, now) || value.missing_fields.length)) throw failure();
  if (value.status === "cancelled" && draft !== null) throw failure();
  return { status: value.status as ChatResponse["status"], message: value.message, draft, missing_fields: value.missing_fields };
}

/** Stable draft IDs make retry/reload duplicate detection independent of AI output. */
export function draftItemId(draft: AssistantDraft) { return `assistant-${draft.id}`; }

export function candidateFromDraft(base: Schedule, value: AssistantDraft, now = new Date()) {
  const draft = validateDraft(value);
  if (!completeDraft(draft, now)) throw new Error("This draft is incomplete or invalid. Provide the required fields first.");
  const id = draftItemId(draft);
  if (base.tasks.some(item => item.id === id) || base.events.some(item => item.id === id)) {
    throw new Error("This draft has already been applied. Start a new request to add another item.");
  }
  if (draft.kind === "assignment") {
    if (base.tasks.length >= 200) throw new Error("The workspace already has the maximum 200 assignments.");
    const item = new Task({ id, name: draft.title!.trim(), deadline: new Date(draft.deadline!),
      estimatedTimeMinutes: draft.estimated_minutes!, gradeWeight: draft.grade_weight! });
    return { item, schedule: { ...base, tasks: [...base.tasks, item], needsReplan: true } };
  }
  if (base.events.length >= 1000) throw new Error("The workspace already has the maximum 1000 events.");
  const startTime = new Date(draft.start!), endTime = new Date(draft.end!);
  const minutes = Math.round((+endTime - +startTime) / 60000);
  const item: Event = { id, name: draft.title!.trim(), startTime, endTime, timeMinutes: minutes, remainingTimeMinutes: minutes };
  return { item, schedule: releaseConflictingPlacements({ ...base, events: [...base.events, item], needsReplan: true }, now) };
}

/** Persist only messages/drafts, never an applicable schedule preview. */
export function restoreChat(text: string | null, now = new Date()): ChatState {
  const empty: ChatState = { messages: [], draft: null, ready: false };
  if (!text) return empty;
  try {
    const data: unknown = JSON.parse(text);
    if (!object(data) || !Array.isArray(data.messages) || data.messages.length > 40 || typeof data.ready !== "boolean") return empty;
    const messages: ChatMessage[] = [];
    for (const message of data.messages) {
      if (!object(message) || !["user", "assistant"].includes(message.role as string) ||
          typeof message.content !== "string" || !message.content.trim() || message.content.length > 10000) return empty;
      messages.push(message as unknown as ChatMessage);
    }
    if (messages.reduce((sum, message) => sum + message.content.length, 0) > 24000) return empty;
    const draft = data.draft === null ? null : validateDraft(data.draft);
    if (draft && (draft.started_at >= messages.length || messages[draft.started_at].role !== "user")) return empty;
    if (draft && Object.values(draft.sources).some(index => index < draft.started_at || index >= messages.length || messages[index].role !== "user")) return empty;
    return { messages, draft, ready: !!draft && data.ready && completeDraft(draft, now) };
  } catch { return empty; }
}
