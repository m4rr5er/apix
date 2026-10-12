import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and must not clear the screen so Rust logs stay visible.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "chrome105",
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      // Two windows, two documents. `tray-menu.html` is the tray popup's own
      // page, so the menu never loads the app shell's markup or components.
      input: {
        main: "index.html",
        tray: "tray-menu.html",
      },
    },
  },
});
