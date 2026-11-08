import type { Schedule } from "@/datatypes";
import { fromScheduleResponse, toScheduleRequest } from "./apiAdapter";
import { formatApiError } from "./apiErrors";

export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
).replace(/\/$/, "");

async function request(path: string, init?: RequestInit) {
  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(path === "/assistant/parse" ? 40000 : 15000),
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    if (!response.ok) {
      let details: unknown;
      try { details = await response.json(); } catch { /* Non-JSON proxy errors still show their HTTP status. */ }
      throw new Error(formatApiError(response.status, path, details));
    }
    return (await response.json()) as unknown;
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError")
      throw new Error("The backend took too long to respond. Please try again. Your existing schedule is preserved.");
    if (error instanceof TypeError)
      throw new Error(
        `Cannot reach ${API_URL}. Check that FastAPI is running and CORS allows this origin.`,
      );
    throw error;
  }
}

export async function checkHealth() {
  const health = await request("/health");
  if (
    !health ||
    typeof health !== "object" ||
    !("status" in health) ||
    health.status !== "ok"
  )
    throw new Error("Unexpected backend health response.");
}

export async function generateSchedule(schedule: Schedule, now = new Date()) {
  const data = await request("/schedule", {
    method: "POST",
    body: JSON.stringify(toScheduleRequest(schedule, now)),
  });
  return fromScheduleResponse(data, schedule, now);
}

export type AssistantResult =
  | { type: "clarification"; question: string }
  | { type: "event_draft"; title: string; start: string; end: string };

export async function parseAssistant(message: string, now = new Date()): Promise<AssistantResult> {
  const data = await request("/assistant/parse", {
    method: "POST",
    body: JSON.stringify({
      message,
      current_time: now.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  });
  if (data && typeof data === "object" && "type" in data) {
    if (data.type === "clarification" && "question" in data &&
        typeof data.question === "string" && data.question.trim()) {
      return { type: data.type, question: data.question };
    }
    if (data.type === "event_draft" && "title" in data &&
        typeof data.title === "string" && data.title.trim() &&
        "start" in data && "end" in data &&
        typeof data.start === "string" && typeof data.end === "string") {
      const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
      if (timestamp.test(data.start) && timestamp.test(data.end) &&
          Number.isFinite(Date.parse(data.start)) && Number.isFinite(Date.parse(data.end)) &&
          Date.parse(data.end) > Date.parse(data.start)) {
        return { type: data.type, title: data.title, start: data.start, end: data.end };
      }
    }
  }
  throw new Error("Invalid assistant response. Please try again. Your existing schedule is preserved.");
}
