// Render the real dashboard in headless Chromium and take the three screenshots the bounty asks for:
// the board, one protocol's detail view open, and a filtered view. The page is loaded from disk with
// no network, exactly as the judge would open it.
//
//   node scripts/shoot.mjs [--page out/dashboard/index.html] [--dir screenshots] [--width 1440] [--height 900]
//
// It drives Chromium over the DevTools protocol with Node's own WebSocket, so nothing is installed.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : fallback;
};

const page = resolve(flag('page', 'out/dashboard/index.html'));
const dir = resolve(flag('dir', 'screenshots'));
const width = Number(flag('width', '1440'));
const height = Number(flag('height', '900'));
const slug = flag('slug', '');
const port = 9481;

if (!existsSync(page)) {
  console.error(`shoot: no page at ${page}`);
  process.exit(2);
}

const browser = [
  '/usr/local/bin/chromium',
  '/usr/local/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].find((p) => existsSync(p));
if (!browser) {
  console.error('shoot: no Chromium or Chrome found');
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), 'radar-shot-'));
const child = spawn(browser, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--disable-lcd-text',
  '--font-render-hinting=none',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  `--window-size=${width},${height}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForTarget() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = list.find((t) => t.type === 'page');
      if (target) return target.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error('chromium did not answer on its debugging port');
}

const wsUrl = await waitForTarget();
const ws = new WebSocket(wsUrl);
await new Promise((ok, bad) => {
  ws.addEventListener('open', ok, { once: true });
  ws.addEventListener('error', bad, { once: true });
});

let nextId = 1;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { ok, bad } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) bad(new Error(msg.error.message));
    else ok(msg.result);
  }
});

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((ok, bad) => pending.set(id, { ok, bad }));
}

const evaluate = async (expression) => {
  const out = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? 'evaluate failed');
  return out.result?.value;
};

async function shoot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const bytes = Buffer.from(shot.data, 'base64');
  writeFileSync(join(dir, name), bytes);
  console.log(`shoot: wrote ${join(dir, name)} (${Math.round(bytes.length / 1024)} KB)`);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: pathToFileURL(page).href });
await sleep(1400);

const missing = await evaluate('window.RADAR ? 0 : 1');
if (missing) throw new Error('the page did not read data.js beside it: run main.ts first');
mkdirSync(dir, { recursive: true });

// One: the board as it opens.
await evaluate('window.scrollTo(0,0); document.activeElement && document.activeElement.blur(); 0');
await sleep(300);
await shoot('1-board.png');

// Two: a protocol's detail view, opened the way a reader opens it.
const target = slug || (await evaluate('document.querySelector("tr[data-slug]")?.getAttribute("data-slug") || ""'));
if (!target) throw new Error('no protocol row to open');
await evaluate(`(function(){var b=document.querySelector('button[data-plan="${target}"]'); if(b) b.click(); var d=document.querySelector('.drawer-inner'); if(d) d.scrollTop=0; return 1;})()`);
await sleep(700);
await send('Runtime.evaluate', { expression: `document.querySelector('.drawer').scrollTop = 0` });
await sleep(300);
await shoot('2-detail.png');

// Three: a filtered view. Close the drawer, then narrow the board the way a reader would: one chain,
// only the protocols whose week is up, sorted by that week.
await evaluate(`(function(){
  var close=document.getElementById('drawer-close'); if(close) close.click();
  document.getElementById('toggle-gainers').click();
  var chain=document.getElementById('chain');
  chain.value='Base';
  chain.dispatchEvent(new Event('change',{bubbles:true}));
  document.querySelector('.grid thead button[data-sort="change"]').click();
  window.scrollTo(0,0);
  return document.getElementById('count').textContent;
})()`);
await sleep(500);
await shoot('3-filtered.png');

ws.close();
child.kill('SIGTERM');
await sleep(200);
child.kill('SIGKILL');
process.exit(0);
