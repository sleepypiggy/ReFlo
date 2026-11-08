import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Task, type Topic } from "./datatypes";
import { colorPalette, initialTopicSelection, isTopicColor, resolveTopicSelection, saveTopic } from "./lib/topics";

describe("shared assignment topics", () => {
  const computerScience: Topic = { id: "cpsc", name: "CPSC 210", color: "blue" };

  it("creates a reusable topic and trims its name without mutating the list", () => {
    const original: Topic[] = [];
    const result = saveTopic(original, { ...computerScience, name: "  CPSC 210  " });
    assert.deepEqual(result, [computerScience]);
    assert.deepEqual(original, []);
  });

  it("recolors one shared topic while preserving other topics and assignment links", () => {
    const math: Topic = { id: "math", name: "MATH 200", color: "gold" };
    const original = Object.freeze([Object.freeze({ ...computerScience }), math]);
    const result = saveTopic(original, { ...computerScience, color: "purple" });
    assert.equal(result.length, 2);
    assert.deepEqual(result[0], { ...computerScience, color: "purple" });
    assert.strictEqual(result[1], math);
    assert.equal(original[0].color, "blue");
    assert.equal(result[0].id, original[0].id);
  });

  it("rejects duplicate topic names regardless of case or surrounding whitespace", () => {
    assert.throws(() => saveTopic([computerScience], {
      id: "duplicate", name: " cpsc 210 ", color: "green",
    }), /already exists/);
    assert.equal(saveTopic([computerScience], { ...computerScience, color: "rose" })[0].color, "rose");
  });

  it("rejects invalid names, IDs and colors", () => {
    for (const invalid of [
      { ...computerScience, name: "   " },
      { ...computerScience, name: "a".repeat(81) },
      { ...computerScience, id: "" },
      { ...computerScience, color: "invalid" as Topic["color"] },
    ]) {
      assert.throws(() => saveTopic([], invalid), /topic name/);
    }
  });

  it("preserves the topic link when a saved assignment is reconstructed", () => {
    const task = new Task({ id: "assignment", name: "Problem set", estimatedTimeMinutes: 90,
      deadline: new Date("2026-11-20T23:00:00Z"), gradeWeight: 15, topicId: "cpsc" });
    const saved = JSON.parse(JSON.stringify(task));
    const restored = new Task({ ...saved, deadline: new Date(saved.deadline) });
    assert.equal(restored.topicId, "cpsc");
    assert.equal(restored.remainingTimeMinutes, 90);
    assert.equal(new Task({ ...task, topicId: undefined }).topicId, undefined);
  });

  it("accepts arbitrary six-digit colors and rejects malformed or injected CSS", () => {
    for (const color of ["#123abc", "#FFFFFF", "#000000", "#ff00a8"]) {
      assert.ok(isTopicColor(color));
      assert.equal(saveTopic([], { ...computerScience, color: color as `#${string}` })[0].color, color);
    }
    for (const color of ["#123", "#zzzzzz", "red", "#123456;display:none", "url(example)", null]) {
      assert.equal(isTopicColor(color), false);
    }
  });

  it("supports an independent color or default without creating a topic", () => {
    const topics = [computerScience];
    assert.deepEqual(resolveTopicSelection(topics, { id: "", name: "", color: "#f19143" }), {
      topics, topicId: undefined, color: "#f19143",
    });
    assert.deepEqual(resolveTopicSelection(topics, { id: "", name: "" }), {
      topics, topicId: undefined, color: undefined,
    });
  });

  it("creates custom-color topics for reuse across events and assignments", () => {
    const created = resolveTopicSelection([], { id: "__new__", name: "  Physics  ", color: "#137ac9" });
    assert.ok(created.topicId);
    assert.equal(created.topics[0].name, "Physics");
    assert.equal(created.topics[0].color, "#137ac9");
    const reused = initialTopicSelection(created.topics, created.topicId);
    assert.equal(reused.color, "#137ac9");
    assert.equal(reused.id, created.topicId);
  });

  it("recolors a shared topic without storing an item-specific override", () => {
    const result = resolveTopicSelection([computerScience], { id: "cpsc", name: "", color: "#bc44ad" });
    assert.equal(result.topics[0].color, "#bc44ad");
    assert.equal(result.topicId, "cpsc");
    assert.equal(result.color, undefined);
    assert.equal(initialTopicSelection(result.topics, "cpsc", "gold").color, "#bc44ad");
  });

  it("rejects a missing topic and invalid standalone color", () => {
    assert.throws(() => resolveTopicSelection([], { id: "missing", name: "", color: "blue" }), /existing topic/);
    assert.throws(() => resolveTopicSelection([], { id: "", name: "", color: "#oops" }), /valid six-digit/);
  });

  it("uses theme-aware muted backgrounds and readable text for custom colors", () => {
    assert.deepEqual(colorPalette("blue"), { background: "var(--lecture-bg)", foreground: "var(--lecture-ink)" });
    for (const color of ["#ffffff", "#000000", "#00ff00"] as const) {
      const palette = colorPalette(color);
      assert.ok(palette.background.includes("var(--surface-raised)"));
      assert.ok(palette.foreground.includes("var(--ink)"));
    }
  });
});
