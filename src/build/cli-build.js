#!/usr/bin/env node
// slideai build <spec.json> <jstor-export.pptx> <out.pptx>
import fs from 'node:fs';
import { parseJstorExport } from '../jstor/parse.js';
import { buildDeck, finish } from './deck.js';

const [specPath, jstorPath, outPath] = process.argv.slice(2);
if (!specPath || !outPath) { console.error('usage: cli-build.js <spec.json> <jstor-export.pptx|-> <out.pptx>'); process.exit(2); }
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const images = jstorPath && jstorPath !== '-' ? await parseJstorExport(fs.readFileSync(jstorPath)) : {};
const warnings = [];
const pptx = await buildDeck(spec, images, { warn: (m) => warnings.push(m) });
fs.writeFileSync(outPath, await finish(pptx));
const used = new Set(spec.slides.filter((s) => s.type === 'work').map((s) => s.doi));
const unused = Object.keys(images).filter((d) => !used.has(d));
console.log(`built ${outPath}: ${spec.slides.length} slides`);
warnings.forEach((w) => console.log('WARN', w));
if (unused.length) console.log('NOTE: images in the export not used in the spec:', unused.join(', '));
