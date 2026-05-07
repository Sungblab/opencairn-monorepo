import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { platform } from "node:os";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const rootEnv = loadDotenv(".env");
const childEnv = { ...rootEnv, ...process.env };
const orchestratorEnv = process.env;
const apiBase = normalizeBaseUrl(
  localApiUrlFromEnv(orchestratorEnv),
);
const apiHealthUrl = `${apiBase}/api/health`;
const requiredPorts = [
  ["api", portFromUrl(apiBase, 4000)],
  ["web", 3000],
  ["hocuspocus", Number(childEnv.HOCUSPOCUS_PORT ?? 1234)],
  ["emails", 3001],
];
const started = [];
let shuttingDown = false;

function loadDotenv(path) {
  if (!existsSync(path)) return {};

  const env = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^([^=]+)=(.*)$/.exec(line);
    if (!match) continue;

    const name = match[1].trim();
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[name] = value;
  }
  return env;
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function localApiUrlFromEnv(env) {
  const rawBaseUrl = env.INTERNAL_API_URL;
  if (rawBaseUrl) {
    try {
      const url = new URL(rawBaseUrl);
      if (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
        return url.toString();
      }
    } catch {
      // Fall through to the validated port-based localhost URL.
    }
  }

  const rawPort = env.PORT ?? "4000";
  const port = /^\d{1,5}$/.test(rawPort) ? Number(rawPort) : 4000;
  return `http://localhost:${port}`;
}

function portFromUrl(value, fallback) {
  try {
    const url = new URL(value);
    if (url.port) return Number(url.port);
    return url.protocol === "https:" ? 443 : 80;
  } catch {
    return fallback;
  }
}

function uniquePorts(ports) {
  const seen = new Set();
  return ports.filter(([, port]) => {
    if (seen.has(port)) return false;
    seen.add(port);
    return true;
  });
}

function checkPorts(ports) {
  if (process.platform === "win32") {
    return new Promise((resolve, reject) => {
      const child = spawn(
        "netstat",
        ["-ano", "-p", "tcp"],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code !== 0) {
          reject(new Error(stderr || `netstat exited with ${code}`));
          return;
        }
        const busy = parseWindowsNetstat(stdout, ports);
        if (busy.length > 0) {
          reject(new Error(formatBusyPorts(busy)));
          return;
        }
        resolve();
      });
    });
  }

  return new Promise((resolve, reject) => {
    const args = [
      "-nP",
      "-iTCP",
      "-sTCP:LISTEN",
      ...uniquePorts(ports).map(([, port]) => `-i:${port}`),
    ];
    const child = spawn("lsof", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 1 && !stdout.trim()) {
        resolve();
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr || `lsof exited with ${code}`));
        return;
      }
      const busy = parseLsof(stdout, ports);
      if (busy.length > 0) {
        reject(new Error(formatBusyPorts(busy)));
        return;
      }
      resolve();
    });
  });
}

function parseWindowsNetstat(stdout, ports) {
  const expected = new Map(ports.map(([name, port]) => [port, name]));
  const busy = [];

  for (const line of stdout.split(/\r?\n/)) {
    if (!/\bLISTENING\b/.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    const localAddress = parts[1] ?? "";
    const pid = parts[4] ?? "";
    const port = Number(localAddress.match(/:(\d+)$/)?.[1]);
    const name = expected.get(port);
    if (!name) continue;
    busy.push({ name, port, pid });
  }

  return busy;
}

function parseLsof(stdout, ports) {
  const expected = new Map(ports.map(([name, port]) => [port, name]));
  const busy = [];

  for (const line of stdout.split(/\r?\n/).slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) continue;
    const pid = parts[1];
    const port = Number(parts[8].match(/:(\d+)$/)?.[1]);
    const name = expected.get(port);
    if (!name) continue;
    busy.push({ name, port, pid });
  }

  return busy;
}

function formatBusyPorts(busy) {
  const rows = busy
    .map(({ name, port, pid }) => `- ${name}: localhost:${port} is already in use by PID ${pid}`)
    .join("\n");
  const killHint =
    platform() === "win32"
      ? "Stop the old dev server, or run `taskkill /PID <pid> /T /F` for the listed process."
      : "Stop the old dev server, or run `kill <pid>` for the listed process.";

  return `Required dev ports are already in use:\n${rows}\n${killHint}`;
}

function start(name, args) {
  const child = spawn(pnpm, args, {
    env: childEnv,
    shell: process.platform === "win32",
    stdio: ["inherit", "pipe", "pipe"],
  });
  started.push({ name, child });

  pipeWithPrefix(child.stdout, process.stdout, name);
  pipeWithPrefix(child.stderr, process.stderr, name);
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`[dev] ${name} exited (${signal ?? code ?? 0})`);
      void stopAll(typeof code === "number" ? code : 1);
    }
  });

  return child;
}

function pipeWithPrefix(readable, writable, name) {
  let pending = "";

  readable.on("data", (chunk) => {
    pending += stripTerminalControls(String(chunk));
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) writable.write(`[${name}] ${line}\n`);
    }
  });

  readable.on("end", () => {
    const line = pending.trim();
    if (line) writable.write(`[${name}] ${line}\n`);
  });
}

function stripTerminalControls(value) {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "\n");
}

async function waitForApi(child, timeoutMs = 60_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error("API dev server exited before the health check became ready.");
    }

    try {
      const response = await fetch(apiHealthUrl, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // API is still compiling or binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("Timed out waiting for the API health check.");
}

async function stopAll(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  await Promise.allSettled(
    started.map(({ child }) => {
      if (child.exitCode !== null || child.pid == null) return undefined;

      if (process.platform === "win32") {
        return new Promise((resolve) => {
          const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
            stdio: "ignore",
          });
          killer.on("exit", resolve);
          killer.on("error", resolve);
        });
      }

      child.kill("SIGTERM");
      return undefined;
    }),
  );

  process.exit(exitCode);
}

process.on("SIGINT", () => void stopAll(130));
process.on("SIGTERM", () => void stopAll(143));
process.on("exit", () => {
  shuttingDown = true;
});

console.log("[dev] starting API first so web SSR/proxy requests do not race it");

try {
  await checkPorts(requiredPorts);
  const api = start("api", ["--filter", "@opencairn/api", "dev"]);
  start("hocuspocus", ["--filter", "@opencairn/hocuspocus", "dev"]);
  start("emails", ["--filter", "@opencairn/emails", "dev"]);
  await waitForApi(api);
  console.log("[dev] API health check passed; starting web");
  start("web", ["--filter", "@opencairn/web", "dev"]);
} catch (error) {
  console.error(`[dev] ${error instanceof Error ? error.message : "startup failed"}`);
  await stopAll(1);
}
