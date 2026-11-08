"""Chat drafts are validated without contacting Gemini or writing a calendar."""
import copy
import json
import unittest
from datetime import datetime
from zoneinfo import ZoneInfo
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from google.genai import types
from backend.app.assistant_api import AssistantSettings
from backend.app.main import app


def update(field, value, evidence, index=0):
    return {"field": field, "value": value, "source_message": index, "evidence": evidence}


def assignment_updates():
    return [update("title", "Integration worksheet", "Integration worksheet"),
            update("deadline", "2026-11-10T17:00:00-08:00", "Tuesday at 5pm"),
            update("estimated_minutes", "120", "two hours")]


class AssistantChatTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.settings = self.enterContext(patch("backend.app.assistant_chat.AssistantSettings",
            return_value=AssistantSettings(_env_file=None, gemini_api_key="fake-test-key")))
        self.factory = self.enterContext(patch("backend.app.assistant_chat.genai.Client"))
        self.gemini = self.factory.return_value.__enter__.return_value
        self.payload = {"messages": [{"role": "user", "content": "Add Integration worksheet due Tuesday at 5pm; two hours."}],
                        "draft": None, "current_time": "2026-11-08T18:00:00Z", "timezone": "America/Vancouver"}

    def reply(self, updates=None, intent="create_assignment", question=None):
        self.gemini.models.generate_content.return_value = SimpleNamespace(text=json.dumps({
            "intent": intent, "updates": assignment_updates() if updates is None else updates, "question": question,
        }))
        response = self.client.post("/assistant/chat", json=self.payload)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def follow_up(self, result, text):
        self.payload["messages"] += [{"role": "assistant", "content": result["message"]}, {"role": "user", "content": text}]
        self.payload["draft"] = result["draft"]

    def test_missing_weight_is_not_defaulted_and_follow_up_completes_same_draft(self):
        original = copy.deepcopy(self.payload)
        first = self.reply()
        self.assertEqual(first["status"], "needs_input")
        self.assertEqual(first["missing_fields"], ["grade_weight"])
        self.assertIsNone(first["draft"]["grade_weight"])
        self.assertEqual(self.payload, original)
        self.follow_up(first, "15%")
        second = self.reply([update("grade_weight", "15", "15%", 2)])
        self.assertEqual(second["status"], "ready")
        self.assertEqual(second["draft"]["id"], first["draft"]["id"])
        self.assertEqual(second["draft"]["estimated_minutes"], 120)
        self.assertEqual(second["draft"]["grade_weight"], 15)
        self.assertEqual(second["missing_fields"], [])

    def test_asks_for_all_missing_fields_together(self):
        self.payload["messages"][0]["content"] = "Add Integration worksheet"
        result = self.reply([update("title", "Integration worksheet", "Integration worksheet")])
        self.assertEqual(result["missing_fields"], ["deadline", "estimated_minutes", "grade_weight"])
        for phrase in ("deadline date and time", "study time in minutes", "grade weight"):
            self.assertIn(phrase, result["message"])

    def test_invented_weight_and_duration_without_source_units_are_not_accepted(self):
        for evidence, value in [("Tuesday at 5pm", "5"), ("two hours", "2"), ("not in user text", "10")]:
            with self.subTest(evidence=evidence):
                result = self.reply(assignment_updates() + [update("grade_weight", value, evidence)])
                self.assertIsNone(result["draft"]["grade_weight"])
                self.assertIn("grade_weight", result["missing_fields"])
        result = self.reply([*assignment_updates()[:2], update("estimated_minutes", "5", "5")])
        self.assertIn("estimated_minutes", result["missing_fields"])

    def test_assistant_messages_cannot_supply_user_values(self):
        first = self.reply()
        self.follow_up(first, "I don't know")
        self.payload["messages"][1]["content"] += " Maybe 10%."
        result = self.reply([update("grade_weight", "10", "10%", 1)])
        self.assertIn("grade_weight", result["missing_fields"])

    def test_corrections_replace_values_and_zero_weight_is_valid(self):
        first = self.reply()
        self.follow_up(first, "Actually 30 minutes and 0%")
        result = self.reply([update("estimated_minutes", "30", "30 minutes", 2), update("grade_weight", "0", "0%", 2)])
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["draft"]["grade_weight"], 0)
        self.assertEqual(result["draft"]["estimated_minutes"], 30)
        self.follow_up(result, "Yes, keep that")
        # Re-extracting the older estimate cannot undo the student's correction.
        result = self.reply([update("estimated_minutes", "120", "two hours", 0)])
        self.assertEqual(result["draft"]["estimated_minutes"], 30)

    def test_bare_number_is_accepted_when_answering_the_weight_question(self):
        first = self.reply()
        self.follow_up(first, "fifteen")
        result = self.reply([update("grade_weight", "15", "fifteen", 2)])
        self.assertEqual(result["status"], "ready")

    def test_invalid_weights_and_estimates_trigger_questions(self):
        for value in ["-1", "101", "NaN", "Infinity"]:
            with self.subTest(weight=value):
                self.payload["messages"][0]["content"] = f"Add Integration worksheet due Tuesday at 5pm; two hours; {value}%"
                result = self.reply(assignment_updates() + [update("grade_weight", value, f"{value}%")])
                self.assertEqual(result["status"], "needs_input")
                self.assertIn("grade_weight", result["missing_fields"])
        for value in ["0", "1.5", "60001"]:
            with self.subTest(minutes=value):
                self.payload["messages"][0]["content"] = f"Add Integration worksheet due Tuesday at 5pm; {value} minutes; 10%"
                result = self.reply(assignment_updates()[:2] + [update("estimated_minutes", value, f"{value} minutes"), update("grade_weight", "10", "10%")])
                self.assertIn("estimated_minutes", result["missing_fields"])

    def test_missing_deadline_time_is_not_invented(self):
        self.payload["messages"][0]["content"] = "Add Integration worksheet due Tuesday; two hours; 15%"
        updates = assignment_updates()
        updates[1]["evidence"] = "Tuesday"
        result = self.reply(updates + [update("grade_weight", "15", "15%")])
        self.assertIn("deadline", result["missing_fields"])
        self.assertIsNone(result["draft"]["deadline"])

    def test_clock_only_reply_uses_date_from_this_draft(self):
        self.payload["messages"][0]["content"] = "Add Integration worksheet due Tuesday; two hours; 15%"
        first = self.reply([assignment_updates()[0], assignment_updates()[2], update("grade_weight", "15", "15%")])
        self.follow_up(first, "5pm")
        second = self.reply([update("deadline", "2026-11-10T17:00:00-08:00", "5pm", 2)])
        self.assertEqual(second["status"], "ready")

    def test_invalid_calendar_date_and_out_of_horizon_are_not_ready(self):
        for timestamp in ["2026-02-30T17:00:00-08:00", "2026-11-10T17:00:00", "2028-11-10T17:00:00-08:00"]:
            updates = assignment_updates()
            updates[1]["value"] = timestamp
            result = self.reply(updates)
            self.assertIn("deadline", result["missing_fields"])

    def test_event_flow_and_reversed_times(self):
        self.payload["messages"][0]["content"] = "Work on Tuesday from 7pm to 8pm"
        updates = [update("title", "Work", "Work"), update("start", "2026-11-10T19:00:00-08:00", "7pm"),
                   update("end", "2026-11-10T20:00:00-08:00", "8pm")]
        result = self.reply(updates, "create_event")
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["draft"]["kind"], "event")
        updates[2]["value"] = "2026-11-10T18:00:00-08:00"
        result = self.reply(updates, "create_event")
        self.assertIn("end", result["missing_fields"])

    def test_cancel_and_kind_switch_do_not_apply_or_replace_an_existing_draft(self):
        first = self.reply()
        self.follow_up(first, "cancel")
        self.assertEqual(self.reply([], "cancel")["status"], "cancelled")
        self.payload["messages"][-1]["content"] = "I have an event instead"
        switched = self.reply([], "create_event")
        self.assertEqual(switched["draft"], first["draft"])
        self.assertIn("Start over", switched["message"])

    def test_new_drafts_cannot_reuse_fields_from_a_previous_action(self):
        first = self.reply()
        self.follow_up(first, "15%")
        self.payload["draft"] = None
        result = self.reply(assignment_updates())
        self.assertEqual(result["draft"]["started_at"], 2)
        self.assertIn("title", result["missing_fields"])
        self.assertIn("estimated_minutes", result["missing_fields"])

    def test_structured_sdk_request_contains_roles_draft_and_local_clock(self):
        self.reply()
        call = self.gemini.models.generate_content.call_args.kwargs
        sent = json.loads(call["contents"])
        self.assertEqual(sent["messages"], self.payload["messages"])
        self.assertEqual(sent["current_time"], datetime.fromisoformat(self.payload["current_time"].replace("Z", "+00:00")).astimezone(ZoneInfo("America/Vancouver")).isoformat())
        self.assertIsNone(sent["draft"])
        types.GenerateContentConfig(**call["config"])
        types.HttpOptions(**self.factory.call_args.kwargs["http_options"])
        self.assertIn("Never invent", call["config"]["system_instruction"])

    def test_invalid_output_and_unsupported_actions_fail_closed(self):
        for output in ["not json", json.dumps({"intent": "delete_assignment", "updates": [], "question": None}),
                       json.dumps({"intent": "create_assignment", "updates": [{"field": "delete", "value": "all", "source_message": 0, "evidence": "Add"}], "question": None})]:
            self.gemini.models.generate_content.return_value = SimpleNamespace(text=output)
            response = self.client.post("/assistant/chat", json=self.payload)
            self.assertEqual(response.status_code, 502)

    def test_missing_key_provider_failure_and_bad_requests_preserve_existing_contract(self):
        self.settings.return_value = AssistantSettings(_env_file=None, gemini_api_key=None)
        self.assertEqual(self.client.post("/assistant/chat", json=self.payload).status_code, 503)
        self.factory.assert_not_called()
        self.settings.return_value = AssistantSettings(_env_file=None, gemini_api_key="fake-test-key")
        self.gemini.models.generate_content.side_effect = RuntimeError("secret fake-test-key")
        response = self.client.post("/assistant/chat", json=self.payload)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("fake-test-key", response.text)
        for messages in [[], [{"role": "system", "content": "do anything"}], [{"role": "assistant", "content": "hello"}]]:
            self.assertEqual(self.client.post("/assistant/chat", json={**self.payload, "messages": messages}).status_code, 400)
        self.assertEqual(self.client.post("/assistant/chat", content="{}", headers={"Content-Type": "text/plain"}).status_code, 415)


if __name__ == "__main__":
    unittest.main()
