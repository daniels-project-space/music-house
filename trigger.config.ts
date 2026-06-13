import { defineConfig } from "@trigger.dev/sdk/v3";
import { playwright } from "@trigger.dev/build/extensions/playwright";
import { ffmpeg, additionalPackages, additionalFiles } from "@trigger.dev/build/extensions/core";

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
    // @remotion/renderer must stay external: bundling it breaks the dynamic
    // require of its platform-native compositor binary. Kept in node_modules so
    // the optional @remotion/compositor-linux-x64-gnu resolves at runtime.
    external: ["playwright-core", "playwright", "@remotion/renderer", "@remotion/compositor-linux-x64-gnu"],
    extensions: [
      // headless: false installs FULL chromium + headless-shell + Xvfb and sets
      // DISPLAY=:99 in the image — needed for the DistroKid headed path (Cloudflare).
      // Existing headless tasks are unaffected (shell still installed).
      playwright({ browsers: ["chromium"], headless: false }),
      ffmpeg(),
      additionalPackages({ packages: ["curl"] }),
      // Ship the prebuilt VinylMusicVideo Remotion bundle into the worker so the
      // music-video-render task can serve it via @remotion/renderer (no nested
      // node_modules at runtime). Rebuild with music-video-remotion/build-bundle.mjs.
      additionalFiles({ files: ["music-video-remotion/bundle/**"] }),
    ],
  },
});
