import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Two build shapes:
//   default ("npm run build")      — fetches the library from data/ at runtime.
//     Used by the dev server, the hosted website, and the Electron app (which
//     serves dist/ over a custom protocol so fetch works).
//   standalone ("--mode standalone") — inlines JS/CSS into one index.html via
//     vite-plugin-singlefile; scripts/inline-data.mjs then inlines the whole
//     library too, so the single index.html opens straight from file://.
export default defineConfig(({ mode }) => {
  const standalone = mode === "standalone";
  return {
    base: "./",
    publicDir: standalone ? false : "data",
    plugins: standalone ? [viteSingleFile()] : [],
    build: {
      outDir: standalone ? "dist-standalone" : "dist",
      emptyOutDir: true,
    },
  };
});
