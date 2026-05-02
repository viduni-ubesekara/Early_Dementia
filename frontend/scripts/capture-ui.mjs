import { chromium } from "playwright";
import { mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "ui-screenshots");
const BASE = process.env.PREVIEW_URL || "http://127.0.0.1:4173";

const pages = [
  { path: "/", name: "01-home" },
  { path: "/patient", name: "02-patient-info" },
  { path: "/test", name: "03-mmse-test" },
  { path: "/test-advanced", name: "04-advanced-test" },
  { path: "/results", name: "05-results" },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1800 },
  deviceScaleFactor: 1,
});

for (const p of pages) {
  const page = await ctx.newPage();
  const url = `${BASE}${p.path}`;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(800);
    const file = path.join(OUT, `${p.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log("saved", file);
  } catch (e) {
    console.error(url, e.message);
  }
  await page.close();
}

await browser.close();
console.log("Done. Output:", OUT);
