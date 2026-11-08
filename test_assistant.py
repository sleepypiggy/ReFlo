"""Assistant endpoint contract checks with no Gemini calls or calendar writes."""

import copy
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from google.genai import types

from backend.app.assistant_api import AssistantSettings, RESULT
from backend.app.main import app
from test_schedule import request_payload


DRAFT = {
    "type": "event_draft", "title": "Work shift",
    "start": "2026-11-10T19:00:00-08:00", "end": "2026-11-10T20:00:00-08:00",
}
QUESTION = {"type": "clarification", "question": "What time does your shift start and end?"}


class AssistantApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        # Ignore any real local key and .env contents. No test contacts Gemini.
        self.settings = self.enterContext(patch(
            "backend.app.assistant_api.AssistantSettings",
            return_value=AssistantSettings(_env_file=None, gemini_api_key="fake-test-key"),
        ))
        self.factory = self.enterContext(patch("backend.app.assistant_api.genai.Client"))
        self.gemini = self.factory.return_value.__enter__.return_value
        self.payload = {
            "message": "I have work from 7 to 8 tonight",
            "current_time": "2026-11-10T18:00:00-08:00",
            "timezone": "America/Vancouver",
        }

    def respond_with(self, value):
        self.gemini.models.generate_content.return_value = SimpleNamespace(text=json.dumps(value))

    def test_discriminator_schema_uses_supported_single_value_enums(self):
        schema = RESULT.json_schema()
        for name, tag in (("EventDraft", "event_draft"), ("Clarification", "clarification")):
            with self.subTest(model=name):
                discriminator = schema["$defs"][name]["properties"]["type"]
                self.assertEqual(discriminator.get("enum"), [tag])
                self.assertNotIn("const", discriminator)

    def test_work_shift_draft_and_structured_request(self):
        self.respond_with(DRAFT)
        original = copy.deepcopy(self.payload)
        response = self.client.post("/assistant/parse", json=self.payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), DRAFT)
        self.assertEqual(self.payload, original)
        self.factory.assert_called_once_with(
            api_key="fake-test-key",
            http_options={"timeout": 30000, "retry_options": {"attempts": 1}},
        )
        call = self.gemini.models.generate_content.call_args.kwargs
        self.assertEqual(call["model"], "gemini-3.5-flash-lite")
        self.assertEqual(json.loads(call["contents"]), self.payload)
        self.assertEqual(call["config"]["response_mime_type"], "application/json")
        self.assertEqual(call["config"]["response_json_schema"], RESULT.json_schema())
        # Use real SDK types to check our configuration, even with a mocked client.
        types.GenerateContentConfig(**call["config"])
        types.HttpOptions(**self.factory.call_args.kwargs["http_options"])
        self.factory.return_value.__exit__.assert_called_once()

    def test_missing_hours_clarification(self):
        self.payload["message"] = "I’m working tonight"
        self.respond_with(QUESTION)
        response = self.client.post("/assistant/parse", json=self.payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), QUESTION)
        self.assertEqual(json.loads(self.gemini.models.generate_content.call_args.kwargs["contents"]), self.payload)

    def test_missing_key_does_not_initialize_client_or_break_scheduler(self):
        self.settings.return_value = AssistantSettings(_env_file=None, gemini_api_key=None)
        response = self.client.post("/assistant/parse", json=self.payload)
        self.assertEqual(response.status_code, 503)
        self.assertIn("GEMINI_API_KEY", response.json()["error"])
        schedule = self.client.post("/schedule", json=request_payload())
        self.assertEqual(schedule.status_code, 200, schedule.text)
        self.assertEqual(schedule.json()["unscheduled"], [])
        self.factory.assert_not_called()

    def test_gemini_unavailable(self):
        self.gemini.models.generate_content.side_effect = RuntimeError("secret provider detail fake-test-key")
        response = self.client.post("/assistant/parse", json=self.payload)
        self.assertEqual(response.status_code, 503)
        self.assertIn("Gemini request failed", response.json()["error"])
        self.assertNotIn("fake-test-key", response.text)
        self.factory.return_value.__exit__.assert_called_once()

    def test_client_initialization_failure(self):
        self.factory.side_effect = RuntimeError("secret provider detail")
        response = self.client.post("/assistant/parse", json=self.payload)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("secret provider detail", response.text)

    def test_invalid_model_output(self):
        invalid = [
            {**DRAFT, "start": "2026-11-10T19:00:00"},
            {**DRAFT, "end": "2026-11-10T20:00:00"},
            {**DRAFT, "start": "2026-11-10T19:00:00-08:99"},
            {**DRAFT, "end": DRAFT["start"]},
            {**DRAFT, "end": "2026-11-10T18:00:00-08:00"},
            # 20:00Z is earlier than the given 19:00-08:00 start.
            {**DRAFT, "end": "2026-11-10T20:00:00Z"},
            {**DRAFT, "start": "2026-02-30T19:00:00-08:00"},
            {**DRAFT, "title": " "}, {**DRAFT, "calendar_updated": True},
            {**DRAFT, "type": "event"},
            {"type": "clarification", "question": " "},
            {"type": "clarification"}, {"type": "unknown"}, [], None,
        ]
        for value in invalid:
            with self.subTest(value=value):
                self.respond_with(value)
                response = self.client.post("/assistant/parse", json=self.payload)
                self.assertEqual(response.status_code, 502, response.text)
                self.assertIn("invalid assistant output", response.json()["error"])
        for text in ("not json", "", None):
            with self.subTest(text=text):
                self.gemini.models.generate_content.return_value = SimpleNamespace(text=text)
                self.assertEqual(self.client.post("/assistant/parse", json=self.payload).status_code, 502)

    def test_invalid_requests_never_call_gemini(self):
        for field, value in (
            ("message", " "), ("message", "a" * 10001),
            ("current_time", "2026-11-10T18:00:00"),
            ("current_time", "2026-11-10T18:00:00+99:00"),
            ("timezone", "Mars/Olympus"),
        ):
            with self.subTest(field=field, value=value):
                response = self.client.post("/assistant/parse", json={**self.payload, field: value})
                self.assertEqual(response.status_code, 400, response.text)
        self.factory.assert_not_called()

    def test_json_errors_and_local_browser_cors(self):
        response = self.client.post("/assistant/parse", content="{}", headers={"Content-Type": "text/plain"})
        self.assertEqual(response.status_code, 415)
        response = self.client.post("/assistant/parse", content="{", headers={"Content-Type": "application/json"})
        self.assertEqual(response.status_code, 400)
        response = self.client.post("/assistant/parse", content="x" * 1_000_001,
                                    headers={"Content-Type": "application/json"})
        self.assertEqual(response.status_code, 400)
        response = self.client.options("/assistant/parse", headers={
            "Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], "http://localhost:3000")
        self.factory.assert_not_called()


if __name__ == "__main__":
    unittest.main()
