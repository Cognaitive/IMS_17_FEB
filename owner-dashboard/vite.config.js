import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In production set VITE_API_URL to the API origin; locally /api is proxied to the backend
// (API_PROXY=http://localhost:5055 if port 5000 is taken, e.g. by macOS AirPlay Receiver).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: { "/api": process.env.API_PROXY || "http://localhost:5000" },
  },
});
