"""Exercise the JSON contract over a real local HTTP connection."""

import copy
import http.client
import json
import threading
import unittest
from http.server import ThreadingHTTPServer

from api import PlanHandler


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


class QuietHandler(PlanHandler):
    def log_message(self, *args):
        pass


class APITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, payload=None, method="POST", path="/api/plan", origin="http://localhost:3000",
                content_type="application/json", raw=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        try:
            connection.request(method, path, body=raw if raw is not None else json.dumps(payload),
                               headers={"Content-Type": content_type, "Origin": origin})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), json.loads(response.read())
        finally:
            connection.close()

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


if __name__ == "__main__":
    unittest.main()
