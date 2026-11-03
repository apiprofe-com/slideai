# Plan: SlideAI on Windows + keyword intake

Status: **PLAN ONLY.** Written 2026-11-03 after the first live run passed end to end (9:02–9:15 AM:
5 searches → contact sheet → 4 saved → export auto-captured → 7-slide deck). Build only on Lucas's
OK in the apiprofe tab.

## Bugs first (before new features)
| Bug | Status |
|---|---|
| Broken thumbnails (Braque, Derain, Mondrian) | **Fixed after the run** (commit "Fix contact sheet thumbnails…"): waits for the image to load, checks it's really an image, falls back to a screenshot of the image, else shows "no preview". **Needs a rerun to confirm.** |
| Suggested pick wrong (Braque → link slide, Mondrian 1937–42 instead of 1930) | **Fixed:** green = best artist/title/date match, with year ranges understood. Checked on the run's real results: Cézanne 1905, Braque 1908, Derain c. 1906, Mondrian 1930 |
| "STEP 1, STEP 2, then ENOENT" when the list file is missing | **Fixed:** checks the file first |
| Draft title slide says "test" (the file name) | To fix: ask for a deck title at the start, or take it from the keywords |
| Export waits for the user to open the Workspace folder | To fix: go to the folder automatically. Needs its URL pattern, which we capture on the next run |
| No way to look at slides on the Mac | Install LibreOffice (free) for automatic slide previews, if Lucas OKs it |

## 1. Windows support
**What already works on Windows:**
- Chrome is found with `puppeteer.executablePath('chrome')`, which knows the Windows install paths.
- Folders use Node's `os.homedir()` and `path.join`, so `~/.slideai` becomes
  `C:\Users\<name>\.slideai`.
- Chrome is started detached; Windows behaves the same.

**To change:**
- **Folders:** keep app data in `%LOCALAPPDATA%\SlideAI` (the Windows convention) and put decks
  in **Documents\SlideAI\<deck name>** by default. (Desktop is often inside OneDrive on Windows,
  which syncs and locks files.)
- **Paths with spaces:** all paths go through Node, not the shell. In the README, use
  `slideai make "C:\Users\…\My Deck.json"` with quotes.
- **No `~` in instructions:** PowerShell and cmd treat it differently. Make the default a short
  `slideai new` that asks questions instead of needing a path (see keyword intake).
- **Line endings and file names:** clean deck names of characters Windows forbids (`: * ? " < > |`).

**Install options (pick one, question 1):**
| Option | User steps | Effort | Notes |
|---|---|---|---|
| **A. npm package** | Install Node (one installer), then `npx slideai new` | 0.5 d | Simplest to build; Node is a hurdle for some faculty |
| **B. One-file app (.exe / Mac app)** using Node's "single executable" build | Download, double-click | 1.5–2 d | Uses the installed Chrome, so it stays small. **Unsigned apps trigger Windows SmartScreen and macOS warnings**; code-signing certificates cost about $100–400/year |
| C. Chrome extension (later plan) | Install from the Chrome Web Store | 5–7 d | No Node and no separate window; the best for students |

**Testing without a PC:**
- **Automatic:** GitHub Actions on a free Windows machine runs the builder tests, builds the
  cubism deck offline, and launches Chrome once (no JSTOR) on every change.
- **Real JSTOR test on Windows:** a Windows virtual machine on the Mac (UTM, free; Windows 11 ARM
  runs Chrome), or **one colleague or student with a Windows laptop** running the 5-work test.
  JSTOR login must be done by a real person either way.

**Effort:** 1.5–2 days (paths, folders, `new` prompt, CI on Windows, README for Windows), plus 1.5–2
days if we also make the one-file app.

## 2. Keyword intake (no works list needed)
**How it starts:**
```
slideai new
  Deck title?            The Invention of Cubism
  Keywords?              #cubism #1907-1914 #braque #picasso #oil, collage
  How many images?       25
```
Or in one line: `slideai make --keywords "#cubism #1907-1914 #braque #oil, collage" --title "…"`.
**The works-list file stays as an option** (better when Claude or the teacher has a specific
list).

**Reading the keywords (no AI needed):**
- Split on `#` and commas.
- Sort each keyword with small built-in word lists:
  - **dates:** `1907-1914`, `1900s`, `early 20th century` become a year range;
  - **movements:** cubism, fauvism, impressionism… (a list of about 150);
  - **media:** oil, collage, sculpture, photograph, print, drawing…;
  - **everything else** is treated as an artist name or a theme, e.g. `#braque`, `#portraits`.
- Show the reading back to the user before searching, so they can correct it: "Artists: Braque,
  Picasso · Years: 1907–1914 · Movement: Cubism · Media: oil, collage".

**Searching:**
- Build a few JSTOR image searches from the combinations, e.g. "braque cubism", "picasso cubism",
  "braque collage", "cubism oil". For each, read **2–3 pages of results (12–24 cards)**, at the
  same human pace.
- **Date and medium:** use JSTOR's own filters if the image search has them in its address. **We
  need to look during a logged-in session to confirm** (a short Phase 0). Otherwise filter by the
  dates in each card's details.
- Remove duplicates by DOI, read creator, date and collection from each card, and drop cards
  outside the year range (shown greyed out, not hidden).
- **Caps:** at most about 12 searches and 60 cards per deck, so it stays human-paced.

**The new contact sheet:**
- Grouped **by artist, then by date**.
- Tick boxes rather than one-per-row, with a counter ("24 of 25 picked") and a reminder of the 30
  limit.
- **Suggested set pre-ticked:** spread across the date range (early / middle / late, which is the
  ARH1000 rubric's span), one per work title, and no near-duplicates (same title, same date).
- **"More like this"** on any card runs one more search (that artist + that title's words), and the
  new cards appear in place. Paced and counted against the cap.
- **"Not in JSTOR?"** box: type a work and it becomes a link slide.

**Order and sections (no AI):**
- **One artist:** sorted by date, split into early / middle / late sections at the natural gaps
  in the dates.
- **Two or more artists:** sections by movement if the keywords include them, else by period. A
  **timeline slide** is built automatically (one lane per artist, events = the works' dates).
- Section slides get plain titles ("1907–1909: Braque") the user can rename.
- **Title slide** from the deck title; sources slide from the JSTOR records.

**Does it need AI?** **No, for all of the above:** word lists, JSTOR's search, dates and simple
rules. AI would help with:
- turning "#cubism" into a list of key works;
- naming sections well;
- writing notes and a thesis.

That's **optional and later**, through the apiprofe connector in the user's own Claude (free to
apiprofe), or about 5–20 cents a deck if apiprofe pays. The local helper stays AI-free.

**Effort:**
| Piece | Days |
|---|---|
| Phase 0 look at JSTOR's image filters (logged in) | 0.5 |
| Keyword reader + read-back + query builder | 1 |
| Multi-page search, dedupe, card details, year filter | 1 |
| New contact sheet (grouped, tick boxes, counter, suggested set, "more like this", link box) | 2 |
| Automatic order, sections, timeline, title | 1–1.5 |
| **Total** | **about 5.5–6 days** |

## Suggested order
1. Rerun the 5-work test to confirm the bug fixes, and capture the Workspace folder URL. (15 min
   with Lucas)
2. Small fixes: deck title prompt, automatic Workspace navigation. (0.5 d)
3. Keyword intake. (5.5–6 d)
4. Windows. (1.5–2 d; + 1.5–2 d for a one-file app)

## Questions for Lucas
1. **Windows install:** npm (`npx slideai`, needs Node) first, or go straight to a double-click app
   (and pay for code signing to avoid security warnings)?
2. **Who can test on Windows?** A colleague or student with a Windows laptop, or should I set up a
   Windows virtual machine on your Mac?
3. **Default number of images** in keyword mode: 25? And should the early/middle/late spread always
   be on, or only with the ARH1000 preset?
4. **Install LibreOffice** so I can check slides visually myself?
