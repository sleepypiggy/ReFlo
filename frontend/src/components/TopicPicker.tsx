import type { Topic } from "@/datatypes";
import { TOPIC_COLORS, pickerColor, type TopicSelection } from "@/lib/topics";

export default function TopicPicker({ topics, value, onChange }: {
  topics: Topic[];
  value: TopicSelection;
  onChange: (value: TopicSelection) => void;
}) {
  return (
    <>
      <label>
        Class / topic
        <select value={value.id} onChange={(event) => {
          const id = event.target.value;
          onChange({ ...value, id, color: topics.find((topic) => topic.id === id)?.color ?? (id ? "blue" : undefined) });
        }}>
          <option value="">No topic</option>
          {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
          <option value="__new__">+ Create a topic</option>
        </select>
      </label>
      {value.id === "__new__" && (
        <label>
          Topic name
          <input value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })}
            maxLength={80} required placeholder="e.g. CPSC 210" />
        </label>
      )}
      <fieldset className="topic-colors">
        <legend>{value.id ? "Topic color" : "Color"}</legend>
        <div className="topic-swatches">
          {!value.id && <button className="topic-default button compact" type="button"
            aria-pressed={!value.color} onClick={() => onChange({ ...value, color: undefined })}>Default</button>}
          {TOPIC_COLORS.map((color) => (
            <button key={color} type="button" className={`topic-swatch topic-${color}`}
              aria-label={color[0].toUpperCase() + color.slice(1)}
              aria-pressed={value.color === color}
              onClick={() => onChange({ ...value, color })}>
              <span aria-hidden="true">{value.color === color ? "✓" : ""}</span>
            </button>
          ))}
        </div>
        <label className="custom-color-control">
          Custom color
          <span className="custom-color-inputs">
            <input type="color" aria-label="Choose custom color" value={pickerColor(value.color)}
              onChange={(event) => onChange({ ...value, color: event.target.value as `#${string}` })} />
            <span className="muted small">{value.color?.startsWith("#") ? value.color.toUpperCase() : "Choose any color"}</span>
          </span>
        </label>
        {value.id && <p className="muted small">This color applies to all assignments, events, and study sessions in this topic.</p>}
      </fieldset>
    </>
  );
}
