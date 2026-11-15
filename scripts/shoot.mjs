#!/usr/bin/env node
// Renders out/dashboard/index.html in headless Chromium and keeps three screenshots:
//
//   screenshots/1-board.png     the whole board as it opens
//   screenshots/2-detail.png    one protocol's drawer open, farm plan in view
//   screenshots/3-filtered.png  a chain filter and the watchlist box applied
//
//   node scripts/shoot.mjs      (after `node main.ts`, which writes out/ and data.js)
//
// 1440x900 each, which is the geometry the gate wants: 1440 on the long side, at least
// 800 on the short, under 512KB.

import { mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = pathToFileURL(join(root, 'out', 'dashboard', 'index.html')).href;
const shots = join(root, 'screenshots');
const VIEWPORT = { width: 1440, height: 900 };
const CAP = 512 * 1024;

mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const tab = await context.newPage();
await tab.goto(page);
await tab.waitForSelector('#board tbody tr');

const status = await tab.textContent('#status');
process.stdout.write(`board: ${status}\n`);

const shoot = async (name) => {
  const path = join(shots, name);
  await tab.screenshot({ path });
  const bytes = statSync(path).size;
  if (bytes > CAP) throw new Error(`${name} is ${bytes} bytes, over the ${CAP} cap`);
  process.stdout.write(`${name} ${VIEWPORT.width}x${VIEWPORT.height} ${bytes} bytes\n`);
};

await shoot('1-board.png');

await tab.click('#board tbody tr:first-child');
await tab.waitForSelector('#drawer:not([hidden])');
await tab.locator('#drawer').evaluate((node) => { node.scrollTop = 420; });
await shoot('2-detail.png');
await tab.click('#close');

await tab.selectOption('#chain', 'Ethereum');
await tab.check('#watchlist');
await tab.fill('#q', '');
await tab.dispatchEvent('#q', 'input');
await tab.waitForTimeout(150);
await shoot('3-filtered.png');

await browser.close();
