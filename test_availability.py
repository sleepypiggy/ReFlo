"""Behavior checks for free-window generation; standard library only."""

import unittest
from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

from availability import available_study_windows
from scheduler import Window


def dt(day, hour, minute=0):
    return datetime(2026, 11, day, hour, minute)


class AvailabilityTests(unittest.TestCase):
    def evening(self, events):
        return available_study_windows(
            dt(12, 18, 15), dt(12, 19, 15), time(7), time(22), events
        )

    def test_shift_splits_window(self):
        self.assertEqual(self.evening([Window(dt(12, 18, 30), dt(12, 19))]), (
            Window(dt(12, 18, 15), dt(12, 18, 30)),
            Window(dt(12, 19), dt(12, 19, 15)),
        ))

    def test_shift_covers_entire_window(self):
        for event in (Window(dt(12, 18, 15), dt(12, 19, 15)),
                      Window(dt(12, 18), dt(12, 20))):
            with self.subTest(event=event):
                self.assertEqual(self.evening([event]), ())

    def test_overlapping_shifts(self):
        # Deliberately unsorted: their union is 18:30–19:00.
        self.assertEqual(self.evening([
            Window(dt(12, 18, 45), dt(12, 19)),
            Window(dt(12, 18, 30), dt(12, 18, 50)),
        ]), (
            Window(dt(12, 18, 15), dt(12, 18, 30)),
            Window(dt(12, 19), dt(12, 19, 15)),
        ))

    def test_daily_hours_and_range_clipping(self):
        self.assertEqual(available_study_windows(
            dt(10, 18), dt(12, 10), time(9), time(19), []
        ), (
            Window(dt(10, 18), dt(10, 19)),
            Window(dt(11, 9), dt(11, 19)),
            Window(dt(12, 9), dt(12, 10)),
        ))

    def test_cross_day_event(self):
        self.assertEqual(available_study_windows(
            dt(10, 0), dt(12, 0), time(9), time(19),
            [Window(dt(10, 18), dt(11, 10))],
        ), (Window(dt(10, 9), dt(10, 18)), Window(dt(11, 10), dt(11, 19))))

    def test_touching_duplicate_and_outside_events(self):
        events = [
            Window(dt(12, 18, 30), dt(12, 18, 45)),
            Window(dt(12, 18, 30), dt(12, 18, 45)),
            Window(dt(12, 18, 45), dt(12, 19)),
            Window(dt(12, 17), dt(12, 18, 15)),
            Window(dt(12, 19, 15), dt(12, 20)),
        ]
        original = list(events)
        self.assertEqual(self.evening(iter(events)), (
            Window(dt(12, 18, 15), dt(12, 18, 30)),
            Window(dt(12, 19), dt(12, 19, 15)),
        ))
        self.assertEqual(events, original)

    def test_no_waking_time_in_range(self):
        self.assertEqual(available_study_windows(
            dt(12, 0), dt(12, 6), time(7), time(22), []
        ), ())

    def test_timezone_aware_events(self):
        zone = ZoneInfo("America/Vancouver")
        start = dt(12, 18, 15).replace(tzinfo=zone)
        end = dt(12, 19, 15).replace(tzinfo=zone)
        event = Window(
            dt(12, 18, 30).replace(tzinfo=zone).astimezone(timezone.utc),
            dt(12, 19).replace(tzinfo=zone).astimezone(timezone.utc),
        )
        self.assertEqual(available_study_windows(start, end, time(7), time(22), [event]), (
            Window(start, dt(12, 18, 30).replace(tzinfo=zone)),
            Window(dt(12, 19).replace(tzinfo=zone), end),
        ))

    def test_invalid_inputs(self):
        cases = [
            (dt(12, 19), dt(12, 18), time(7), time(22), []),
            (dt(12, 18), dt(12, 18), time(7), time(22), []),
            (dt(12, 18), dt(12, 19), time(22), time(7), []),
            (dt(12, 18), dt(12, 19), time(7), time(7), []),
            (dt(12, 18), dt(12, 19), time(7, tzinfo=timezone.utc), time(22), []),
            (dt(12, 18), dt(12, 19).replace(tzinfo=timezone.utc), time(7), time(22), []),
            (dt(12, 18), dt(12, 19), time(7), time(22),
             [Window(dt(12, 19), dt(12, 18))]),
            (dt(12, 18), dt(12, 19), time(7), time(22),
             [Window(dt(12, 18).replace(tzinfo=timezone.utc),
                     dt(12, 19).replace(tzinfo=timezone.utc))]),
        ]
        for args in cases:
            with self.subTest(args=args), self.assertRaises(ValueError):
                available_study_windows(*args)


if __name__ == "__main__":
    unittest.main()
