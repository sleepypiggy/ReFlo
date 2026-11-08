import type { Topic, TopicColor } from "../datatypes";

export const TOPIC_COLORS: readonly TopicColor[] = ["blue", "green", "gold", "purple", "rose"];

export function isTopicColor(value: unknown): value is TopicColor {
  return TOPIC_COLORS.some((color) => color === value) ||
    (typeof value === "string" && /^#[\da-f]{6}$/i.test(value));
}

export interface TopicSelection {
  id: string;
  name: string;
  color?: TopicColor;
}

export function initialTopicSelection(topics: readonly Topic[], topicId?: string, color?: TopicColor): TopicSelection {
  return { id: topicId ?? "", name: "", color: topics.find((topic) => topic.id === topicId)?.color ?? color };
}

/** Save shared colors together with the assignment/event that uses them. */
export function resolveTopicSelection(topics: Topic[], selection: TopicSelection) {
  if (selection.color !== undefined && !isTopicColor(selection.color)) {
    throw new Error("Choose a preset or a valid six-digit hex color.");
  }
  if (!selection.id) return { topics, topicId: undefined, color: selection.color };
  const existing = topics.find((topic) => topic.id === selection.id);
  if (selection.id !== "__new__" && !existing) throw new Error("Select an existing topic or create a new one.");
  const topicId = existing?.id ?? crypto.randomUUID();
  return {
    topics: saveTopic(topics, { id: topicId, name: existing?.name ?? selection.name, color: selection.color ?? "blue" }),
    topicId,
    color: undefined,
  };
}

const PALETTES = {
  blue: ["lecture", "#497fc4"], green: ["study", "#42825b"], gold: ["assignment", "#bd8c3c"],
  purple: ["personal", "#8a65bb"], rose: ["unfinished", "#ba626a"],
} as const;

export function colorPalette(color: TopicColor) {
  if (color.startsWith("#")) {
    if (!isTopicColor(color)) throw new Error("Invalid custom color.");
    return {
      background: `color-mix(in srgb, ${color} 18%, var(--surface-raised))`,
      foreground: `color-mix(in srgb, ${color} 25%, var(--ink))`,
    };
  }
  const category = PALETTES[color as keyof typeof PALETTES][0];
  return { background: `var(--${category}-bg)`, foreground: `var(--${category}-ink)` };
}

export function pickerColor(color?: TopicColor) {
  return color?.startsWith("#") ? color : PALETTES[(color ?? "blue") as keyof typeof PALETTES][1];
}

export function topicAppearance(color?: TopicColor) {
  return {
    className: color ? color.startsWith("#") ? "topic-custom" : `topic-${color}` : "",
    style: color?.startsWith("#") ? { "--custom-topic-color": color } : undefined,
  };
}

/** Topics are shared by ID, so recoloring never changes assignment links. */
export function saveTopic(topics: readonly Topic[], input: Topic): Topic[] {
  const name = input.name.trim();
  if (!input.id || !name || name.length > 80 || !isTopicColor(input.color)) {
    throw new Error("Enter a topic name (up to 80 characters) and choose a color.");
  }
  if (topics.some((topic) => topic.id !== input.id && topic.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new Error("That topic already exists. Select it from the list.");
  }
  const topic = { ...input, name };
  return topics.some((existing) => existing.id === topic.id)
    ? topics.map((existing) => existing.id === topic.id ? topic : existing)
    : [...topics, topic];
}
