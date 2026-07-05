# Editing your media — no build step needed

All media lists live in the **`data/`** folder, one file per collection
(`data/coomer.js`, `data/gifs.js`, …). To add or remove links:

1. Open the file (GitHub web editor works fine).
2. Add/delete lines. Each file has instructions at the top.
3. Commit. Done — the live site reads these files directly.

**Video collections** use `SOURCES`:
```js
"https://…/video.mp4",                              // plain video
{ url: "https://…/video.mp4", start: 120, end: 155 }, // trimmed clip (seconds)
null,                                                // section break
```
Section-break labels come from `DIV_LABELS` at the top of the file, in order:
the 1st `null` gets the 1st label, and so on.

**Image collections** use `IMGS` — one URL string per line.

Order in the file = order on the page. Keep the trailing comma on every line.

**Home-page counts** self-heal: the badge updates automatically the first time
a collection page is opened after an edit.

**What still needs a rebuild (send the source zip to Claude):**
adding a whole new collection, renaming one, or any design/layout change.
