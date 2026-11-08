/** Show validation fields without discarding the backend's useful explanation. */
export function formatApiError(status: number, path: string, payload: unknown): string {
  const preserved = "Your existing schedule is preserved.";
  if (status === 404 && path === "/schedule") {
    return `The backend /schedule endpoint is not implemented yet. ${preserved}`;
  }
  const data = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const fields = Array.isArray(data.details) ? data.details.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const detail = value as Record<string, unknown>;
    if (!Array.isArray(detail.loc) || typeof detail.msg !== "string") return [];
    const location = detail.loc.filter(part => part !== "body" && (typeof part === "string" || typeof part === "number")).join(".");
    return [{ location, type: detail.type, text: `${location ? `${location}: ` : ""}${detail.msg}` }];
  }) : [];
  const explanation = fields.length ? fields.map(field => field.text).join("; ")
    : typeof data.error === "string" ? data.error : typeof data.detail === "string" ? data.detail : "";
  const outdated = fields.some(field => field.location === "preferences.spread_assignments" && field.type === "extra_forbidden");
  return `Backend request failed (${status}).${explanation ? ` ${explanation}.` : ""}${outdated ? " Restart the Python backend to load the new study-spacing setting." : ""} ${preserved}`;
}
