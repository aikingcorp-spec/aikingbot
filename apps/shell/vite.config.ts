// Copyright (c) 2026 AIKING. All rights reserved.

import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
	root: import.meta.dirname,
	plugins: [solid()],
	server: { port: 5173, proxy: { "/api": "http://127.0.0.1:4317" } },
	build: { outDir: "dist", emptyOutDir: true },
});
