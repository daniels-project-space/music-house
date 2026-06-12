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
      // headless: false installs FULL chromium + headless-shell + Xvfb and sets
      // DISPLAY=:99 in the image — needed for the DistroKid headed path (Cloudflare).
      // Existing headless tasks are unaffected (shell still installed).
      playwright({ browsers: ["chromium"], headless: false }),
      ffmpeg(),
      additionalPackages({ packages: ["curl"] }),
    ],
  },
});
