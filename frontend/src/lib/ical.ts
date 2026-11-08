import ICAL from "ical.js";
import { Temporal } from "temporal-polyfill";
import type { Event, Schedule } from "../datatypes";

export const CALENDAR_LIMITS = { bytes: 1_000_000, events: 1000, days: 366 };
type Component = InstanceType<typeof ICAL.Component>;
type Time = InstanceType<typeof ICAL.Time>;
type Property = InstanceType<typeof ICAL.Property>;
export interface CalendarPreview {
  events: Event[];
  warnings: string[];
}
const message = (error: unknown) => error instanceof Error ? error.message : "Malformed event";
const value = (component: Component, name: string) => String(component.getFirstPropertyValue(name) ?? "");

function one(component: Component, name: string): Property {
  const properties = component.getAllProperties(name);
  if (properties.length !== 1) throw new Error(`Exactly one ${name.toUpperCase()} is required.`);
  return properties[0];
}

function zone(property: Property, time: Time): string {
  if (time.isDate) throw new Error("All-day dates are unsupported; use timed events.");
  const tzid = property.getParameter("tzid");
  if (time.zone === ICAL.Timezone.utcTimezone) {
    if (tzid) throw new Error("UTC timestamps must not also specify TZID.");
    return "UTC";
  }
  if (typeof tzid !== "string" || !tzid) throw new Error("Floating times have no timezone. Export with UTC or an IANA TZID.");
  try { new Intl.DateTimeFormat("en", { timeZone: tzid }); }
  catch { throw new Error(`Unknown or unsupported timezone: ${tzid}. Export using an IANA timezone or UTC.`); }
  return tzid;
}

function instant(time: Time, timezone: string): Date {
  let date: Date;
  try {
    // ICAL.Time can normalize invalid dates, so parse its original fields with
    // Temporal's strict overflow checks before any conversion/iteration.
    const local = Temporal.PlainDateTime.from({ year: time.year, month: time.month, day: time.day,
      hour: time.hour, minute: time.minute, second: time.second }, { overflow: "reject" });
    date = new Date(local.toZonedDateTime(timezone, { disambiguation: "reject" }).epochMilliseconds);
  } catch { throw new Error(`Invalid, ambiguous, or nonexistent local time ${time.toString()} in ${timezone}. Use UTC for this occurrence.`); }
  if (time.zone !== ICAL.Timezone.localTimezone && time.zone !== ICAL.Timezone.utcTimezone &&
      time.toUnixTime() * 1000 !== date.getTime())
    throw new Error(`Embedded ${timezone} timezone rules disagree with IANA rules. Export UTC instants to resolve this safely.`);
  return date;
}

function timestamp(component: Component, name: string) {
  const property = one(component, name);
  validateDates(property);
  const time = property.getFirstValue();
  if (!(time instanceof ICAL.Time)) throw new Error(`Invalid ${name.toUpperCase()}.`);
  const timezone = zone(property, time);
  return { time, timezone, date: instant(time, timezone) };
}

function validateDates(property: Property) {
  for (const raw of property.toJSON().slice(3)) {
    if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\dZ?$/.test(raw))
      throw new Error(`Invalid or unsupported ${property.name.toUpperCase()} date-time; timed events are required.`);
    try {
      const parsed = Temporal.PlainDateTime.from(raw.replace(/Z$/, ""), { overflow: "reject" });
      if (parsed.year < 2 || parsed.year > 9997) throw new Error();
    }
    catch { throw new Error(`Invalid ${property.name.toUpperCase()} date-time.`); }
  }
}

function checkFeatures(component: Component) {
  if (component.hasProperty("status") && !["TENTATIVE", "CONFIRMED", "CANCELLED"].includes(value(component, "status")))
    throw new Error("Invalid event STATUS.");
  if (component.hasProperty("transp") && !["OPAQUE", "TRANSPARENT"].includes(value(component, "transp")))
    throw new Error("Invalid event TRANSP.");
  for (const name of ["rdate", "exrule", "duration"]) {
    if (component.hasProperty(name)) throw new Error(`${name.toUpperCase()} is unsupported; export explicit DTSTART/DTEND events or bounded weekly classes.`);
  }
  for (const name of ["uid", "summary", "status", "transp", "recurrence-id"]) {
    if (component.getAllProperties(name).length > 1) throw new Error(`Duplicate ${name.toUpperCase()}.`);
  }
  if (component.getFirstProperty("recurrence-id")?.getParameter("range"))
    throw new Error("RECURRENCE-ID RANGE (this and future) is unsupported.");
  if (component.hasProperty("rrule") && component.hasProperty("recurrence-id"))
    throw new Error("Occurrence overrides cannot contain RRULE.");
  if (component.hasProperty("exdate") && component.hasProperty("recurrence-id"))
    throw new Error("Occurrence overrides cannot contain EXDATE.");
}

/** Expand complete, bounded series. Never commit a partial series on failure. */
function expandSeries(components: Component[]): { events: Omit<Event, "id">[]; keys: string[] } {
  components.forEach(checkFeatures);
  const masters = components.filter(c => !c.hasProperty("recurrence-id"));
  if (masters.length !== 1) throw new Error("Missing or duplicate master event for this UID.");
  const master = masters[0];
  if (value(master, "status") === "CANCELLED") return { events: [], keys: [] };
  if (value(master, "transp") === "TRANSPARENT") throw new Error("Transparent/free events are not fixed commitments.");
  const start = timestamp(master, "dtstart"), end = timestamp(master, "dtend");
  const duration = end.date.getTime() - start.date.getTime();
  if (duration <= 0) throw new Error("DTEND must be after DTSTART.");
  const title = value(master, "summary").trim();
  if (!title) throw new Error("SUMMARY (event title) is required.");
  const rules = master.getAllProperties("rrule");
  if (rules.length > 1) throw new Error("Multiple recurrence rules are unsupported.");
  const starts: Time[] = [];
  if (rules.length) {
    const raw = rules[0].toICALString().slice(6);
    const fields = raw.split(";").map(part => part.split("="));
    const allowed = ["FREQ", "INTERVAL", "BYDAY", "WKST", "COUNT", "UNTIL"];
    if (fields.some(([key]) => !allowed.includes(key)) || new Set(fields.map(([key]) => key)).size !== fields.length)
      throw new Error("Unsupported RRULE fields. Only weekly FREQ, INTERVAL, BYDAY, WKST, COUNT and UNTIL are supported.");
    const rule = rules[0].getFirstValue();
    if (!(rule instanceof ICAL.Recur) || rule.freq !== "WEEKLY") throw new Error("Only weekly recurrence is supported.");
    const fieldsMap = Object.fromEntries(fields);
    if (fieldsMap.BYDAY && !/^(SU|MO|TU|WE|TH|FR|SA)(,(SU|MO|TU|WE|TH|FR|SA))*$/.test(fieldsMap.BYDAY))
      throw new Error("Only plain weekly weekdays are supported (no ordinal BYDAY).");
    if (fieldsMap.WKST && !/^(SU|MO|TU|WE|TH|FR|SA)$/.test(fieldsMap.WKST)) throw new Error("Invalid WKST.");
    for (const name of ["COUNT", "INTERVAL"]) {
      if (fieldsMap[name] && (!/^\d+$/.test(fieldsMap[name]) || Number(fieldsMap[name]) < 1 || Number(fieldsMap[name]) > 1000))
        throw new Error(`Invalid or excessive ${name}; limit is 1000.`);
    }
    if ((!rule.count && !rule.until) || (rule.count && rule.until)) throw new Error("Weekly classes need exactly one COUNT or UNTIL end. Unbounded series are unsupported.");
    const until = rule.until;
    if (until && (until.isDate || until.zone !== ICAL.Timezone.utcTimezone)) throw new Error("UNTIL must be a UTC date-time ending in Z.");
    const untilDate = until ? instant(until, "UTC") : undefined;
    if (untilDate && untilDate < start.date) throw new Error("UNTIL precedes DTSTART.");
    // Iterate local wall times, comparing UNTIL using real instants. The parser
    // deliberately does not supply a global timezone database to ICAL.js.
    const iteratorRule = rule.clone();
    iteratorRule.until = null;
    const iterator = iteratorRule.iterator(start.time.clone());
    for (let i = 0; ; i++) {
      if (i > CALENDAR_LIMITS.events) throw new Error("Recurrence exceeds 1000 occurrences.");
      const occurrence = iterator.next();
      if (!occurrence) break;
      const date = instant(occurrence, start.timezone);
      if (untilDate && date > untilDate) break;
      if (date.getTime() - start.date.getTime() > CALENDAR_LIMITS.days * 86400000)
        throw new Error("Recurring classes must span at most 366 days. Export a shorter, bounded term.");
      starts.push(occurrence.clone());
    }
    if (!starts.some(t => instant(t, start.timezone).getTime() === start.date.getTime()))
      throw new Error("DTSTART does not match the weekly recurrence rule.");
  } else {
    if (master.hasProperty("exdate") || components.length > 1) throw new Error("Exceptions require a weekly master RRULE.");
    starts.push(start.time);
  }
  const excluded = new Set<number>();
  for (const property of master.getAllProperties("exdate")) {
    validateDates(property);
    for (const time of property.getValues()) {
      if (!(time instanceof ICAL.Time)) throw new Error("Invalid EXDATE.");
      excluded.add(instant(time, zone(property, time)).getTime());
    }
  }
  const overrides = new Map<number, Component>();
  for (const component of components.filter(c => c !== master)) {
    const key = timestamp(component, "recurrence-id").date.getTime();
    if (overrides.has(key) || excluded.has(key)) throw new Error("Conflicting occurrence exceptions.");
    overrides.set(key, component);
  }
  const validKeys = new Set(starts.map(t => instant(t, start.timezone).getTime()));
  if ([...excluded, ...overrides.keys()].some(key => !validKeys.has(key)))
    throw new Error("An occurrence exception does not match this recurrence series.");
  const events: Omit<Event, "id">[] = [], keys: string[] = [];
  for (const time of starts) {
    const original = instant(time, start.timezone);
    const override = overrides.get(original.getTime());
    if (excluded.has(original.getTime()) || (override && value(override, "status") === "CANCELLED")) continue;
    if (override && value(override, "transp") === "TRANSPARENT") throw new Error("Transparent overrides are unsupported.");
    const movedStart = override ? timestamp(override, "dtstart") : undefined;
    const from = movedStart?.date ?? original;
    const to = override ? timestamp(override, "dtend").date : new Date(from.getTime() + duration);
    if (to <= from) throw new Error("Occurrence ends before it starts.");
    const uid = value(master, "uid");
    keys.push(JSON.stringify([uid, rules.length ? original.toISOString() : "single"]));
    events.push({ name: (override && value(override, "summary").trim()) || title,
      startTime: from, endTime: to, timeMinutes: Math.max(1, Math.round((+to - +from) / 60000)),
      remainingTimeMinutes: Math.max(1, Math.round((+to - +from) / 60000)),
      calendarImport: { uid, recurrenceId: rules.length ? original.toISOString() : undefined,
        timezone: movedStart?.timezone ?? start.timezone } });
  }
  return { events, keys };
}

export async function previewCalendar(text: string): Promise<CalendarPreview> {
  if (new TextEncoder().encode(text).length > CALENDAR_LIMITS.bytes) throw new Error("Calendar files must be under 1 MB.");
  // Validate before parsing: ICAL.js normalizes INTERVAL=0 and duplicate rule
  // fields, which would otherwise turn malformed input into a different rule.
  for (const line of text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    if (!/^RRULE:/i.test(line)) continue;
    const fields = line.slice(6).toUpperCase().split(";").map(part => part.split("="));
    if (fields.some(field => field.length !== 2 || !field[1]) || new Set(fields.map(([key]) => key)).size !== fields.length)
      throw new Error("Malformed RRULE: empty or duplicate rule fields. Nothing has been imported.");
    for (const [key, val] of fields) {
      if (["COUNT", "INTERVAL"].includes(key) && (!/^\d+$/.test(val) || Number(val) < 1))
        throw new Error(`Malformed RRULE: ${key} must be a positive integer.`);
      if (key === "UNTIL") {
        if (!/^\d{8}T\d{6}Z$/.test(val)) throw new Error("RRULE UNTIL must be a valid UTC date-time ending in Z.");
        validateDates(ICAL.Property.fromString(`DTSTART:${val}`));
      }
    }
  }
  let calendar: Component;
  try {
    if (!/^BEGIN:VCALENDAR\r?\n/i.test(text.trim()) || !/\r?\nEND:VCALENDAR$/i.test(text.trim())) throw new Error();
    calendar = new ICAL.Component(ICAL.parse(text.trim()));
    if (calendar.name !== "vcalendar" || value(calendar, "version") !== "2.0") throw new Error();
  } catch { throw new Error("Invalid iCalendar file. Choose a complete VERSION:2.0 .ics calendar."); }
  if (calendar.hasProperty("method") && value(calendar, "method") !== "PUBLISH")
    throw new Error("Calendar invitations, updates and cancellation messages are unsupported. Export a calendar snapshot instead.");
  const warnings: string[] = [];
  if (calendar.getAllSubcomponents("vevent").some(event => event.getAllSubcomponents().length))
    warnings.push("Event reminders (VALARM) and other nested components are not imported; only commitment times and titles are saved.");
  const components = calendar.getAllSubcomponents();
  if (components.length > CALENDAR_LIMITS.events) throw new Error("Calendar exceeds 1000 source events.");
  if (components.some(c => !["vevent", "vtimezone"].includes(c.name))) warnings.push("Non-event components (such as tasks or journals) are unsupported and will not be imported.");
  const groups = new Map<string, Component[]>();
  for (const component of components.filter(c => c.name === "vevent")) {
    const uid = value(component, "uid");
    if (!uid.trim()) { warnings.push(`${value(component, "summary") || "Untitled event"}: Missing UID; not imported.`); continue; }
    groups.set(uid, [...(groups.get(uid) ?? []), component]);
  }
  const events: Event[] = [];
  for (const [uid, group] of groups) {
    try {
      const expanded = expandSeries(group);
      if (events.length + expanded.events.length > CALENDAR_LIMITS.events) throw new Error("Calendar expands beyond 1000 events. Split the file; nothing has been imported.");
      const ids = await Promise.all(expanded.keys.map(async key => {
        const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
        return "ics-" + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
      }));
      events.push(...expanded.events.map((event, i) => ({ ...event, id: ids[i] })));
    } catch (error) { warnings.push(`${value(group[0], "summary") || uid}: ${message(error)} Entire series not imported.`); }
  }
  return { events, warnings };
}

/** Repeated imports skip existing identifiers, including locally edited events. */
export function importCalendarEvents(schedule: Schedule, selected: Event[]): Schedule {
  const ids = new Set(schedule.events.map(event => event.id));
  const added = selected.filter(event => { if (ids.has(event.id)) return false; ids.add(event.id); return true; });
  if (schedule.events.length + added.length > CALENDAR_LIMITS.events) throw new Error("Workspace limit is 1000 fixed commitments. Remove events or select fewer occurrences.");
  return { ...schedule, events: [...schedule.events, ...added], needsReplan: added.length ? true : schedule.needsReplan };
}

export function exportStudyCalendar(schedule: Schedule, now = new Date()): string {
  const calendar = new ICAL.Component("vcalendar");
  calendar.updatePropertyWithValue("version", "2.0");
  calendar.updatePropertyWithValue("prodid", "-//Schedule Maker//Study planner//EN");
  calendar.updatePropertyWithValue("calscale", "GREGORIAN");
  calendar.updatePropertyWithValue("method", "PUBLISH");
  for (const block of schedule.studyBlocks.filter(block => block.status === "planned" && block.endTime > now)) {
    if (!Number.isFinite(+block.startTime) || !Number.isFinite(+block.endTime) || block.endTime <= block.startTime ||
        block.startTime.getMilliseconds() || block.endTime.getMilliseconds())
      throw new Error("Calendar export requires valid session times at whole-second precision. Regenerate the schedule before exporting.");
    const task = schedule.tasks.find(task => task.id === block.taskId);
    if (!task) throw new Error("A study session references an unknown assignment.");
    const event = new ICAL.Component("vevent");
    event.updatePropertyWithValue("uid", `${block.id}@schedule-maker.local`);
    event.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(now, true));
    event.updatePropertyWithValue("dtstart", ICAL.Time.fromJSDate(block.startTime, true));
    event.updatePropertyWithValue("dtend", ICAL.Time.fromJSDate(block.endTime, true));
    event.updatePropertyWithValue("summary", task.name);
    event.updatePropertyWithValue("status", "CONFIRMED");
    event.updatePropertyWithValue("transp", "OPAQUE");
    calendar.addSubcomponent(event);
  }
  return calendar.toString() + "\r\n";
}
