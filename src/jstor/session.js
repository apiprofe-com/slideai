// A visible Chrome with its own profile. The person signs in to JSTOR their school's way
// (library proxy, OpenAthens, Shibboleth, Google/Microsoft, or a personal account).
// This code never sees or types credentials; it only waits until JSTOR shows access.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const HOME = path.join(os.homedir(), '.slideai');
export const PROFILE = path.join(HOME, 'chrome-profile');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const IMAGES_FILTER = '&efqs=eyJjdHkiOlsiWTI5dWRISnBZblYwWldSZmFXMWhaMlZ6Il19';
export const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);

// Reuse the window if it's already open (so a sign-in survives between commands), else start
// Chrome ourselves, detached, so it stays open after this command ends.
export async function browser() {
  fs.mkdirSync(PROFILE, { recursive: true });
  const portFile = path.join(PROFILE, 'DevToolsActivePort');
  const connect = async () => {
    const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
    return puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${port}${wsPath}`, defaultViewport: null });
  };
  try { return await connect(); } catch { /* not running */ }
  try { fs.unlinkSync(portFile); } catch { /* none */ }
  const exe = await puppeteer.executablePath('chrome');
  const child = spawn(exe, [`--user-data-dir=${PROFILE}`, '--remote-debugging-port=0', '--window-size=1300,900',
    '--no-first-run', '--no-default-browser-check', 'https://www.jstor.org/'], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try { return await connect(); } catch { /* starting */ }
  }
  throw new Error('Could not start Chrome');
}

export async function page(b) {
  return (await b.pages())[0] || b.newPage();
}

export async function humanCheck(p) {
  const t = await p.evaluate(() => document.body?.innerText || '').catch(() => '');
  return /verify you are human|are you a robot|captcha|unusual traffic/i.test(t);
}

// Wait until JSTOR says who is providing access. Returns the institution name.
export async function waitForAccess(p, { minutes = 20 } = {}) {
  if (!/jstor\.org/.test(p.url())) await p.goto('https://www.jstor.org/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  const t0 = Date.now();
  let told = 0;
  while (Date.now() - t0 < minutes * 60e3) {
    const txt = await p.evaluate(() => document.body?.innerText || '').catch(() => '');
    const m = txt.match(/Access provided by\s+([^\n]+)/i);
    if (m) return m[1].trim();
    if (await humanCheck(p)) { if (Date.now() - told > 30e3) { log('JSTOR is showing a human check. Please solve it in the Chrome window.'); told = Date.now(); } }
    else if (Date.now() - told > 60e3) { log('Waiting: sign in to JSTOR in the Chrome window (your school\'s login or "Access through your institution").'); told = Date.now(); }
    await sleep(4000);
  }
  throw new Error('Timed out waiting for JSTOR access');
}

// Find an element's centre by visible text, searching inside shadow roots too.
export async function findByText(p, re, { maxLen = 60 } = {}) {
  return p.evaluate((src, flags, maxLen) => {
    const rx = new RegExp(src, flags);
    const hits = [];
    const walk = (root) => {
      for (const e of root.querySelectorAll('*')) {
        if (e.shadowRoot) walk(e.shadowRoot);
        const t = (e.innerText || e.textContent || '').trim();
        if (t && t.length <= maxLen && rx.test(t)) {
          const r = e.getBoundingClientRect();
          if (r.width && r.height) hits.push({ tag: e.tagName, text: t, x: r.x + r.width / 2, y: r.y + r.height / 2, area: r.width * r.height });
        }
      }
    };
    walk(document);
    hits.sort((a, b) => a.area - b.area); // smallest = most specific element
    return hits[0] || null;
  }, re.source, re.flags, maxLen);
}
