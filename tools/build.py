#!/usr/bin/env python3
"""
Convierte los CSV mensuales de DNRPA (inscripciones iniciales de autos) en los
archivos que usa el sitio.

  python tools/build.py add raw/*.csv        # procesa uno o varios CSV y reconstruye el índice
  python tools/build.py reindex              # solo reconstruye site/data/index.json

Opciones:
  --out DIR     carpeta de salida (por defecto site/data)
  --plain       escribe .json en vez de .json.gz (útil para depurar)

Cada CSV se guarda como site/data/months/AAAA-MM.json.gz. El mes sale del nombre
del archivo (por ejemplo ...-202609.csv); si el nombre no lo tiene, se toma del
contenido. Volver a procesar un mes lo reemplaza.
"""
import argparse
import gzip
import json
import re
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "site" / "data"

ORIGENES = ["Nacional", "Importado", "Protocolo 21"]
TRAMITES = ["Nacional", "Importado", "Por dictamen u oficio", "Formulario 05", "Auto clásico"]
TWO_WORD = {"GRAND", "RANGE", "LAND", "SANTA", "CLASE", "MODEL", "SERIE", "NEW", "SUPER", "ALL"}
EDAD_CORTES = [24, 34, 44, 54, 64]

# Columnas que el sitio necesita. Si falta alguna opcional se usa un valor neutro.
REQUERIDAS = ["automotor_marca_descripcion", "automotor_modelo_descripcion"]


def leer_csv(path: Path) -> pd.DataFrame:
    ultimo = None
    for enc in ("utf-8-sig", "latin-1"):
        for sep in (",", ";"):
            try:
                df = pd.read_csv(path, encoding=enc, sep=sep, dtype=str, low_memory=False)
            except Exception as e:  # noqa: BLE001
                ultimo = e
                continue
            if df.shape[1] > 5:
                df.columns = [c.strip().lower() for c in df.columns]
                return df
    raise SystemExit(f"No pude leer {path}: {ultimo}")


def col(df, name, default=""):
    if name in df.columns:
        return df[name]
    return pd.Series(default, index=df.index, dtype=object)


def limpiar(s, default):
    return s.fillna(default).astype(str).str.strip().replace("", default)


def familia(modelo: str) -> str:
    t = modelo.split()
    if not t:
        return modelo
    if t[0] in TWO_WORD and len(t) > 1:
        return t[0] + " " + t[1]
    return t[0]


def tramite(t: str) -> int:
    t = t.upper()
    if "CLASICO" in t or "CLÁSICO" in t:
        return 4
    if "FORM. 05" in t or "FORM 05" in t:
        return 3
    if "DICTAMEN" in t:
        return 2
    if "IMPORTADO" in t:
        return 1
    return 0


def mes_del_nombre(path: Path):
    ms = re.findall(r"(?<!\d)(20\d\d)(0[1-9]|1[0-2])(?!\d)", path.stem)
    return f"{ms[-1][0]}-{ms[-1][1]}" if ms else None


def indexar(serie):
    vals = sorted(serie.unique())
    m = {v: i for i, v in enumerate(vals)}
    return vals, serie.map(m).astype(int).tolist()


def procesar(path: Path, out_dir: Path, plain: bool) -> str:
    df = leer_csv(path)
    for c in REQUERIDAS:
        if c not in df.columns:
            raise SystemExit(f"{path.name}: falta la columna '{c}'. Columnas encontradas: {list(df.columns)}")

    fecha = pd.to_datetime(
        col(df, "tramite_fecha", None).where(lambda s: s.notna(), col(df, "fecha_inscripcion_inicial", None)),
        errors="coerce",
    )
    mes = mes_del_nombre(path)
    if not mes:
        moda = fecha.dt.to_period("M").mode()
        if len(moda) == 0:
            raise SystemExit(f"{path.name}: no pude determinar el mes (ni por el nombre ni por las fechas).")
        mes = str(moda.iloc[0])
    anio_mes = int(mes[:4])
    fuera = (fecha.dt.strftime("%Y-%m") != mes).mean() if fecha.notna().any() else 0
    if fuera > 0.02:
        print(f"  aviso: {fuera:.1%} de las filas tienen fecha fuera de {mes}")

    df["marca"] = limpiar(col(df, "automotor_marca_descripcion"), "SIN DATO")
    df["modelo"] = limpiar(col(df, "automotor_modelo_descripcion"), "SIN DATO")
    df["tipo"] = limpiar(col(df, "automotor_tipo_descripcion"), "SIN DATO")
    prov = col(df, "registro_seccional_provincia").where(
        lambda s: s.notna() & (s != ""), col(df, "titular_domicilio_provincia")
    )
    df["prov"] = limpiar(prov, "Sin dato")
    df["origen"] = limpiar(col(df, "automotor_origen"), "Sin dato")
    df["fam"] = df["modelo"].map(familia)
    df["tram"] = limpiar(col(df, "tramite_tipo"), "").map(tramite)

    anio = pd.to_numeric(col(df, "automotor_anio_modelo"), errors="coerce")
    df["y"] = anio.fillna(anio.median() if anio.notna().any() else anio_mes).astype(int)

    nac = pd.to_numeric(col(df, "titular_anio_nacimiento"), errors="coerce")
    persona = limpiar(col(df, "titular_tipo_persona"), "Física")
    es_pj = persona.str.lower().str.startswith("j")
    edad = anio_mes - nac
    banda = np.full(len(df), 5)
    for i, hi in reversed(list(enumerate(EDAD_CORTES))):
        banda = np.where(edad <= hi, i, banda)
    banda = np.where(nac.isna() | (nac < 1900) | (nac > anio_mes - 16), -2, banda)
    df["a"] = np.where(es_pj, -1, banda).astype(int)
    df["pe"] = es_pj.astype(int)

    gen = limpiar(col(df, "titular_genero"), "").str.lower()
    df["g"] = np.where(gen.str.startswith("masc"), 0, np.where(gen.str.startswith("fem"), 1, 2))

    w = pd.to_numeric(col(df, "titular_porcentaje_titularidad", "100"), errors="coerce").fillna(100)
    df["w"] = w.round().clip(1, 100).astype(int)

    dia = fecha.dt.day.where(fecha.dt.strftime("%Y-%m") == mes, 0).fillna(0).astype(int)
    df["d"] = dia

    orig_vals = list(ORIGENES) + [o for o in sorted(df.origen.unique()) if o not in ORIGENES]
    orig_idx = df.origen.map({v: i for i, v in enumerate(orig_vals)}).astype(int).tolist()

    marcas, _ = indexar(df["marca"])
    marca_map = {v: i for i, v in enumerate(marcas)}
    tipos, tipo_i = indexar(df["tipo"])
    provs, prov_i = indexar(df["prov"])

    fam_key = df["marca"] + "||" + df["fam"]
    fams = sorted(fam_key.unique())
    fam_map = {k: i for i, k in enumerate(fams)}
    ver_key = fam_key + "||" + df["modelo"]
    vers = sorted(ver_key.unique())
    ver_map = {k: i for i, k in enumerate(vers)}

    data = {
        "m": mes,
        "orig": orig_vals,
        "marca": marcas,
        "tipo": tipos,
        "prov": provs,
        "tram": TRAMITES,
        "fam": [[marca_map[k.split("||")[0]], k.split("||")[1]] for k in fams],
        "ver": [[fam_map["||".join(k.split("||")[:2])], k.split("||")[2]] for k in vers],
        "r": {
            "o": orig_idx,
            "y": df["y"].tolist(),
            "t": tipo_i,
            "v": ver_key.map(ver_map).astype(int).tolist(),
            "p": prov_i,
            "pe": df["pe"].tolist(),
            "g": df["g"].tolist(),
            "a": df["a"].tolist(),
            "d": df["d"].tolist(),
            "tr": df["tram"].tolist(),
            "w": df["w"].tolist(),
        },
    }
    out_dir.joinpath("months").mkdir(parents=True, exist_ok=True)
    for old in out_dir.joinpath("months").glob(f"{mes}.json*"):
        old.unlink()
    raw = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if plain:
        (out_dir / "months" / f"{mes}.json").write_bytes(raw)
    else:
        with gzip.GzipFile(filename="", mode="wb", fileobj=open(out_dir / "months" / f"{mes}.json.gz", "wb"),
                           compresslevel=9, mtime=0) as gz:
            gz.write(raw)
    veh = df["w"].sum() / 100
    print(f"  {path.name} -> {mes}: {len(df):,} filas, {veh:,.0f} vehículos, {len(fams)} modelos")
    return mes


def limpio(x):
    x = round(float(x), 2)
    return int(x) if x == int(x) else x


def leer_mes(path: Path) -> dict:
    raw = path.read_bytes()
    if path.suffix == ".gz":
        raw = gzip.decompress(raw)
    return json.loads(raw)


def reindexar(out_dir: Path):
    files = {}
    for p in sorted(out_dir.joinpath("months").glob("*.json*")):
        m = p.name.split(".")[0]
        if re.fullmatch(r"\d{4}-\d{2}", m):
            if m not in files or p.suffix == ".gz":
                files[m] = p
    if not files:
        raise SystemExit("No hay meses en " + str(out_dir / "months"))

    ms = sorted(files)
    y, mo = map(int, ms[0].split("-"))
    y1, mo1 = map(int, ms[-1].split("-"))
    eje = []
    while (y, mo) <= (y1, mo1):
        eje.append(f"{y:04d}-{mo:02d}")
        mo += 1
        if mo == 13:
            y, mo = y + 1, 1
    pos = {m: i for i, m in enumerate(eje)}
    M = len(eje)

    meses = [{"m": m, "n": None, "file": None, "bytes": 0, "o": [0, 0, 0, 0]} for m in eje]
    brand_tot = {}
    fam_tot = {}
    for m in ms:
        d = leer_mes(files[m])
        r = d["r"]
        w = np.array(r["w"], dtype=float) / 100
        v = np.array(r["v"])
        o = np.array(r["o"])
        i = pos[m]
        names = d["orig"]
        oc = [0.0] * 4
        for k, name in enumerate(names):
            s = w[o == k].sum()
            oc[ORIGENES.index(name) if name in ORIGENES else 3] += s
        meses[i].update(n=limpio(w.sum()), file=f"months/{files[m].name}", bytes=files[m].stat().st_size,
                        o=[limpio(x) for x in oc], rows=len(w))
        por_ver = np.bincount(v, weights=w, minlength=len(d["ver"]))
        for vi, (fi, _) in enumerate(d["ver"]):
            c = por_ver[vi]
            if c <= 0:
                continue
            bi, fname = d["fam"][fi]
            b = d["marca"][bi]
            fam_tot.setdefault((b, fname), np.zeros(M))[i] += c
            brand_tot.setdefault(b, np.zeros(M))[i] += c

    brands = sorted(brand_tot, key=lambda b: -brand_tot[b].sum())
    bidx = {b: i for i, b in enumerate(brands)}
    fkeys = sorted(fam_tot, key=lambda k: -fam_tot[k].sum())
    idx = {
        "actualizado": ms[-1],
        "months": meses,
        "brands": brands,
        "bs": [[limpio(x) for x in brand_tot[b]] for b in brands],
        "fams": [[bidx[b], f] for b, f in fkeys],
        "fs": [[limpio(x) for x in fam_tot[k]] for k in fkeys],
    }
    (out_dir / "index.json").write_text(json.dumps(idx, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    faltan = [m for m in eje if m not in files]
    print(f"Índice: {len(ms)} meses ({ms[0]} a {ms[-1]}), {len(brands)} marcas, {len(fkeys)} modelos.")
    if faltan:
        print("  Meses sin archivo en ese rango:", ", ".join(faltan))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add", help="procesar CSV")
    a.add_argument("csv", nargs="+")
    for p in (a, sub.add_parser("reindex", help="reconstruir el índice")):
        p.add_argument("--out", default=str(DEFAULT_OUT))
    a.add_argument("--plain", action="store_true")
    args = ap.parse_args()
    out = Path(args.out)
    if args.cmd == "add":
        for f in args.csv:
            procesar(Path(f), out, args.plain)
    reindexar(out)


if __name__ == "__main__":
    sys.exit(main())
