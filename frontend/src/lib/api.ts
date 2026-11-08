import type { Schedule } from "@/datatypes";
import { fromScheduleResponse, toScheduleRequest } from "./apiAdapter";

export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
).replace(/\/$/, "");

async function request(path: string, init?: RequestInit) {
  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    if (!response.ok)
      throw new Error(
        response.status === 404 && path === "/schedule"
          ? "The backend /schedule endpoint is not implemented yet. Your existing schedule is preserved."
          : `Backend request failed (${response.status}). Your existing schedule is preserved.`,
      );
    return (await response.json()) as unknown;
  } catch (error) {
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
