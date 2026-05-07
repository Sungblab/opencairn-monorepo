import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const docker = process.platform === "win32" ? "docker.exe" : "docker";
const rootEnv = loadDotenv(".env");
const env = { ...rootEnv, ...process.env };

const useLocalPostgres = resolveLocalServiceFlag(
  env.OPENCAIRN_DEV_LOCAL_POSTGRES,
  !isExternalDatabase(env.COMPOSE_DATABASE_URL || env.DATABASE_URL),
  "OPENCAIRN_DEV_LOCAL_POSTGRES",
);
const useLocalMinio = resolveLocalServiceFlag(
  env.OPENCAIRN_DEV_LOCAL_MINIO,
  !isExternalS3(env.COMPOSE_S3_ENDPOINT || env.S3_ENDPOINT),
  "OPENCAIRN_DEV_LOCAL_MINIO",
);
const externalDb = !useLocalPostgres;
const externalS3 = !useLocalMinio;

if (externalDb && !env.COMPOSE_DATABASE_URL) {
  env.COMPOSE_DATABASE_URL = env.DATABASE_URL;
}
if (externalS3 && !env.COMPOSE_S3_ENDPOINT) {
  env.COMPOSE_S3_ENDPOINT = env.S3_ENDPOINT;
}
if (!env.COMPOSE_REDIS_URL) env.COMPOSE_REDIS_URL = "redis://redis:6379";
if (!env.COMPOSE_TEMPORAL_ADDRESS) env.COMPOSE_TEMPORAL_ADDRESS = "temporal:7233";
if (!env.COMPOSE_INTERNAL_API_URL) env.COMPOSE_INTERNAL_API_URL = "http://api:4000";
if (!env.TEMPORAL_HOST_PORT) {
  const temporalHostPort = portFromLocalhostAddress(env.TEMPORAL_ADDRESS);
  if (temporalHostPort) env.TEMPORAL_HOST_PORT = temporalHostPort;
}
if (!env.TEMPORAL_UI_HOST_PORT) env.TEMPORAL_UI_HOST_PORT = "8233";

const disabledServices = [
  ...(externalDb ? ["postgres"] : []),
  ...(externalS3 ? ["minio"] : []),
  "temporal-ui",
];

const services = [
  ...(externalDb ? [] : ["postgres"]),
  "redis",
  ...(externalS3 ? [] : ["minio"]),
  "temporal",
  "api",
  "web",
  "hocuspocus",
  "worker",
];

const overridePath = join(
  tmpdir(),
  `opencairn-dev-compose-${process.pid}-${Date.now()}.yml`,
);

writeFileSync(overridePath, makeOverride(), "utf8");

try {
  if (process.argv.includes("--down")) {
    runCompose(["down", "--remove-orphans"]);
  } else if (process.argv.includes("--logs")) {
    runCompose(["logs", "-f", ...services]);
} else if (process.argv.includes("--dry-run")) {
    printPlan();
    if (disabledServices.length > 0) {
      console.log(`[dev:docker] disabled services to stop/remove if present: ${disabledServices.join(", ")}`);
    }
    console.log(`[dev:docker] override: ${overridePath}`);
    console.log(`[dev:docker] compose args: ${composePrefix().concat(["up", "-d", "--build", ...services]).join(" ")}`);
  } else {
    printPlan();
    stopDisabledServices();
    runCompose(["up", "-d", "--build", ...services]);
  }
} finally {
  rmSync(overridePath, { force: true });
}

function loadDotenv(path) {
  if (!existsSync(path)) return {};

  const parsed = {};
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
    parsed[name] = value;
  }
  return parsed;
}

function isExternalDatabase(value) {
  if (!value) return false;
  const lower = value.toLowerCase();
  return ![
    "localhost",
    "127.0.0.1",
    "::1",
    "@postgres:",
    "@postgres/",
    "@localhost:",
    "@127.0.0.1:",
    "set_postgres_password",
  ].some((marker) => lower.includes(marker));
}

function isExternalS3(value) {
  if (!value) return false;
  const lower = value.toLowerCase();
  return ![
    "localhost",
    "127.0.0.1",
    "minio",
    "localstack",
  ].some((marker) => lower.includes(marker));
}

function portFromLocalhostAddress(value) {
  if (!value) return undefined;
  try {
    const url = new URL(value.includes("://") ? value : `http://${value}`);
    const hostname = url.hostname.toLowerCase();
    if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) return undefined;
    return url.port || undefined;
  } catch {
    return undefined;
  }
}

function resolveLocalServiceFlag(value, autoValue, name) {
  const normalized = (value ?? "auto").trim().toLowerCase();
  if (normalized === "" || normalized === "auto") return autoValue;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;

  throw new Error(`${name} must be auto, true, or false.`);
}

function makeOverride() {
  const apiDepends = [
    ...(externalDb ? [] : ["postgres:\n        condition: service_healthy"]),
    "redis:\n        condition: service_started",
    "temporal:\n        condition: service_started",
    ...(externalS3 ? [] : ["minio:\n        condition: service_healthy"]),
  ].join("\n      ");

  const hocuspocusDepends = externalDb
    ? "{}"
    : "\n      postgres:\n        condition: service_healthy";

  const workerDepends = [
    ...(externalDb ? [] : ["postgres:\n        condition: service_healthy"]),
    "redis:\n        condition: service_started",
    "temporal:\n        condition: service_started",
    ...(externalS3 ? [] : ["minio:\n        condition: service_healthy"]),
  ].join("\n      ");

  return `services:
  api:
    depends_on: !override
      ${apiDepends}
  hocuspocus:
    depends_on: !override ${hocuspocusDepends}
  worker:
    depends_on: !override
      ${workerDepends}
`;
}

function printPlan() {
  console.log("[dev:docker] starting OpenCairn with Docker Compose");
  console.log(
    `[dev:docker] database: ${externalDb ? "external DATABASE_URL/COMPOSE_DATABASE_URL; skip local postgres" : "local compose postgres"}`,
  );
  console.log(
    `[dev:docker] object storage: ${externalS3 ? "external S3/R2; skip local minio" : "local compose minio"}`,
  );
  console.log(`[dev:docker] temporal: ${env.COMPOSE_TEMPORAL_ADDRESS} (host port ${env.TEMPORAL_HOST_PORT ?? "7233"}, UI ${env.TEMPORAL_UI_HOST_PORT})`);
  console.log(`[dev:docker] services: ${services.join(", ")}`);
}

function stopDisabledServices() {
  if (disabledServices.length === 0) return;

  runCompose(["rm", "-f", "-s", ...disabledServices], { exitOnError: false });
}

function runCompose(args, options = {}) {
  const composeArgs = [
    ...composePrefix(),
    ...args,
  ];
  const result = spawnSync(docker, composeArgs, {
    env,
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`[dev:docker] failed to run docker compose: ${result.error.message}`);
    if (options.exitOnError === false) return;
    process.exit(1);
  }
  if (result.signal) process.kill(process.pid, result.signal);
  if (options.exitOnError === false) return;
  process.exit(result.status ?? 0);
}

function composePrefix() {
  return [
    "compose",
    "--profile",
    "app",
    "--profile",
    "worker",
    "--profile",
    "hocuspocus",
    "-f",
    "docker-compose.yml",
    "-f",
    overridePath,
  ];
}
