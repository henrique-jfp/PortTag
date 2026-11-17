import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
﻿import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      input: {
        admin: resolve(projectRoot, "index.html"),
        manager: resolve(projectRoot, "manager.html"),
        porter: resolve(projectRoot, "porter.html"),
      },
    },
  },
});
