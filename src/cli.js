#!/usr/bin/env node
// SlideAI (works with JSTOR Images): local helper.
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
import { browser, page, waitForAccess, sleep, log, HOME } from './jstor/session.js';
import { searchWork, saveItem, exportFolder } from './jstor/actions.js';
import { parseJstorExport } from './jstor/parse.js';
import { buildDeck, finish } from './build/deck.js';

const [cmd, ...args] = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : d; };
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJSON = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 1));
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
  const works = normWorks(readJSON(worksFile));
  if (works.length > MAX_ITEMS + 5) throw new Error(`Too many works (${works.length}); keep a deck under ${MAX_ITEMS} images.`);
  const candFile = worksFile.replace(/\.json$/, '') + '.candidates.json';
  const cand = fs.existsSync(candFile) ? readJSON(candFile) : {};
  const { b, p } = await signedIn();
  for (const w of works) {
    if (cand[w.key]?.cards?.length) continue;
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

// Local contact sheet: top 4 per work, first result pre-selected (green); "link slide" if none fit.
function contactSheet(b, works, cand, picksFile) {
  return new Promise((resolve) => {
    const rows = works.map((w) => {
      const c = cand[w.key]?.cards || [];
      const opts = c.map((x, i) => `<label class="c${i === 0 ? ' g' : ''}"><input type="radio" name="${w.key}" value="${i}"${i === 0 ? ' checked' : ''}>
        ${x.thumb ? `<img src="${x.thumb}" alt="">` : '<div class="noimg">no preview</div>'}<b>${esc(x.title)}</b><small>${esc(x.meta)}</small></label>`).join('');
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
    </style><h1>Pick one image per work</h1><p>Green = suggested (JSTOR's top match). Change any pick, or choose "link slide". Nothing is saved to JSTOR until you run <code>slideai save</code>.</p>
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
async function cmdDraft(picksFile, exportFile, specFile) {
  const picks = readJSON(picksFile);
  const images = await parseJstorExport(fs.readFileSync(exportFile));
  const field = (rec, name) => ((rec.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi')) || [])[1] || '').trim();
  const slides = [{ type: 'title', title: path.basename(picksFile).replace(/\.picks\.json$/, ''), subtitle: '', notes: '' }];
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

try {
  if (cmd === 'login') { const { b } = await signedIn(); b.disconnect(); }
  else if (cmd === 'pick') await cmdPick(args[0]);
  else if (cmd === 'save') { const folder = opt('folder'); await cmdSave(args[0], folder); }
  else if (cmd === 'export') await cmdExport(opt('out', path.join(HOME, 'downloads')));
  else if (cmd === 'draft') await cmdDraft(args[0], args[1], args[2]);
  else if (cmd === 'build') await cmdBuild(args[0], args[1], args[2]);
  else { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 10).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(cmd ? 2 : 0); }
  process.exit(0);
} catch (e) { log('ERROR', e.message); process.exit(1); }
