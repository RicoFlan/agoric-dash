#!/usr/bin/env node
/**
 * After `next build`, starts `next start` on a free port, checks HTTP, then exits.
 * Catches broken server bundles; does not use `next dev` (dev chunk bugs are separate).
 *
 * Env:
 *   SMOKE_PORT  — port (default 3999)
 *   SMOKE_API=1 — also require GET /api/metrics 200 (needs working DATABASE_URL)
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const port = process.env.SMOKE_PORT ?? "3999";
const base = `http://127.0.0.1:${port}`;
const checkApi = process.env.SMOKE_API === "1";

async function get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  return res;
}

async function waitForReady() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await get(`${base}/`);
      if (res.ok) return;
    } catch {
      await delay(300);
    }
  }
  throw new Error(`Server at ${base} did not respond with OK within 60s`);
}

const child = spawn("npx", ["next", "start", "-p", port], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env },
});

let exitCode = 1;
try {
  await waitForReady();

  const home = await get(`${base}/`);
  if (!home.ok) throw new Error(`GET / expected 200, got ${home.status}`);

  if (checkApi) {
    const apiUrl = `${base}/api/metrics?from=2020-01-01&to=2020-01-02&granularity=day`;
    const api = await get(apiUrl);
    if (!api.ok) {
      const body = await api.text();
      throw new Error(`GET /api/metrics expected 200, got ${api.status}: ${body.slice(0, 300)}`);
    }
  }

  console.log(
    checkApi
      ? "smoke: ok (GET /, GET /api/metrics)"
      : "smoke: ok (GET /; set SMOKE_API=1 to assert /api/metrics too)"
  );
  exitCode = 0;
} catch (e) {
  console.error("smoke: failed:", e instanceof Error ? e.message : e);
  exitCode = 1;
} finally {
  child.kill("SIGTERM");
  await delay(400);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
}

process.exit(exitCode);
