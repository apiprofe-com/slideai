"""One-off: turn ~/ed/scripts/deck/build.py (the Nov 2 Picasso/Braque deck) into a SlideAI deck spec.
Runs build.py in memory (never saves), then reads the ordered slides. Usage:
  python3 tools/extract_spec_from_buildpy.py <build.py> <jstor-dir-with-dl/> <out.json>"""
import json, os, re, sys
src, jdir, out = sys.argv[1], sys.argv[2], sys.argv[3]
code = open(src).read()
code = code.replace("import os; os.makedirs('out',exist_ok=True); prs.save(OUT); print('saved',OUT,len(prs.slides),'slides')", "")
os.chdir(jdir)
ns = {}
exec(compile(code, src, 'exec'), ns)
order, CAP, t, tl = ns['order'], ns['CAP'], ns['t'], ns['tl']
cap_by_slide = {id(ns['by_doi'][d]): (d, c, n) for d, (c, n) in CAP.items()}
slides = []
def bullets_of(s):
    out = []
    body = [sh for sh in s.placeholders if sh.placeholder_format.idx == 1]
    if not body: return out
    for p in body[0].text_frame.paragraphs:
        runs = p.runs
        if not runs: continue
        url = runs[0].hyperlink.address
        out.append({'text': ''.join(r.text for r in runs), **({'url': url} if url else {})})
    return out
def notes_of(s):
    return s.notes_slide.notes_text_frame.text if s.has_notes_slide else ''
for s in order:
    if s is t:
        sub = [sh for sh in s.shapes if sh.has_text_frame and sh != s.shapes.title][-1].text_frame.text
        slides.append({'type': 'title', 'title': s.shapes.title.text_frame.text, 'subtitle': sub, 'notes': notes_of(s)})
    elif s is tl:
        evs = re.findall(r"ev\(([\d.]+),'([BP])',\"([^\"]+)\"(,above=False)?\)", code)
        marks = re.findall(r"\(([\d.]+),\"([A-Z ]+)\"\)", code.split('for y,txt in')[1].split(':')[0])
        slides.append({'type': 'timeline', 'title': 'Two lanes, one road: 1905–1914', 'start': 1905, 'end': 1914,
            'lanes': [{'id': 'B', 'label': 'BRAQUE', 'color': 'A31F1F'}, {'id': 'P', 'label': 'PICASSO', 'color': '1F4E9A'}],
            'events': [{'year': float(y), 'lane': l, 'text': txt, 'above': not a} for y, l, txt, a in evs],
            'markers': [{'year': float(y), 'text': txt} for y, txt in marks], 'notes': notes_of(s)})
    elif id(s) in cap_by_slide:
        d, c, n = cap_by_slide[id(s)]
        slides.append({'type': 'work', 'doi': '10.2307/' + d, 'caption': c, 'notes': n, 'alt': c,
                       'source': {'name': 'JSTOR / Artstor', 'tier': 'B'}})
    else:
        slides.append({'type': 'text', 'title': s.shapes.title.text_frame.text, 'bullets': bullets_of(s), 'notes': notes_of(s)})
spec = {'version': 1, 'title': slides[0]['title'], 'mode': 'teacher',
        'jstor': {'folder': "ARH1000 Braque & Picasso: Cubism (Prof. Blanco)"},
        'notes_suffix': 'SOURCES: JSTOR/Artstor record below; museum collection pages; Smarthistory (smarthistory.org); Tate and MoMA online collection essays.',
        'slides': slides}
json.dump(spec, open(out, 'w'), ensure_ascii=False, indent=1)
print('slides', len(slides), {k: sum(1 for x in slides if x['type'] == k) for k in ('title', 'text', 'work', 'timeline')})
