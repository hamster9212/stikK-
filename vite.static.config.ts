import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/stikK-/",
  plugins: [react()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
});
