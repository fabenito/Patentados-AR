"""Arma site/data/mapa.json a partir del GeoJSON simplificado de provincias.

Fuente: politicaargentina/data_warehouse, geoAr provincias_simplified.geojson.
Las claves coinciden con PROV_KEYS de tools/build.py.
"""
import json
from pathlib import Path

import urllib.request

ROOT = Path(__file__).resolve().parent.parent
SRC = "https://github.com/politicaargentina/data_warehouse/raw/master/geoAr/data/provincias_simplified.geojson"
CODES = {
    "02": ("caba", "CABA"),
    "06": ("buenos aires", "Buenos Aires"),
    "10": ("catamarca", "Catamarca"),
    "22": ("chaco", "Chaco"),
    "26": ("chubut", "Chubut"),
    "14": ("cordoba", "Córdoba"),
    "18": ("corrientes", "Corrientes"),
    "30": ("entre rios", "Entre Ríos"),
    "34": ("formosa", "Formosa"),
    "38": ("jujuy", "Jujuy"),
    "42": ("la pampa", "La Pampa"),
    "46": ("la rioja", "La Rioja"),
    "50": ("mendoza", "Mendoza"),
    "54": ("misiones", "Misiones"),
    "58": ("neuquen", "Neuquén"),
    "62": ("rio negro", "Río Negro"),
    "66": ("salta", "Salta"),
    "70": ("san juan", "San Juan"),
    "74": ("san luis", "San Luis"),
    "78": ("santa cruz", "Santa Cruz"),
    "82": ("santa fe", "Santa Fe"),
    "86": ("santiago del estero", "Santiago del Estero"),
    "94": ("tierra del fuego", "Tierra del Fuego"),
    "90": ("tucuman", "Tucumán"),
}


def rings(geom):
    if geom["type"] == "Polygon":
        return geom["coordinates"]
    return [ring for poly in geom["coordinates"] for ring in poly]


def main():
    cache = Path(__file__).with_suffix(".geojson")
    if cache.exists():
        raw = cache.read_bytes()
    else:
        raw = urllib.request.urlopen(SRC, timeout=60).read()
        cache.write_bytes(raw)
    data = json.loads(raw)
    pts = [xy for f in data["features"] for ring in rings(f["geometry"]) for xy in ring]
    minx = min(p[0] for p in pts)
    maxx = max(p[0] for p in pts)
    miny = min(p[1] for p in pts)
    maxy = max(p[1] for p in pts)
    pad, W, H = 8, 420, 760
    s = min((W - 2 * pad) / (maxx - minx), (H - 2 * pad) / (maxy - miny))
    ox = pad + ((W - 2 * pad) - (maxx - minx) * s) / 2
    oy = pad + ((H - 2 * pad) - (maxy - miny) * s) / 2

    def xy(lon, lat):
        return round(ox + (lon - minx) * s, 1), round(oy + (maxy - lat) * s, 1)

    items = []
    for feat in data["features"]:
        code = str(feat["properties"].get("codprov_censo", "")).zfill(2)
        key, name = CODES[code]
        parts = []
        for ring in rings(feat["geometry"]):
            if len(ring) < 3:
                continue
            step = max(1, len(ring) // 90)
            use = ring[::step]
            if use[0] != ring[0]:
                use = [ring[0]] + use
            if use[-1] != ring[-1] and ring[0] == ring[-1]:
                use = use + [ring[-1]]
            a, b = xy(*use[0])
            d = f"M{a} {b}"
            for lon, lat in use[1:]:
                x, y = xy(lon, lat)
                d += f"L{x} {y}"
            parts.append(d + "Z")
        items.append({"k": key, "n": name, "d": "".join(parts)})
    items.sort(key=lambda it: it["k"])
    out = {"w": W, "h": H, "items": items}
    dest = ROOT / "site" / "data" / "mapa.json"
    dest.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"{dest.name}: {len(items)} provincias, {dest.stat().st_size / 1e3:.0f} KB")


if __name__ == "__main__":
    main()
