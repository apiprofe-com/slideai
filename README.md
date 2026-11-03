# SlideAI (works with JSTOR Images)

Turn "I need a lecture on Braque and Picasso" into a finished PowerPoint built from JSTOR images.
You stay in charge: you log in to JSTOR yourself, you pick every image, and nothing is saved to
JSTOR until you approve.

## How it works (the big picture)
```
 1. PLAN       You (with Claude) write the list of works          ->  my-lecture.json
 2. SEARCH     SlideAI searches JSTOR for each work, top 4 each    ->  contact sheet in Chrome
 3. PICK       You click the best image for each work, Approve     ->  my-lecture.picks.json
 4. SAVE       SlideAI saves your picks to a JSTOR Workspace folder (15 s apart, like a person)
 5. EXPORT     You open that folder in JSTOR; SlideAI exports it   ->  my-lecture.jstor.pptx
 6. BUILD      SlideAI builds a clean deck: captions, alt text,    ->  my-lecture.pptx
               link slides, sources, your notes + JSTOR records
```
Steps 2–6 are **one command**. If anything stops it (a JSTOR "are you human?" check, a closed
window), run the same command again and it picks up where it left off.

## Before the first time (once)
- Google Chrome installed.
- Node installed (already on Lucas's Mac).
- In Terminal: `cd ~/slideai && npm install`

## Make a deck
**1. Write the works list.** Easiest: ask Claude, "Make a SlideAI works list for a lecture on ___".
It's a small file like this (`label` is what you'll see, `q` is what gets searched in JSTOR):
```json
[
  { "key": "cez", "label": "Cézanne, Mont Sainte-Victoire (1902-06)", "q": "Cezanne Mont Sainte-Victoire" },
  { "key": "bq1", "label": "Braque, Houses at L'Estaque (1908)", "q": "Braque Houses at L'Estaque" }
]
```
Save it anywhere, e.g. `~/Desktop/cubism.json`. Keep it to 30 works or fewer.

**2. Run it:**
```sh
cd ~/slideai
node src/cli.js make ~/Desktop/cubism.json --folder "ARH1000 Cubism"
```

**3. What you'll see and do:**
| Terminal says | You do |
|---|---|
| STEP 1: sign in to JSTOR | A Chrome window opens on JSTOR. Log in your school's way ("Access through your institution"). Solve any "are you human?" check. It continues by itself once JSTOR shows **"Access provided by …"**. You only log in once; the window remembers you. |
| STEP 2: searching… contact sheet | Wait about 10 seconds per work. A **contact sheet** tab opens: 4 images per work, the suggested one outlined **green**. Click a different one if you like, or "use a link slide" if none fit (e.g. Picasso, whose works aren't in JSTOR). Click **Approve picks**. |
| STEP 3: saving… | Nothing to do. About 15 seconds per image (JSTOR expects a person's pace). |
| STEP 4: open the folder | In Chrome: JSTOR → **Workspace** → your folder. The export starts by itself and takes 1–2 minutes. |
| DONE | Your deck is next to your works list: `~/Desktop/cubism.pptx`. Open it in PowerPoint, Keynote or Google Slides. |

**4. Make it yours.** The first build is a clean draft: title slide, one slide per work with an
"Artist, Title, date" caption, link slides, and a sources slide. To add talking points, section
slides, a timeline or new order, edit `cubism.spec.json` (or ask Claude to). Then rebuild in
seconds; no JSTOR needed:
```sh
node src/cli.js build ~/Desktop/cubism.spec.json ~/Desktop/cubism.jstor.pptx ~/Desktop/cubism.pptx
```

## Where things are
- Your files: next to your works list (`.picks.json`, `.spec.json`, `.jstor.pptx`, `.pptx`).
- SlideAI's own Chrome profile (your JSTOR login session): `~/.slideai/chrome-profile`.
- Exports downloaded from JSTOR: `~/.slideai/downloads`.

## The rules it follows
- **It never sees your password.** You log in on JSTOR's own page.
- **Nothing is saved to JSTOR until you approve the contact sheet.**
- Human pace, at most 30 images per deck, and it stops at any "are you human?" check.
- Your images stay in your JSTOR Workspace and on your computer. Nothing is uploaded anywhere.
- Works still in copyright that JSTOR doesn't have get a **link slide** to the museum, never a
  copied image.
- Use it for your own teaching and coursework under your school's JSTOR terms.

## Example
`examples/cubism.spec.json` is the full Nov 2 lecture ("Roped Together: Braque, Picasso & the
Invention of Cubism", 35 slides: timeline, sections, link slides, notes).

Not affiliated with JSTOR or ITHAKA. JSTOR is a trademark of ITHAKA.
