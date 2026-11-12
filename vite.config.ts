import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1433, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/streamdeck/**"] } },
  build: { target: "chrome110", minify: "esbuild", cssMinify: true },
});
