#!/usr/bin/env node
/**
 * Always remove `.next` before starting the dev server so Webpack/Turbopack cannot
 * serve a stale chunk graph (`Cannot find module './611.js'`). Cross-platform (Node fs).
 */
import { createRequire } from "node:module";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dotNext = path.join(root, ".next");

if (existsSync(dotNext)) {
  rmSync(dotNext, { recursive: true, force: true });
}

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const child = spawn(process.execPath, [nextBin, "dev", "--turbopack"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
