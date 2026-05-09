import { defineConfig } from "@trigger.dev/sdk/v3";
import { playwright } from "@trigger.dev/build/extensions/playwright";
import { ffmpeg, additionalPackages } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "",
  runtime: "node",
  logLevel: "log",
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2, randomize: true },
  },
  dirs: ["./src/trigger"],
  build: {
    external: ["playwright-core", "playwright"],
    extensions: [
      playwright({ browsers: ["chromium"], headless: true }),
      ffmpeg(),
      additionalPackages({ packages: ["curl"] }),
    ],
  },
});
