#!/usr/bin/env node
// SlideAI (works with JSTOR Images): local helper.
//   slideai new                                ask for a title + works, then do everything (double-click start)
//   slideai make <works.json> [--folder "Name"]  the whole thing, step by step (start here)
//   slideai login                              open Chrome; you sign in to JSTOR; it waits for access
//   slideai pick <works.json>                  search each work, show a contact sheet, you approve -> picks.json
//   slideai save <picks.json> --folder "Name"  save approved images to your JSTOR Workspace folder
//   slideai export [--out dir]                 you open the folder in JSTOR; it exports to PowerPoint
//   slideai draft <picks.json> <export.pptx> <spec.json>   starter deck spec from your picks
//   slideai build <spec.json> <export.pptx> <out.pptx>     build the clean deck
// works.json: [{ "key": "bq1", "label": "Braque, Landscape at L'Estaque (1906)", "q": "Braque L'Estaque 1906" }, ...]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { browser, page, waitForAccess, sleep, log, HOME, DECKS } from './jstor/session.js';
import { searchWork, saveItem, exportFolder } from './jstor/actions.js';
import { parseJstorExport } from './jstor/parse.js';
import { buildDeck, finish } from './build/deck.js';

const [cmd, ...args] = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : d; };
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJSON = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 1));
const worksOf = (f) => { const j = readJSON(f); return Array.isArray(j) ? j : j.works; };
const titleOf = (f) => { const j = readJSON(f); return Array.isArray(j) ? null : j.title; };
const normWorks = (w) => w.map((x) => (Array.isArray(x) ? { key: x[0], label: x[1], q: x[2] } : x));
const MAX_ITEMS = 30, SAVE_PACE_MS = 15000, SEARCH_PACE_MS = 6000;

async function signedIn() {
  const b = await browser();
  const p = await page(b);
  const inst = await waitForAccess(p);
  log(`JSTOR access: ${inst}`);
  return { b, p };
}

async function cmdPick(worksFile) {
  if (!worksFile || !fs.existsSync(worksFile)) throw new Error(`Works list not found: ${worksFile || '(none given)'}`);
  const works = normWorks(worksOf(worksFile));
  if (works.length > MAX_ITEMS + 5) throw new Error(`Too many works (${works.length}); keep a deck under ${MAX_ITEMS} images.`);
  const candFile = worksFile.replace(/\.json$/, '') + '.candidates.json';
  const cand = fs.existsSync(candFile) ? readJSON(candFile) : {};
  const { b, p } = await signedIn();
  for (const w of works) {
    const goodThumbs = (cand[w.key]?.cards || []).every((c) => !c.thumb || c.thumb.startsWith('data:image/'));
    if (cand[w.key]?.cards?.length && goodThumbs) continue;
    try {
      const cards = await searchWork(p, w.q);
      cand[w.key] = { ...w, cards };
      writeJSON(candFile, cand);
      log(`${w.key}: ${cards.length} results  ${cards.map((c) => c.title).join(' | ').slice(0, 120)}`);
    } catch (e) {
      if (e.human) { log('JSTOR is asking for a human check. Solve it in Chrome, then run this again (it resumes).'); b.disconnect(); return; }
      log(`${w.key}: search failed (${e.message}); rerun to retry`);
    }
    await sleep(SEARCH_PACE_MS);
  }
  const picksFile = worksFile.replace(/\.json$/, '') + '.picks.json';
  await contactSheet(b, works, cand, picksFile);
  b.disconnect();
}

// Best text match for the label: words from artist/title, plus the label's year(s) in the card.
function suggest(w, cards) {
  if (!cards.length) return -1;
  const norm = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const words = norm(w.label).replace(/\(.*?\)/g, ' ').split(/[^a-z0-9']+/).filter((x) => x.length > 3);
  // Label years, with ranges like "1902-06" expanded so 1905 counts as an exact match.
  const years = [];
  for (const m of w.label.matchAll(/\b(1[0-9]{3}|20[0-9]{2})(?:\s*[-–]\s*(\d{2,4}))?/g)) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2].length === 2 ? m[1].slice(0, 2) + m[2] : m[2]) : a;
    for (let y = a; y <= Math.min(b, a + 15); y++) years.push(y);
  }
  let best = 0, bestScore = -1;
  cards.forEach((c, i) => {
    const hay = norm(`${c.title} ${c.meta}`);
    let sc = words.filter((x) => hay.includes(x)).length;
    const cy = (hay.match(/\b(1[0-9]{3}|20[0-9]{2})\b/g) || []).map(Number);
    if (years.length && cy.length) {
      const d = Math.min(...years.flatMap((y) => cy.map((z) => Math.abs(y - z))));
      sc += d === 0 ? 4 : d <= 2 ? 2 : d <= 5 ? 1 : -1;
    }
    if (sc > bestScore) { bestScore = sc; best = i; }
  });
  return best;
}

// Local contact sheet: top 4 per work, best text/date match pre-selected (green); "link slide" if none fit.
function contactSheet(b, works, cand, picksFile) {
  return new Promise((resolve) => {
    const rows = works.map((w) => {
      const c = cand[w.key]?.cards || [];
      const pick = suggest(w, c);
      const opts = c.map((x, i) => `<label class="c${i === pick ? ' g' : ''}"><input type="radio" name="${w.key}" value="${i}"${i === pick ? ' checked' : ''}>
        ${x.thumb && x.thumb.startsWith('data:image/') ? `<img src="${x.thumb}" alt="">` : '<div class="noimg">no preview<br>(choose by title and date)</div>'}<b>${esc(x.title)}</b><small>${esc(x.meta)}</small>${i === pick ? '<em>suggested</em>' : ''}</label>`).join('');
      return `<section><h2>${esc(w.label)}</h2><p class="q">searched: ${esc(w.q)}</p><div class="row">${opts}
        <label class="c link"><input type="radio" name="${w.key}" value="link"${c.length ? '' : ' checked'}><div class="noimg">Not in JSTOR / none fit:<br>use a link slide</div></label></div></section>`;
    }).join('');
    const html = `<!doctype html><meta charset="utf-8"><title>SlideAI contact sheet</title><style>
      body{font:15px system-ui;margin:20px;background:#f6f6f4;color:#1b1b1b} h1{margin:0 0 4px} section{background:#fff;border-radius:10px;padding:12px 14px;margin:14px 0}
      h2{font-size:16px;margin:0} .q{color:#666;font-size:12px;margin:2px 0 8px} .row{display:flex;gap:10px;flex-wrap:wrap}
      .c{width:200px;border:3px solid #ddd;border-radius:8px;padding:6px;cursor:pointer;display:flex;flex-direction:column;gap:4px;font-size:12px}
      .c:has(input:checked){border-color:#16a34a;background:#f0fdf4} .c input{align-self:flex-start} img{width:100%;height:150px;object-fit:contain;background:#eee}
      .noimg{height:150px;display:flex;align-items:center;justify-content:center;text-align:center;background:#f1f1f1;color:#555} small{color:#666}
      button{position:sticky;bottom:10px;font:600 16px system-ui;padding:12px 20px;border:0;border-radius:8px;background:#16a34a;color:#fff;cursor:pointer}
    </style><h1>Pick one image per work</h1><p>Green = suggested (best match for the artist, title and date). Change any pick, or choose "link slide". Nothing is saved to JSTOR until you run <code>slideai save</code>.</p>
    <form method="post">${rows}<button>Approve picks</button></form>`;
    const srv = http.createServer((req, res) => {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (d) => { body += d; });
        req.on('end', () => {
          const f = new URLSearchParams(body);
          const picks = works.map((w) => {
            const v = f.get(w.key);
            const c = cand[w.key]?.cards || [];
            return v === 'link' || v == null || !c[+v] ? { key: w.key, label: w.label, q: w.q, doi: null } : { key: w.key, label: w.label, q: w.q, doi: c[+v].doi, title: c[+v].title, meta: c[+v].meta };
          });
          writeJSON(picksFile, picks);
          res.end(`<meta charset="utf-8"><p style="font:16px system-ui">Saved ${picks.filter((x) => x.doi).length} picks and ${picks.filter((x) => !x.doi).length} link slides to ${esc(picksFile)}. You can close this tab.</p>`);
          log(`Approved: ${picksFile}`);
          srv.close(); resolve();
        });
      } else { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); }
    }).listen(0, '127.0.0.1', async () => {
      const url = `http://127.0.0.1:${srv.address().port}/`;
      log(`Contact sheet: ${url} (opened in the Chrome window)`);
      const t = await b.newPage(); await t.goto(url);
    });
  });
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function cmdSave(picksFile, folder) {
  if (!folder) throw new Error('--folder "Name" is required');
  const picks = readJSON(picksFile).filter((x) => x.doi);
  if (picks.length > MAX_ITEMS) throw new Error(`${picks.length} picks; the limit is ${MAX_ITEMS} per deck.`);
  const logFile = picksFile.replace(/\.json$/, '') + '.saved.json';
  const done = fs.existsSync(logFile) ? readJSON(logFile) : {};
  const { b, p } = await signedIn();
  for (const it of picks) {
    if (done[it.doi]?.ok) continue;
    const t0 = Date.now();
    try {
      const r = await saveItem(p, it, folder);
      done[it.doi] = { key: it.key, ...r };
      writeJSON(logFile, done);
      log(`${it.key} ${it.title} => ${r.msg}`);
    } catch (e) {
      if (e.human) { log('JSTOR is asking for a human check. Solve it in Chrome, then run save again (it resumes).'); break; }
      log(`${it.key}: ${e.message}`);
    }
    await sleep(Math.max(0, SAVE_PACE_MS - (Date.now() - t0)));
  }
  const ok = Object.values(done).filter((x) => x.ok).length;
  log(`Saved ${ok} of ${picks.length}. Next: open the folder in JSTOR's Workspace, then run "slideai export".`);
  b.disconnect();
}

async function cmdExport(outDir) {
  const { b, p } = await signedIn();
  if (!/workspace/i.test(p.url())) {
    log('Open your Workspace folder in the Chrome window (JSTOR > Workspace > the folder). Waiting...');
    for (let i = 0; i < 200 && !/workspace/i.test(p.url()); i++) await sleep(3000);
    await sleep(4000);
  }
  const file = await exportFolder(b, p, outDir);
  log(`Downloaded: ${file}`);
  b.disconnect();
}

// Starter spec: title slide, one slide per pick (caption from the JSTOR record), link slides
// for "not in JSTOR", sources. You (or Claude) then edit order, notes and text slides.
async function cmdDraft(picksFile, exportFile, specFile, title) {
  const picks = readJSON(picksFile);
  const images = await parseJstorExport(fs.readFileSync(exportFile));
  const field = (rec, name) => ((rec.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi')) || [])[1] || '').trim();
  const slides = [{ type: 'title', title: title || path.basename(picksFile).replace(/\.picks\.json$/, ''), subtitle: '', notes: '' }];
  const links = [];
  for (const pk of picks) {
    const img = pk.doi && images[pk.doi];
    if (!img) { links.push(pk); slides.push({ type: 'text', title: pk.label, bullets: [{ text: `View it here: ${pk.label}`, url: 'https://artsandculture.google.com/search?q=' + encodeURIComponent(pk.q) }], notes: 'Not in JSTOR: link slide. Replace the link with the owning museum\'s page.' }); continue; }
    const creator = field(img.record, 'Creator').split(',')[0];
    const caption = [creator, field(img.record, 'Title'), field(img.record, 'Date')].filter(Boolean).join(', ');
    slides.push({ type: 'work', doi: pk.doi, caption: caption || pk.label, alt: caption || pk.label, notes: '', source: { name: 'JSTOR / Artstor', tier: 'B' } });
  }
  slides.push({ type: 'text', title: 'Sources', bullets: [{ text: 'Images: JSTOR (licensed through your institution); collections credited in each slide\'s notes.' }, ...(links.length ? [{ text: 'Works not in JSTOR are linked to museum or Google Arts & Culture pages.' }] : [])], notes: '' });
  const missing = Object.keys(images).filter((d) => !picks.some((p) => p.doi === d));
  writeJSON(specFile, { version: 1, title: slides[0].title, mode: 'teacher', slides });
  log(`Draft spec: ${specFile} (${slides.length} slides${missing.length ? `; ${missing.length} extra images in the export not in picks` : ''})`);
}

async function cmdBuild(specFile, exportFile, outFile) {
  const spec = readJSON(specFile);
  const images = exportFile && exportFile !== '-' ? await parseJstorExport(fs.readFileSync(exportFile)) : {};
  const warnings = [];
  const pptx = await buildDeck(spec, images, { warn: (m) => warnings.push(m) });
  fs.writeFileSync(outFile, await finish(pptx));
  log(`Built ${outFile}: ${spec.slides.length} slides`);
  warnings.forEach((w) => log('WARN', w));
}

// One guided run: search -> you pick -> save -> you open the folder -> export -> draft -> build.
// Every step resumes if stopped, so you can rerun the same command.
async function cmdMake(worksFile, folder) {
  const base = worksFile.replace(/\.json$/, '');
  const deckTitle = titleOf(worksFile);
  const picksFile = `${base}.picks.json`, specFile = `${base}.spec.json`;
  const outFile = deckTitle ? path.join(path.dirname(worksFile), `${safeName(deckTitle)}.pptx`) : `${base}.pptx`;
  if (!worksFile || !fs.existsSync(worksFile)) throw new Error(`Works list not found: ${worksFile || '(none given)'}. Example: node src/cli.js make ~/Desktop/test.json`);
  folder = folder || titleOf(worksFile) || path.basename(base);
  log(`STEP 1 of 5: sign in to JSTOR in the Chrome window.`);
  if (!fs.existsSync(picksFile)) { log('STEP 2 of 5: searching JSTOR and opening the contact sheet. Pick one image per work, then click Approve.'); await cmdPick(worksFile); }
  if (!fs.existsSync(picksFile)) { log('Stopped before approval. Run the same command again to continue.'); return; }
  log(`STEP 3 of 5: saving your picks to the JSTOR Workspace folder "${folder}" (about 15 seconds each).`);
  await cmdSave(picksFile, folder);
  log('STEP 4 of 5: in Chrome, open JSTOR > Workspace > the folder. The export starts by itself.');
  const before = fs.existsSync(path.join(HOME, 'downloads')) ? new Set(fs.readdirSync(path.join(HOME, 'downloads'))) : new Set();
  await cmdExport(path.join(HOME, 'downloads'));
  const exp = fs.readdirSync(path.join(HOME, 'downloads')).filter((f) => f.endsWith('.pptx') && !before.has(f)).map((f) => path.join(HOME, 'downloads', f))[0];
  if (!exp) { log('No export file found.'); return; }
  const localExp = `${base}.jstor.pptx`;
  fs.copyFileSync(exp, localExp);
  log('STEP 5 of 5: building your deck.');
  if (!fs.existsSync(specFile)) await cmdDraft(picksFile, localExp, specFile, titleOf(worksFile));
  await cmdBuild(specFile, localExp, outFile);
  fs.writeFileSync(path.join(path.dirname(worksFile), '.done'), new Date().toISOString());
  log(`DONE. Your deck: ${outFile}\nTo change wording, order or notes: edit ${specFile} (or ask Claude to), then run:\n  node src/cli.js build "${specFile}" "${localExp}" "${outFile}"`);
}

// Guided start for anyone: asks for a title and the works, makes the list, runs everything.
const safeName = (t) => t.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'My deck';
function openFolder(dir) {
  const opener = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try { spawn(opener, [dir], { detached: true, stdio: 'ignore' }).unref(); } catch { /* fine */ }
}
async function cmdNew() {
  // Line queue: works when typing, pasting several lines at once, or piping answers in.
  const rlx = readline.createInterface({ input: process.stdin, terminal: false });
  const queue = [], waiters = [];
  let closed = false;
  rlx.on('line', (l) => { if (waiters.length) waiters.shift()(l); else queue.push(l); });
  rlx.on('close', () => { closed = true; while (waiters.length) waiters.shift()(''); });
  const rl = {
    question: (prompt) => { process.stdout.write(prompt); return queue.length ? Promise.resolve(queue.shift()) : closed ? Promise.resolve('') : new Promise((r) => waiters.push(r)); },
    close: () => rlx.close(),
  };
  console.log('\n=== SlideAI (works with JSTOR Images) ===');
  console.log('Makes a PowerPoint from JSTOR images. You log in to JSTOR yourself and pick every image.\n');
  fs.mkdirSync(DECKS, { recursive: true });
  const unfinished = fs.readdirSync(DECKS).filter((d) => fs.existsSync(path.join(DECKS, d, 'works.json')) && !fs.existsSync(path.join(DECKS, d, '.done')));
  let worksFile = null;
  if (unfinished.length) {
    const a = (await rl.question(`Continue "${unfinished[0]}"? (y = continue, n = start a new deck) `)).trim().toLowerCase();
    if (a.startsWith('y')) worksFile = path.join(DECKS, unfinished[0], 'works.json');
  }
  if (!worksFile) {
    const title = safeName(await rl.question('Deck title (e.g. The Invention of Cubism): '));
    console.log('\nType the works you want, ONE PER LINE, like:  Braque, Houses at L\'Estaque, 1908');
    console.log('Up to 30. Press Enter on an empty line when you are done.\n');
    const works = [];
    for (;;) {
      const line = (await rl.question(`${works.length + 1}. `)).trim();
      if (!line) { if (works.length || closed) break; continue; }
      const q = line.replace(/\(.*?\)/g, ' ').replace(/\b(c\.|ca\.)?\s*\d{4}(\s*[-–]\s*\d{2,4})?\b/g, ' ').replace(/[,;:]/g, ' ').replace(/\s+/g, ' ').trim();
      works.push({ key: `w${works.length + 1}`, label: line, q });
      if (works.length >= 30) { console.log('That is 30, the limit.'); break; }
    }
    const dir = path.join(DECKS, title);
    fs.mkdirSync(dir, { recursive: true });
    worksFile = path.join(dir, 'works.json');
    writeJSON(worksFile, { title, works });
    console.log(`\nSaved your list: ${worksFile}`);
  }
  rl.close();
  await cmdMake(worksFile);
  openFolder(path.dirname(worksFile));
}

try {
  if (!cmd || cmd === 'new') await cmdNew();
  else if (cmd === 'make') { const folder = opt('folder'); await cmdMake(args[0], folder); }
  else if (cmd === 'login') { const { b } = await signedIn(); b.disconnect(); }
  else if (cmd === 'pick') await cmdPick(args[0]);
  else if (cmd === 'save') { const folder = opt('folder'); await cmdSave(args[0], folder); }
  else if (cmd === 'export') await cmdExport(opt('out', path.join(HOME, 'downloads')));
  else if (cmd === 'draft') await cmdDraft(args[0], args[1], args[2]);
  else if (cmd === 'build') await cmdBuild(args[0], args[1], args[2]);
  else if (cmd === 'help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); }
  else { log(`Unknown command "${cmd}". Try: new, make, build, help`); process.exit(2); }
  process.exit(0);
} catch (e) { log('ERROR', e.message); process.exit(1); }
