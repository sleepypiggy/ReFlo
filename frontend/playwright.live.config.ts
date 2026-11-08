import { defineConfig } from "@playwright/test";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const python = path.join(root, "backend", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

export default defineConfig({
  testDir: "./tests",
  testMatch: "live-backend.spec.ts",
  outputDir: "./test-results/live",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:3101",
    timezoneId: "America/Vancouver",
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `"${python}" -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8100`,
      cwd: root,
      env: { CORS_ORIGINS: '["http://127.0.0.1:3101"]' },
      url: "http://127.0.0.1:8100/health",
      timeout: 30000,
    },
    {
      command: "npm run dev -- --port 3101",
      env: { NEXT_PUBLIC_API_URL: "http://127.0.0.1:8100" },
      url: "http://127.0.0.1:3101",
      timeout: 90000,
    },
  ],
});
