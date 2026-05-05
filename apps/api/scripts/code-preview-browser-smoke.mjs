#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function usage() {
  return `Usage: node apps/api/scripts/code-preview-browser-smoke.mjs <preview-url> [options]

Options:
  --screenshot <path>       Screenshot output path. Defaults to output/playwright/code-preview-smoke-<timestamp>.png.
  --selector <selector>     Wait for a selector before passing.
  --expect-text <text>      Require visible body text to include the text.
  --min-body-chars <n>      Minimum visible body text length. Default: 1.
  --timeout-ms <n>          Navigation and wait timeout. Default: 15000.
  --storage-state <path>    Playwright storageState JSON for authenticated private preview routes.
  --header <name:value>     Extra HTTP header. Can be repeated.
  --cookie <name=value>     Cookie for the preview URL origin. Can be repeated.
  --no-screenshot           Skip screenshot capture.
  --help                    Show this help.
`;
}

function fail(message) {
  console.error(`[code-preview-smoke] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    cookies: [],
    headers: {},
    minBodyChars: 1,
    screenshot: null,
    selector: null,
    expectText: null,
    storageState: undefined,
    takeScreenshot: true,
    timeoutMs: 15_000,
    url: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (!arg.startsWith("--") && !options.url) {
      options.url = arg;
      continue;
    }
    if (arg === "--no-screenshot") {
      options.takeScreenshot = false;
      continue;
    }
    const value = argv[index + 1];
    if (!value) fail(`missing value for ${arg}`);
    index += 1;
    if (arg === "--screenshot") {
      options.screenshot = value;
    } else if (arg === "--selector") {
      options.selector = value;
    } else if (arg === "--expect-text") {
      options.expectText = value;
    } else if (arg === "--min-body-chars") {
      options.minBodyChars = Number.parseInt(value, 10);
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number.parseInt(value, 10);
    } else if (arg === "--storage-state") {
      options.storageState = value;
    } else if (arg === "--header") {
      const splitAt = value.indexOf(":");
      if (splitAt <= 0) fail(`invalid --header value: ${value}`);
      options.headers[value.slice(0, splitAt).trim()] = value.slice(splitAt + 1).trim();
    } else if (arg === "--cookie") {
      const splitAt = value.indexOf("=");
      if (splitAt <= 0) fail(`invalid --cookie value: ${value}`);
      options.cookies.push({
        name: value.slice(0, splitAt),
        value: value.slice(splitAt + 1),
      });
    } else {
      fail(`unknown option: ${arg}`);
    }
  }

  if (!options.url) fail("missing preview URL");
  if (!Number.isInteger(options.minBodyChars) || options.minBodyChars < 0) {
    fail("--min-body-chars must be a non-negative integer");
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000) {
    fail("--timeout-ms must be an integer >= 1000");
  }
  return options;
}

function defaultScreenshotPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join("output", "playwright", `code-preview-smoke-${stamp}.png`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let previewUrl;
  try {
    previewUrl = new URL(options.url);
  } catch {
    fail(`invalid preview URL: ${options.url}`);
  }

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      extraHTTPHeaders: options.headers,
      storageState: options.storageState,
    });
    if (options.cookies.length > 0) {
      await context.addCookies(
        options.cookies.map((cookie) => ({
          ...cookie,
          domain: previewUrl.hostname,
          path: "/",
          secure: previewUrl.protocol === "https:",
          httpOnly: false,
          sameSite: "Lax",
        })),
      );
    }

    const page = await context.newPage();
    const response = await page.goto(previewUrl.toString(), {
      timeout: options.timeoutMs,
      waitUntil: "networkidle",
    });
    const status = response?.status() ?? 0;
    if (!response || status >= 400) {
      fail(`preview returned HTTP ${status || "no response"}`);
    }
    if (options.selector) {
      await page.waitForSelector(options.selector, { timeout: options.timeoutMs });
    }

    const bodyText = (await page.locator("body").innerText({ timeout: options.timeoutMs })).trim();
    if (bodyText.length < options.minBodyChars) {
      fail(`visible body text too short: ${bodyText.length} < ${options.minBodyChars}`);
    }
    if (options.expectText && !bodyText.includes(options.expectText)) {
      fail(`visible body text did not include expected text: ${options.expectText}`);
    }

    let screenshotPath = null;
    if (options.takeScreenshot) {
      screenshotPath = options.screenshot ?? defaultScreenshotPath();
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          status,
          url: page.url(),
          bodyChars: bodyText.length,
          screenshot: screenshotPath,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

await main();
