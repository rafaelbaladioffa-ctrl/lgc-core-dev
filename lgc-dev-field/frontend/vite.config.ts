import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: ["projetosconsultimer.com", "localhost"],
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
});
