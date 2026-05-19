import { defineConfig } from "@trigger.dev/sdk/v3";
import { playwright } from "@trigger.dev/build/extensions/playwright";
import { ffmpeg, additionalPackages } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  // Hardcoded: env-fallback silently deployed to phantom project
  project: "proj_ukkzrxclaoncuvhvqpud",
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
      // Bundle chromium. The Trigger build extension's setup script auto-installs the
      // headless-shell variant when headless: true is set, no need to list it explicitly.
      playwright({ browsers: ["chromium"], headless: true }),
      ffmpeg(),
      additionalPackages({ packages: ["curl"] }),
    ],
  },
});
