# Patentados AR

Static site (Spanish) that explores DNRPA "inscripciones iniciales de autos", one month at a time:
model lookup with history, filters, charts, rarest models, supercars and exotics, classics,
hybrids/EVs. Prices are links to Mercado Libre searches (no scraping).

```
site/            what Render publishes (index.html, app.js, styles.css)
site/data/       generated: index.json, months/AAAA-MM.json.gz, exoticos.json (hand-edited)
tools/build.py   turns monthly CSVs into the files in site/data
raw/             drop the CSVs here (ignored by git)
render.yaml      Render blueprint (static site, publishes ./site)
```

## Add months (first load and every month after)

1. Download the monthly CSVs from https://datos.gob.ar/dataset/inscripciones-iniciales-de-autos
   into `raw/`. Keep the month in the file name (`...-202609.csv`); that is how the month is detected.
2. Once: `pip install -r requirements.txt`
3. `python tools/build.py add raw/*.csv`   (any number of files; re-running a month replaces it)
4. `git add site/data && git commit -m "Add 2026-10" && git push`

Transferencias (usados) viven en otra carpeta, fuera del repo. Para regenerar `site/data/usados.json.gz`:

`python tools/build.py transfers ..\transferencias`

Ese archivo sí se commitea. Los CSV no.

Render redeploys on push. Each month is about 190 KB compressed, so 2018 to 2026 is roughly 20 MB.
The site only downloads the months you select, never everything at once unless you pick "Todo el período".

Missing months inside the range show as dashed gaps in the charts.

## Deploy on Render

1. Push this folder to a GitHub repo (commit `site/data` too; `raw/*.csv` stays out).
2. Render dashboard: New, Blueprint, pick the repo. It reads `render.yaml`.
   Or New, Static Site manually: Publish Directory `site`, Build Command left empty or `echo ok`.
3. Static sites are free on Render. Any push to the branch redeploys.

## Customize

- `site/data/exoticos.json`: which brands and model patterns count as Superdeportivos / Lujo extremo /
  Deportivos de culto. Changes apply on reload, no rebuild needed.
- Hybrid/EV detection and the "autos, SUV, pickups" body-type filter live at the top of `site/app.js`.

## Notes

- Counts are vehicles: each CSV row is weighted by its ownership share (a car with two owners is 2 rows of 50%).
- These are initial registrations per month, not the national fleet.
- `build.py` tolerates missing optional columns and `;` separators or latin-1 encoding, since older files
  may differ. It was tested with the 2026-09 layout. If an older file fails, the error lists the columns found.
- The browser needs `DecompressionStream` (Chrome 80+, Firefox 113+, Safari 16.4+). To debug, build with `--plain`.
