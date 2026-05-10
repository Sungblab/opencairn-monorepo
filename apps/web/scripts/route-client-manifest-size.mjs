#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function readRouteManifest(filePath) {
  const content = fs.readFileSync(filePath, "utf8").trim();
  const marker = 'globalThis.__RSC_MANIFEST["';
  const keyStart = content.lastIndexOf(marker);

  if (keyStart === -1) {
    throw new Error(`Missing RSC manifest assignment in ${filePath}`);
  }

  const routeStart = keyStart + marker.length;
  const routeEnd = content.indexOf('"]=', routeStart);

  if (routeEnd === -1) {
    throw new Error(`Missing RSC manifest route key in ${filePath}`);
  }

  const route = content.slice(routeStart, routeEnd);
  const jsonText = content
    .slice(routeEnd + 3)
    .replace(/;\s*$/, "")
    .trim();

  return { route, manifest: JSON.parse(jsonText) };
}

function collectChunkPaths(value, chunks = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.startsWith("static/chunks/")) {
        chunks.add(item);
      }
    }

    return chunks;
  }

  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) {
      collectChunkPaths(nested, chunks);
    }
  }

  return chunks;
}

function resolveChunkPath(nextRoot, chunkPath) {
  const candidates = [path.join(nextRoot, chunkPath)];

  try {
    const decoded = decodeURIComponent(chunkPath);
    if (decoded !== chunkPath) {
      candidates.push(path.join(nextRoot, decoded));
    }
  } catch {
    // Keep the raw manifest path as the only candidate when decoding fails.
  }

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function findManifestFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...findManifestFiles(fullPath));
      continue;
    }

    if (
      entry.isFile() &&
      entry.name.endsWith("_client-reference-manifest.js")
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

export function measureRouteClientManifestSizes(root = process.cwd()) {
  const nextRoot = path.join(root, ".next");
  const appManifestRoot = path.join(nextRoot, "server/app");

  return findManifestFiles(appManifestRoot)
    .map((filePath) => {
      const { route, manifest } = readRouteManifest(filePath);
      const chunks = collectChunkPaths(manifest);
      let bytes = 0;
      let missing = 0;

      for (const chunk of chunks) {
        const resolved = resolveChunkPath(nextRoot, chunk);

        if (!resolved) {
          missing += 1;
          continue;
        }

        bytes += fs.statSync(resolved).size;
      }

      return { route, bytes, chunks: chunks.size, missing };
    })
    .sort(
      (left, right) =>
        right.bytes - left.bytes || left.route.localeCompare(right.route),
    );
}

export function formatRows(rows, limit = rows.length) {
  const visibleRows = Number.isFinite(limit) ? rows.slice(0, limit) : rows;

  return [
    "bytes chunks missing route",
    ...visibleRows.map(
      ({ bytes, chunks, missing, route }) =>
        `${bytes} ${chunks} ${missing} ${route}`,
    ),
  ].join("\n");
}

function parseArgs(args) {
  const options = {
    root: process.cwd(),
    limit: Number.POSITIVE_INFINITY,
    json: false,
  };

  function readFlagValue(flag, index) {
    const value = args[index + 1];

    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }

    return value;
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--root") {
      options.root = path.resolve(readFlagValue(arg, index));
      index += 1;
      continue;
    }

    if (arg === "--limit") {
      options.limit = Number.parseInt(readFlagValue(arg, index), 10);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (
    (!Number.isFinite(options.limit) &&
      options.limit !== Number.POSITIVE_INFINITY) ||
    options.limit < 1
  ) {
    throw new Error("--limit must be a positive integer");
  }

  return options;
}

function runCli() {
  const options = parseArgs(process.argv.slice(2));
  const rows = measureRouteClientManifestSizes(options.root);

  if (rows.length === 0) {
    throw new Error(
      `No route client manifests found under ${path.join(options.root, ".next")}`,
    );
  }

  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.log(formatRows(rows, options.limit));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
