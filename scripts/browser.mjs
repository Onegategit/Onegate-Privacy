// Chromium for the browser checks: Playwright's own build when it is installed, otherwise the newest Chromium
// already in the Playwright browser folder, or CHROME_PATH when set.
import { chromium } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";

function executablePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const own = chromium.executablePath();
  if (existsSync(own)) return undefined;
  const parts = own.split(/[\\/]/);
  const at = parts.findIndex((p) => /^chromium-\d+$/.test(p));
  if (at < 0) return undefined;
  const root = parts.slice(0, at).join(sep), tail = parts.slice(at + 1);
  const found = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
    .map((d) => join(root, d, ...tail)).find(existsSync);
  return found;
}

export const launch = (options = {}) => chromium.launch({ ...options, executablePath: executablePath() });
