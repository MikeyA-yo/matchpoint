import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Local dev: same-origin calls to /api are forwarded to the FastAPI server
    proxy: { "/api": "http://localhost:8000" },
  },
});
