"""Exercise the prototype JSON contract against the production FastAPI app."""

import copy
import json
from datetime import datetime
import unittest

from fastapi.testclient import TestClient

from backend.app.main import app


def initial_request():
    return {
        "assignment": {
            "title": "Statistics assignment",
            "deadline": "2026-11-12T19:15:00-08:00",
        },
        "remaining_minutes": 240,
        "now": "2026-11-10T15:00:00-08:00",
        "existing_blocks": [],
        "available_windows": [
            {"start": "2026-11-10T16:00:00-08:00", "end": "2026-11-10T18:15:00-08:00"},
            {"start": "2026-11-11T09:00:00-08:00", "end": "2026-11-11T11:15:00-08:00"},
            {"start": "2026-11-12T18:15:00-08:00", "end": "2026-11-12T19:15:00-08:00"},
        ],
        "max_session_minutes": 60,
        "break_minutes": 15,
    }



class APITests(unittest.TestCase):
    def test_legacy_plan_allows_sessions_below_15_minutes(self):
        payload = initial_request()
        payload.update(max_session_minutes=5, remaining_minutes=8)
        status, _, result = self.request(payload)
        self.assertEqual(status, 200)
        self.assertEqual(result["future_scheduled_minutes"], 8)
        self.assertEqual(result["unscheduled_minutes"], 0)
        lengths = [(datetime.fromisoformat(block["end"]) - datetime.fromisoformat(block["start"])).total_seconds() / 60
                   for block in result["future_blocks"]]
        self.assertEqual(lengths, [5, 3])

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()

    def request(self, payload=None, method="POST", path="/api/plan", origin="http://localhost:3000",
                content_type="application/json", raw=None):
        headers = {"Content-Type": content_type, "Origin": origin}
        if method == "OPTIONS":
            headers.update({"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type"})
        response = self.client.request(method, path, content=raw if raw is not None else json.dumps(payload), headers=headers)
        # Header names are case-insensitive on the wire; retain prototype test keys.
        names = ("Access-Control-Allow-Origin", "Access-Control-Allow-Headers")
        result_headers = {name: response.headers[name] for name in names if name in response.headers}
        return response.status_code, result_headers, response.json() if response.headers.get("content-type", "").startswith("application/json") else {}

    def test_three_plans(self):
        payload = initial_request()
        status, headers, initial = self.request(payload)
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "http://localhost:3000")
        self.assertEqual(initial["past_blocks"], [])
        self.assertEqual((initial["future_scheduled_minutes"], initial["unscheduled_minutes"]), (240, 0))
        self.assertEqual([b["start"] for b in initial["future_blocks"]], [
            "2026-11-11T00:00:00Z", "2026-11-11T01:15:00Z",
            "2026-11-11T17:00:00Z", "2026-11-11T18:15:00Z",
        ])
        payload.update(now="2026-11-10T20:00:00-08:00", remaining_minutes=180,
                       existing_blocks=initial["future_blocks"])
        status, _, replanned = self.request(payload)
        self.assertEqual(status, 200)
        self.assertEqual(replanned["past_blocks"], initial["future_blocks"][:2])
        self.assertEqual((replanned["future_scheduled_minutes"], replanned["unscheduled_minutes"]), (180, 0))
        self.assertEqual(replanned["future_blocks"][:2], initial["future_blocks"][2:])
        self.assertEqual(replanned["future_blocks"][2]["start"], "2026-11-13T02:15:00Z")
        self.assertEqual(replanned["future_blocks"][2]["end"], "2026-11-13T03:15:00Z")
        payload["existing_blocks"] = replanned["past_blocks"] + replanned["future_blocks"]
        payload["available_windows"] = payload["available_windows"][:2]
        status, _, revised = self.request(payload)
        self.assertEqual(status, 200)
        self.assertEqual(revised["past_blocks"], replanned["past_blocks"])
        self.assertEqual(revised["future_blocks"], initial["future_blocks"][2:])
        self.assertEqual((revised["future_scheduled_minutes"], revised["unscheduled_minutes"]), (120, 60))
        print("HTTP scenarios verified: initial 240/0; remaining-work replan 180/0; work-shift replan 120/60.")

    def test_validation(self):
        cases = []
        for key, value in [("remaining_minutes", -1), ("remaining_minutes", True),
                           ("max_session_minutes", 0), ("break_minutes", -1),
                           ("existing_blocks", {}), ("now", "2026-11-10T15:00:00"),
                           ("now", "2026-11-10T15:00:30Z")]:
            payload = initial_request()
            payload[key] = value
            cases.append(payload)
        payload = initial_request()
        del payload["assignment"]
        cases.extend([payload, [], None])
        payload = initial_request()
        payload["available_windows"][0]["end"] = payload["available_windows"][0]["start"]
        cases.append(payload)
        for payload in cases:
            with self.subTest(payload=payload):
                status, _, body = self.request(payload)
                self.assertEqual(status, 400)
                self.assertIn("error", body)
        self.assertEqual(self.request(raw="{")[0], 400)
        self.assertEqual(self.request(initial_request(), content_type="text/plain")[0], 415)
        self.assertEqual(self.request(initial_request(), path="/missing")[0], 404)

    def test_cors(self):
        for origin in ("http://localhost:3000", "http://127.0.0.1:3000"):
            status, headers, _ = self.request(method="OPTIONS", origin=origin)
            self.assertEqual(status, 200)
            self.assertEqual(headers["Access-Control-Allow-Origin"], origin)
            self.assertIn("Content-Type", headers["Access-Control-Allow-Headers"])
        _, headers, _ = self.request(initial_request(), origin="https://example.com")
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_equivalent_offsets(self):
        payload = initial_request()
        expected = self.request(payload)[2]
        utc = copy.deepcopy(payload)
        utc["now"] = "2026-11-10T23:00:00Z"
        utc["assignment"]["deadline"] = "2026-11-13T03:15:00Z"
        self.assertEqual(self.request(utc)[2], expected)

    def test_availability_function_removes_full_thursday_shift(self):
        payload = initial_request()
        initial = self.request(payload)[2]
        payload.update(now="2026-11-10T20:00:00-08:00", remaining_minutes=180,
                       existing_blocks=initial["future_blocks"])
        payload["availability"] = {
            "timezone": "America/Vancouver", "wake_up": "07:00", "bedtime": "23:00",
            "fixed_events": [dict(payload["available_windows"][-1])],
        }
        status, _, revised = self.request(payload)
        self.assertEqual(status, 200)
        self.assertEqual(revised["past_blocks"], initial["future_blocks"][:2])
        self.assertEqual((revised["future_scheduled_minutes"], revised["unscheduled_minutes"]), (120, 60))

    def test_availability_splits_partial_thursday_shift(self):
        payload = initial_request()
        payload["available_windows"] = payload["available_windows"][-1:]
        payload["break_minutes"] = 0
        payload["availability"] = {
            "timezone": "America/Vancouver", "wake_up": "07:00", "bedtime": "23:00",
            "fixed_events": [{
                "start": "2026-11-12T18:30:00-08:00", "end": "2026-11-12T19:00:00-08:00",
            }],
        }
        status, _, result = self.request(payload)
        self.assertEqual(status, 200)
        self.assertEqual(result["future_blocks"], [
            {"title": "Statistics assignment", "start": "2026-11-13T02:15:00Z", "end": "2026-11-13T02:30:00Z"},
            {"title": "Statistics assignment", "start": "2026-11-13T03:00:00Z", "end": "2026-11-13T03:15:00Z"},
        ])
        self.assertEqual((result["future_scheduled_minutes"], result["unscheduled_minutes"]), (30, 210))

    def test_daily_sleep_hours_filter_windows(self):
        payload = initial_request()
        payload["available_windows"] = [{"start": "2026-11-11T00:00:00Z", "end": "2026-11-11T23:00:00Z"}]
        payload["availability"] = {
            "timezone": "UTC", "wake_up": "09:00", "bedtime": "12:00", "fixed_events": [],
        }
        status, _, result = self.request(payload)
        self.assertEqual(status, 200)
        self.assertEqual((result["future_scheduled_minutes"], result["unscheduled_minutes"]), (150, 90))
        for block in result["future_blocks"]:
            self.assertGreaterEqual(datetime.fromisoformat(block["start"].replace("Z", "+00:00")).hour, 9)
            self.assertLessEqual(block["end"], "2026-11-11T12:00:00Z")

    def test_availability_validation(self):
        valid = {"timezone": "UTC", "wake_up": "07:00", "bedtime": "22:00", "fixed_events": []}
        for key, value in (("timezone", "Mars/Olympus"), ("timezone", None),
                           ("wake_up", "7:00"), ("bedtime", "25:00"),
                           ("bedtime", "06:00"), ("fixed_events", {})):
            payload = initial_request()
            payload["availability"] = {**valid, key: value}
            with self.subTest(key=key, value=value):
                status, _, body = self.request(payload)
                self.assertEqual(status, 400)
                self.assertIn("error", body)

    def test_zero_remaining_and_cutoff_boundary(self):
        payload = initial_request()
        initial = self.request(payload)[2]
        payload.update(remaining_minutes=0, now=initial["future_blocks"][1]["start"],
                       existing_blocks=initial["future_blocks"])
        status, _, result = self.request(payload)
        self.assertEqual(status, 200)
        self.assertEqual(result["past_blocks"], initial["future_blocks"][:1])
        self.assertEqual(result["future_blocks"], [])
        self.assertEqual((result["future_scheduled_minutes"], result["unscheduled_minutes"]), (0, 0))

    def test_deadline_clips_work_and_empty_windows_report_shortage(self):
        payload = initial_request()
        payload["assignment"]["deadline"] = "2026-11-10T16:30:00-08:00"
        result = self.request(payload)[2]
        self.assertEqual((result["future_scheduled_minutes"], result["unscheduled_minutes"]), (30, 210))
        payload["available_windows"] = []
        result = self.request(payload)[2]
        self.assertEqual((result["future_scheduled_minutes"], result["unscheduled_minutes"]), (0, 240))

    def test_health_and_wrong_method(self):
        self.assertEqual(self.request(method="GET", path="/health")[2], {"status": "ok"})
        self.assertEqual(self.request(method="GET")[0], 405)

    def test_readme_sample_returns_four_real_blocks(self):
        from pathlib import Path
        payload = json.loads((Path(__file__).parent / "examples" / "plan-request.json").read_text())
        status, _, result = self.request(payload)
        self.assertEqual(status, 200)
        self.assertEqual(len(result["future_blocks"]), 4)
        self.assertEqual((result["future_scheduled_minutes"], result["unscheduled_minutes"]), (240, 0))
        self.assertTrue(all(block["start"].endswith("Z") for block in result["future_blocks"]))

    def test_swagger_and_schema(self):
        self.assertEqual(self.client.get("/docs").status_code, 200)
        schema = self.client.get("/openapi.json").json()
        self.assertIn("post", schema["paths"]["/api/plan"])
        self.assertIn("PlanRequest", schema["components"]["schemas"])

    def test_body_limits_and_error_cors(self):
        for content, content_type, status in (("x" * 1_000_001, "application/json", 400),
                                             ("", "application/json", 400),
                                             ("{}", "text/plain", 415),
                                             ("{}", "application/json", 400)):
            response = self.client.post("/api/plan", content=content, headers={
                "Content-Type": content_type, "Origin": "http://localhost:3000",
            })
            self.assertEqual(response.status_code, status)
            self.assertEqual(response.headers["access-control-allow-origin"], "http://localhost:3000")
            self.assertIn("error", response.json())

    def test_unknown_fields_and_blank_titles_are_rejected(self):
        for payload in ({**initial_request(), "tasks": []},
                        {**initial_request(), "assignment": {"title": "   ", "deadline": "2026-11-13T00:00:00Z"}}):
            response = self.client.post("/api/plan", json=payload)
            self.assertEqual(response.status_code, 400)
            self.assertTrue(response.json()["details"])


if __name__ == "__main__":
    unittest.main()
