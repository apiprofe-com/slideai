// JSTOR steps, ported from the Nov 2 scripts (~/ed/scripts/deck): search, save to Workspace,
// export. Human pace, one item at a time, stop on any human check. Never touches credentials.
import fs from 'node:fs';
import path from 'node:path';
import { sleep, log, humanCheck, findByText, IMAGES_FILTER } from './session.js';

const searchUrl = (q) => 'https://www.jstor.org/action/doBasicSearch?Query=' + encodeURIComponent(q) + '&so=rel' + IMAGES_FILTER;
const decodeAmp = (s) => s.replace(/&amp;/g, '&');

// Top-4 image results for one query, with thumbnails fetched in-page (same session).
export async function searchWork(p, q) {
  await p.goto(searchUrl(q), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForSelector('[data-qa=image-card]', { timeout: 15000 }).catch(() => {});
  await sleep(2500);
  if (await humanCheck(p)) throw Object.assign(new Error('JSTOR human check'), { human: true });
  return p.evaluate(async () => {
    const r = [];
    for (const li of [...document.querySelectorAll('li[data-doi]')].slice(0, 4)) {
      const c = li.querySelector('[data-qa=image-card]');
      const img = li.querySelector('img[data-qa=image-card-image]');
      let thumb = null;
      try {
        const bl = await (await fetch(img.src)).blob();
        thumb = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(bl); });
      } catch { /* no thumbnail */ }
      r.push({ doi: li.getAttribute('data-doi'), title: c?.getAttribute('data-title') || '', meta: li.innerText.replace(/\s+/g, ' ').trim().slice(0, 220), thumb });
    }
    return r;
  });
}

// Save one approved item to the named Workspace folder (created on first use).
export async function saveItem(p, item, folder) {
  await p.goto(searchUrl(item.q), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForSelector('[data-qa=image-card]', { timeout: 20000 }).catch(() => {});
  await sleep(3000);
  if (await humanCheck(p)) throw Object.assign(new Error('JSTOR human check'), { human: true });
  const found = await p.evaluate((doi) => {
    const li = document.querySelector(`li[data-doi="${doi}"]`);
    if (!li) return false;
    const bt = li.querySelector('mfe-save-to-workspace-pharos-button');
    bt.scrollIntoView({ block: 'center' });
    (bt.shadowRoot?.querySelector('button') || bt).click();
    return true;
  }, item.doi);
  if (!found) return { ok: false, msg: 'not on the results page' };
  await sleep(2500);
  // Is the folder already in the picker menu? (JSTOR stores "&" as "&amp;".)
  const picked = await p.evaluate((name) => {
    const w = document.querySelector('.workspace-folder-picker');
    if (!w) return 'no-picker';
    const norm = (s) => s.replace(/&amp;/g, '&').trim();
    const bt = [...w.querySelectorAll('button.menu-item-button')].find((x) => norm(x.innerText) === name || norm(x.innerText).startsWith(name));
    if (!bt) return 'missing';
    bt.click();
    return 'picked';
  }, decodeAmp(folder));
  if (picked === 'no-picker') return { ok: false, msg: 'folder picker did not open' };
  if (picked === 'missing') {
    await p.evaluate(() => { const w = document.querySelector('.workspace-folder-picker'); [...w.querySelectorAll('button.create-item')][0].click(); });
    await sleep(1200);
    const inp = await p.evaluateHandle(() => document.querySelector('.workspace-folder-picker .create-folder-input').shadowRoot.querySelector('input'));
    await inp.click();
    await p.keyboard.type(folder, { delay: 40 });
    await sleep(800);
    await p.evaluate(() => { const b = document.querySelector('.workspace-folder-picker mfe-workspace-folder-picker-pharos-button.create-folder'); (b.shadowRoot?.querySelector('button') || b).click(); });
  } else {
    await sleep(1000);
    await p.evaluate(() => {
      const f = document.querySelector('.workspace-folder-picker__footer');
      const b = [...f.querySelectorAll('mfe-workspace-folder-picker-pharos-button')].find((x) => /Save/.test(x.innerText));
      (b.shadowRoot?.querySelector('button') || b).click();
    });
  }
  await sleep(3500);
  const msg = await p.evaluate(() => {
    const t = [...document.querySelectorAll('*')].filter((e) => e.shadowRoot && /TOAST/i.test(e.tagName)).map((e) => e.shadowRoot.textContent + e.textContent).join(' ');
    return ((t + ' ' + document.body.innerText).match(/(saved to[^\n]{0,80}|already[^\n]{0,60}|error[^\n]{0,60})/i) || [])[0] || '';
  });
  return { ok: !/error/i.test(msg), msg: msg || '(no message seen)' };
}

// Export the open Workspace folder to PowerPoint and capture the file.
// Finds "Export" and "Export to PowerPoint" by their on-screen position (shadow DOM included),
// then clicks with the real mouse (JSTOR's Pharos menu ignores synthetic clicks).
export async function exportFolder(b, p, downloadDir, { minutes = 8 } = {}) {
  fs.mkdirSync(downloadDir, { recursive: true });
  const before = new Set(fs.readdirSync(downloadDir));
  const s = await b.target().createCDPSession();
  await s.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true });
  await p.evaluate(() => window.scrollTo(0, 0));
  await sleep(800);
  const exp = await findByText(p, /^Export$/i, { maxLen: 12 }) || await findByText(p, /^Export\b/i, { maxLen: 20 });
  if (!exp) throw new Error('Export button not found. Is the Workspace folder open?');
  await p.mouse.click(exp.x, exp.y);
  await sleep(2000);
  const item = await findByText(p, /Export to PowerPoint|PowerPoint/i, { maxLen: 40 });
  if (!item) throw new Error('"Export to PowerPoint" not found in the menu');
  await p.mouse.click(item.x, item.y);
  log('Export started; JSTOR usually takes 1-2 minutes...');
  const t0 = Date.now();
  while (Date.now() - t0 < minutes * 60e3) {
    await sleep(5000);
    const f = fs.readdirSync(downloadDir).find((x) => x.endsWith('.pptx') && !before.has(x));
    if (f) return path.join(downloadDir, f);
  }
  throw new Error('Export did not finish in time');
}
