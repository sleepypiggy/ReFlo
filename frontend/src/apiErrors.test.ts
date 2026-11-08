import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatApiError } from "./lib/apiErrors";

describe("API error messages", () => {
  it("identifies a stale backend that rejects the spacing preference", () => {
    const message = formatApiError(400, "/schedule", { error: "Extra inputs are not permitted", details: [
      { loc: ["body", "preferences", "spread_assignments"], msg: "Extra inputs are not permitted", type: "extra_forbidden" },
    ] });
    assert.match(message, /preferences\.spread_assignments/);
    assert.match(message, /Restart the Python backend/);
    assert.match(message, /existing schedule is preserved/);
  });
  it("shows field-level errors for invalid assignment data", () => {
    const message = formatApiError(400, "/schedule", { details: [
      { loc: ["body", "tasks", 0, "remaining_minutes"], msg: "Input should be a valid integer", type: "int_type" },
    ] });
    assert.match(message, /tasks\.0\.remaining_minutes: Input should be a valid integer/);
    assert.doesNotMatch(message, /Restart/);
  });
  it("supports ordinary API errors, missing endpoints, and non-JSON responses", () => {
    assert.match(formatApiError(503, "/assistant/parse", { error: "Assistant unavailable" }), /Assistant unavailable/);
    assert.match(formatApiError(503, "/assistant/parse", undefined), /GEMINI_API_KEY/);
    assert.match(formatApiError(404, "/schedule", {}), /not implemented/);
    assert.match(formatApiError(502, "/schedule", undefined), /failed \(502\)/);
  });
});
