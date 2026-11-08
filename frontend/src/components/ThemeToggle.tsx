"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

const subscribe = (callback: () => void) => {
  window.addEventListener("schedule-theme-change", callback);
  return () => window.removeEventListener("schedule-theme-change", callback);
};
const snapshot = () => document.documentElement.dataset.theme === "dark";
const serverSnapshot = () => false;

export default function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const label = dark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={dark}
      onClick={() => {
        const theme = dark ? "light" : "dark";
        document.documentElement.dataset.theme = theme;
        try {
          localStorage.setItem("schedule-maker-theme", theme);
        } catch {
          // The current visit can still change theme when storage is unavailable.
        }
        window.dispatchEvent(new Event("schedule-theme-change"));
      }}
    >
      <span className={`theme-option ${dark ? "" : "is-selected"}`}><Sun size={19} /></span>
      <span className={`theme-option ${dark ? "is-selected" : ""}`}><Moon size={19} /></span>
    </button>
  );
}
