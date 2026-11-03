// Read a JSTOR "Export to PowerPoint" file: one slide per image, slide title = DOI,
// speaker notes = the full JSTOR record. Returns { [doi]: { image, ext, cx, cy, record } }.
import JSZip from 'jszip';

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const paragraphs = (xml) => (xml.match(/<a:p>[\s\S]*?<\/a:p>|<a:p [\s\S]*?<\/a:p>/g) || [])
  .map((p) => decode((p.match(/<a:t>([\s\S]*?)<\/a:t>/g) || []).map((t) => t.replace(/<\/?a:t>/g, '')).join('')))
  .filter((t) => t.trim());
const rels = (xml) => Object.fromEntries([...xml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
const resolve = (base, target) => {
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
  return parts.join('/');
};

export async function parseJstorExport(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const out = {};
  for (const f of slideFiles) {
    const xml = await zip.file(f).async('string');
    const relPath = f.replace('slides/', 'slides/_rels/') + '.rels';
    const r = zip.file(relPath) ? rels(await zip.file(relPath).async('string')) : {};
    const text = paragraphs(xml).join('\n');
    const doi = (text.match(/10\.\d{4,}\/[\w.\-]+/) || [])[0];
    const pic = xml.match(/<p:pic>[\s\S]*?<\/p:pic>/);
    if (!doi || !pic) continue;
    const embed = (pic[0].match(/r:embed="([^"]+)"/) || [])[1];
    const ext = pic[0].match(/<a:ext cx="(\d+)" cy="(\d+)"/);
    const media = embed && r[embed] ? resolve(f, r[embed]) : null;
    const notesTarget = Object.values(r).find((t) => /notesSlide/.test(t));
    const notesXml = notesTarget ? await zip.file(resolve(f, notesTarget))?.async('string') : '';
    out[doi] = {
      doi,
      image: media ? await zip.file(media).async('nodebuffer') : null,
      ext: media ? media.split('.').pop().toLowerCase() : null,
      cx: ext ? Number(ext[1]) : null,
      cy: ext ? Number(ext[2]) : null,
      record: notesXml ? paragraphs(notesXml)
        .filter((t) => !/^(\d+|‹#›)$/.test(t.trim()))
        .map((t) => t.replace(/<a\s+href="\s*([^"]+?)\s*"[^>]*>(.*?)<\/a>/gi, '$2 ($1)'))
        .join('\n') : '',
    };
  }
  return out;
}
