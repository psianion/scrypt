import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: ".",
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        // Split heavy vendor groups into their own chunks so the initial
        // payload for /notes, /journal, /tasks etc. doesn't include code
        // users only need when they actually open /graph or an editor.
        manualChunks: {
          // d3 force + zoom + drag + selection — only loaded on /graph
          d3: [
            "d3",
            "d3-force",
            "d3-zoom",
            "d3-drag",
            "d3-selection",
            "d3-array",
            "d3-scale",
            "d3-shape",
            "d3-hierarchy",
          ],
          // CodeMirror — only loaded when the Editor view mounts
          codemirror: [
            "@codemirror/state",
            "@codemirror/view",
            "@codemirror/commands",
            "@codemirror/lang-markdown",
          ],
          // React + router core — stable, cache-friendly vendor group
          react: ["react", "react-dom", "react-router"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3777",
      "/ws": { target: "ws://localhost:3777", ws: true },
    },
  },
});
