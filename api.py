"""Local HTTP/JSON adapter for the Replan scheduler (standard library only)."""

import argparse
import json
import re
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from scheduler import Assignment, StudyBlock, Window, replan_assignment


LOCAL_ORIGINS = {"http://localhost:3000", "http://127.0.0.1:3000"}
MAX_BODY_BYTES = 1_000_000


def object_value(value, name):
    if not isinstance(value, dict):
        raise ValueError(f"{name} must be an object")
    return value


def required(data, name):
    if name not in data:
        raise ValueError(f"Missing field: {name}")
    return data[name]


def timestamp(value):
    """Require minute-aligned ISO 8601 with an explicit offset; normalize UTC."""
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:Z|[+-]\d{2}:\d{2})", value
    ):
        raise ValueError("Datetimes must use YYYY-MM-DDTHH:MM:00Z or an explicit ±HH:MM offset")
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def integer(data, name, minimum):
    value = required(data, name)
    if type(value) is not int or value < minimum:
        raise ValueError(f"{name} must be an integer >= {minimum}")
    return value


def intervals(data, name, title=None):
    values = required(data, name)
    if not isinstance(values, list):
        raise ValueError(f"{name} must be a list")
    result = []
    for value in values:
        item = object_value(value, name + " entry")
        start = timestamp(required(item, "start"))
        end = timestamp(required(item, "end"))
        if end <= start:
            raise ValueError(f"{name} entries must end after they start")
        if title is None:
            result.append(Window(start, end))
        else:
            if required(item, "title") != title:
                raise ValueError("Existing blocks must have the assignment title")
            result.append(StudyBlock(title, start, end))
    return result


def plan(payload):
    """Translate the documented JSON contract into scheduler domain objects."""
    data = object_value(payload, "Request")
    assignment = object_value(required(data, "assignment"), "assignment")
    title = required(assignment, "title")
    if not isinstance(title, str) or not title.strip():
        raise ValueError("assignment.title must be a nonempty string")
    due = timestamp(required(assignment, "deadline"))
    now = timestamp(required(data, "now"))
    remaining = integer(data, "remaining_minutes", 0)
    session = integer(data, "max_session_minutes", 1)
    pause = integer(data, "break_minutes", 0)
    result = replan_assignment(
        Assignment(title, remaining, due),
        intervals(data, "available_windows"),
        intervals(data, "existing_blocks", title),
        remaining, now, session, pause,
    )

    def serialize(block):
        return {
            "title": block.title,
            "start": block.start.isoformat().replace("+00:00", "Z"),
            "end": block.end.isoformat().replace("+00:00", "Z"),
        }

    past = [block for block in result.blocks if block.start < now]
    future = [block for block in result.blocks if block.start >= now]
    return {
        "past_blocks": [serialize(block) for block in past],
        "future_blocks": [serialize(block) for block in future],
        "future_scheduled_minutes": sum(
            int((block.end - block.start).total_seconds() // 60) for block in future
        ),
        "unscheduled_minutes": result.unscheduled_minutes,
    }


class PlanHandler(BaseHTTPRequestHandler):
    def respond(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Vary", "Origin")
        if self.headers.get("Origin") in LOCAL_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.respond(200 if self.path == "/api/plan" else 404, {})

    def do_POST(self):
        if self.path != "/api/plan":
            self.respond(404, {"error": "Not found"})
            return
        if self.headers.get_content_type() != "application/json":
            self.respond(415, {"error": "Content-Type must be application/json"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY_BYTES:
                raise ValueError("Request body must be between 1 and 1000000 bytes")
            payload = json.loads(self.rfile.read(length))
            response = plan(payload)
        except (ValueError, OverflowError, RecursionError) as error:
            self.respond(400, {"error": str(error)})
            return
        self.respond(200, response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    with ThreadingHTTPServer(("127.0.0.1", args.port), PlanHandler) as server:
        print(f"Replan API: http://127.0.0.1:{args.port}/api/plan", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
