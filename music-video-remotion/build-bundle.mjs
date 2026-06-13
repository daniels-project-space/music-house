/**
 * Pre-build the VinylMusicVideo Remotion bundle into ./bundle (a static site).
 * The Trigger.dev cloud render serves this bundle via @remotion/renderer; no
 * nested node_modules are needed at render time. Per-job assets are supplied at
 * render time via the `publicDir` option (so we bundle with publicDir: null).
 *
 *   cd music-video-remotion && node build-bundle.mjs
 *
 * Re-run whenever the composition source changes. The output is shipped to the
 * worker by the `additionalFiles` extension in ../trigger.config.ts.
 */
import { bundle } from "@remotion/bundler";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

const serveUrl = await bundle({
  entryPoint: path.join(dir, "src", "index.ts"),
  outDir: path.join(dir, "bundle"),
  publicDir: null,
  onProgress: (p) => {
    if (p % 20 === 0) console.log(`bundling ${p}%`);
  },
});

console.log("Bundled to:", serveUrl);
