// Build a clean 16:9 deck (13.33 x 7.5 in) from a SlideAI deck spec plus images parsed
// from the user's own JSTOR export. Every slide has a real title (screen readers, the
// PowerPoint accessibility checker), every image has alt text, and the JSTOR record is kept
// at the bottom of each work slide's notes.
import PptxGenJS from 'pptxgenjs';

const INK = '1B1B1B', GREY = '555555', BLUE = '1F4E9A', W = 13.333, H = 7.5;
const FONT = 'Calibri';

function masters(pptx) {
  pptx.defineSlideMaster({
    title: 'TITLE',
    background: { color: 'FFFFFF' },
    objects: [{ placeholder: { options: { name: 'title', type: 'title', x: 0.8, y: 2.2, w: W - 1.6, h: 1.6, fontFace: FONT, fontSize: 40, bold: true, color: INK, align: 'center', valign: 'middle' }, text: '' } }],
  });
  pptx.defineSlideMaster({
    title: 'TEXT',
    background: { color: 'FFFFFF' },
    objects: [{ placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 0.35, w: W - 1.2, h: 1.0, fontFace: FONT, fontSize: 34, bold: true, color: INK, valign: 'middle' }, text: '' } }],
  });
  pptx.defineSlideMaster({
    title: 'WORK',
    background: { color: 'FFFFFF' },
    objects: [{ placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: H - 1.05, w: W - 1.0, h: 0.75, fontFace: FONT, fontSize: 22, color: INK, align: 'center', valign: 'middle' }, text: '' } }],
  });
}

function workNotes(s, img, spec) {
  const parts = [s.notes || ''];
  if (spec.notes_suffix) parts.push(spec.notes_suffix);
  if (s.source) parts.push(`Source: ${s.source.name}${s.source.tier ? ` (tier ${s.source.tier})` : ''}`);
  if (img?.record) parts.push(`JSTOR RECORD:\n${img.record}`);
  return parts.filter(Boolean).join('\n\n');
}

function addWork(pptx, s, img, spec, warn) {
  const slide = pptx.addSlide({ masterName: 'WORK' });
  slide.addText(s.caption, { placeholder: 'title' });
  if (!img?.image) {
    warn(`No JSTOR image for ${s.doi} (${s.caption}); slide has caption only.`);
    slide.addText('Image not found in the JSTOR export', { x: 1, y: 3, w: W - 2, h: 1, align: 'center', color: GREY, fontSize: 20, fontFace: FONT });
  } else {
    const boxX = 0.5, boxY = 0.35, boxW = W - 1.0, boxH = H - 1.55;
    const ratio = img.cx && img.cy ? img.cx / img.cy : 4 / 3;
    let w = boxW, h = w / ratio;
    if (h > boxH) { h = boxH; w = h * ratio; }
    slide.addImage({
      data: `image/${img.ext === 'jpg' ? 'jpeg' : img.ext};base64,${img.image.toString('base64')}`,
      x: boxX + (boxW - w) / 2, y: boxY + (boxH - h) / 2, w, h,
      altText: s.alt || s.caption,
    });
  }
  slide.addNotes(workNotes(s, img, spec));
}

function addText(pptx, s) {
  const slide = pptx.addSlide({ masterName: 'TEXT' });
  slide.addText(s.title, { placeholder: 'title' });
  const n = s.bullets.length;
  const size = s.size || (n > 6 ? 18 : n > 4 ? 20 : 22);
  slide.addText(s.bullets.map((b) => ({
    text: b.text,
    options: { bullet: true, breakLine: true, paraSpaceAfter: 8, ...(b.url ? { hyperlink: { url: b.url, tooltip: b.text }, color: BLUE, underline: { style: 'sng' } } : {}) },
  })), { x: 0.8, y: 1.5, w: W - 1.6, h: H - 2.0, fontFace: FONT, fontSize: size, color: INK, valign: 'top' });
  if (s.notes) slide.addNotes(s.notes);
}

function addTitle(pptx, s) {
  const slide = pptx.addSlide({ masterName: 'TITLE' });
  slide.addText(s.title, { placeholder: 'title' });
  if (s.subtitle) slide.addText(s.subtitle, { x: 1, y: 4.2, w: W - 2, h: 1.4, align: 'center', fontFace: FONT, fontSize: 20, color: GREY });
  if (s.notes) slide.addNotes(s.notes);
}

// Two (or more) lanes of dated events, with dotted "where the lanes touch" markers.
function addTimeline(pptx, s) {
  const slide = pptx.addSlide({ masterName: 'TEXT' });
  slide.addText(s.title, { placeholder: 'title' });
  const x0 = 1.6, x1 = W - 0.4, span = (s.end - s.start) + 0.6;
  const xs = (y) => x0 + (y - s.start) * (x1 - x0) / span;
  const top = 2.75, bottom = 5.2;
  const laneY = s.lanes.map((_, i) => (s.lanes.length === 1 ? (top + bottom) / 2 : top + i * (bottom - top) / (s.lanes.length - 1)));
  s.lanes.forEach((lane, i) => {
    slide.addShape(pptx.ShapeType.line, { x: x0, y: laneY[i], w: x1 - x0, h: 0, line: { color: lane.color, width: 4 } });
    slide.addText(lane.label, { x: 0.1, y: laneY[i] - 0.25, w: 1.45, h: 0.5, fontFace: FONT, fontSize: 14, bold: true, color: lane.color });
  });
  const axisY = H - 0.8;
  slide.addShape(pptx.ShapeType.line, { x: x0, y: axisY, w: x1 - x0, h: 0, line: { color: GREY, width: 1 } });
  for (let y = s.start; y <= s.end; y++) {
    slide.addText(String(y), { x: xs(y) - 0.4, y: axisY + 0.05, w: 0.8, h: 0.35, align: 'center', fontFace: FONT, fontSize: 12, color: GREY });
  }
  const laneIndex = Object.fromEntries(s.lanes.map((l, i) => [l.id, i]));
  for (const e of s.events) {
    const i = laneIndex[e.lane] ?? 0, ly = laneY[i], col = s.lanes[i].color;
    slide.addShape(pptx.ShapeType.ellipse, { x: xs(e.year) - 0.09, y: ly - 0.09, w: 0.18, h: 0.18, fill: { color: col }, line: { color: col } });
    const bw = 1.6, left = Math.min(Math.max(xs(e.year) - bw / 2, x0 - 0.1), W - bw - 0.1);
    slide.addText(e.text, { x: left, y: e.above === false ? ly + 0.15 : ly - 0.95, w: bw, h: 0.8, align: 'center', valign: e.above === false ? 'top' : 'bottom', fontFace: FONT, fontSize: 10.5, color: INK, fit: 'shrink' });
  }
  if (s.lanes.length > 1) {
    for (const m of s.markers || []) {
      slide.addShape(pptx.ShapeType.line, { x: xs(m.year), y: laneY[0], w: 0, h: laneY[laneY.length - 1] - laneY[0], line: { color: GREY, width: 1.5, dashType: 'dash' } });
    }
  }
  const alt = s.lanes.map((l) => `${l.label}: ` + s.events.filter((e) => e.lane === l.id).map((e) => `${Math.floor(e.year)} ${e.text}`).join('; ')).join('. ');
  slide.addNotes([s.notes, `TIMELINE (text version): ${alt}`].filter(Boolean).join('\n\n'));
}

export async function buildDeck(spec, images, { warn = console.warn } = {}) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = spec.title;
  pptx.author = spec.author || '';
  masters(pptx);
  for (const s of spec.slides) {
    if (s.type === 'title') addTitle(pptx, s);
    else if (s.type === 'text') addText(pptx, s);
    else if (s.type === 'work') addWork(pptx, s, images[s.doi], spec, warn);
    else if (s.type === 'timeline') addTimeline(pptx, s);
    else warn(`Unknown slide type ${s.type}`);
  }
  return pptx;
}

// pptxgenjs gives title placeholders idx="100"; strict readers (and some accessibility
// checkers) expect the title at idx 0. Rewrite that in the finished file.
export async function finish(pptx) {
  const { default: JSZip } = await import('jszip');
  const buf = await pptx.write({ outputType: 'nodebuffer' });
  const zip = await JSZip.loadAsync(buf);
  for (const f of Object.keys(zip.files).filter((n) => /^ppt\/(slides|slideLayouts)\/[^/]+\.xml$/.test(n))) {
    const xml = await zip.file(f).async('string');
    const fixed = xml.replace(/<p:ph\s+idx="100"\s+type="title"/g, '<p:ph type="title"');
    if (fixed !== xml) zip.file(f, fixed);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
