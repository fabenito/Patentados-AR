#!/usr/bin/env python3
"""
Convierte los CSV mensuales de DNRPA (inscripciones iniciales de autos) en los
archivos que usa el sitio.

  python tools/build.py add raw/*.csv        # procesa uno o varios CSV y reconstruye el índice
  python tools/build.py reindex              # solo reconstruye site/data/index.json
  python tools/build.py transfers CARPETA    # agrega site/data/usados.json.gz

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
# El token que sigue es la línea, no una versión: RS Q8 -> RSQ8, M 3 -> M3.
# C 200 o GLC 300 se quedan en la primera palabra y las versiones se listan aparte.
LINEA = {"RS", "SQ", "M", "X", "Q", "Z", "TT"}
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
    if len(t) > 1 and t[0] in LINEA and (
        re.fullmatch(r"[A-Z]{1,2}\d{1,2}[A-Z]?", t[1]) or re.fullmatch(r"\d{1,2}", t[1])
    ):
        return t[0] + t[1]
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
    ms = re.findall(r"(?<!\d)(20\d\d)[-_]?(0[1-9]|1[0-2])(?!\d)", path.stem)
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


TRANS_COLS = {
    "tramite_tipo",
    "fecha_inscripcion_inicial",
    "automotor_marca_descripcion",
    "automotor_modelo_descripcion",
    "titular_tipo_persona",
    "titular_porcentaje_titularidad",
}
Y0, Y1 = 1960, 2026


def leer_transferencia(path: Path) -> pd.DataFrame:
    ultimo = None
    for enc in ("utf-8-sig", "latin-1"):
        for sep in (",", ";"):
            try:
                df = pd.read_csv(
                    path, encoding=enc, sep=sep, dtype=str, low_memory=False,
                    usecols=lambda c: str(c).strip().lower() in TRANS_COLS,
                )
            except Exception as e:  # noqa: BLE001
                ultimo = e
                continue
            if df.shape[1] >= 3:
                df.columns = [str(c).strip().lower() for c in df.columns]
                return df
    raise SystemExit(f"No pude leer {path}: {ultimo}")


def eje_meses(meses):
    y, mo = map(int, meses[0].split("-"))
    y1, mo1 = map(int, meses[-1].split("-"))
    eje = []
    while (y, mo) <= (y1, mo1):
        eje.append(f"{y:04d}-{mo:02d}")
        mo += 1
        if mo == 13:
            y, mo = y + 1, 1
    return eje


def matriz(dic, keys, campo):
    return [[limpio(x) for x in dic[k][campo]] for k in keys]


def procesar_transferencias(entradas, out_dir: Path):
    """Arma site/data/usados.json.gz a partir de los CSV de transferencias.

    Cada fila pesa por el porcentaje de titularidad. El mes de la venta es el
    del nombre del archivo. La fecha de inscripción inicial queda aparte: no
    es un patentamiento completo, y un auto transferido dos veces cuenta dos.
    """
    paths = []
    for e in entradas:
        p = Path(e)
        if p.is_dir():
            paths.extend(sorted(p.glob("*.csv")))
        else:
            paths.append(p)
    if not paths:
        raise SystemExit("No encontré CSV de transferencias.")

    por_mes = {}
    for p in paths:
        mes = mes_del_nombre(p)
        if not mes:
            raise SystemExit(f"{p.name}: no pude leer el mes del nombre.")
        por_mes.setdefault(mes, []).append(p)
    eje = eje_meses(sorted(por_mes))
    pos = {m: i for i, m in enumerate(eje)}
    mlen, ylen = len(eje), Y1 - Y0 + 1
    fams = {}
    g_n = np.zeros(mlen)
    g_pj = np.zeros(mlen)
    g_to = np.zeros(mlen)
    g_fr = np.zeros(mlen)
    g_iy = np.zeros((mlen, ylen))

    def acc():
        return {"n": np.zeros(mlen), "pj": np.zeros(mlen), "to": np.zeros(mlen),
                "fr": np.zeros(mlen), "y": np.zeros(ylen)}

    for mes in eje:
        for path in por_mes.get(mes, []):
            df = leer_transferencia(path)
            i = pos[mes]
            w = pd.to_numeric(col(df, "titular_porcentaje_titularidad", "100"), errors="coerce").fillna(100)
            w = w.clip(1, 100) / 100
            marca = limpiar(col(df, "automotor_marca_descripcion"), "SIN DATO")
            fam = limpiar(col(df, "automotor_modelo_descripcion"), "SIN DATO").map(familia)
            persona = limpiar(col(df, "titular_tipo_persona"), "")
            tipo = limpiar(col(df, "tramite_tipo"), "").str.upper()
            pj = persona.str.lower().str.startswith("j")
            hacia = tipo.str.contains("A COM", regex=False)
            desde = tipo.str.contains("DE COM", regex=False) & ~hacia
            anio = pd.to_datetime(col(df, "fecha_inscripcion_inicial", ""), errors="coerce").dt.year
            yi = anio - Y0
            ok = yi.between(0, ylen - 1)
            base = pd.DataFrame({
                "marca": marca.to_numpy(), "fam": fam.to_numpy(), "w": w.to_numpy(),
                "wpj": np.where(pj, w, 0.0), "wto": np.where(hacia, w, 0.0), "wfr": np.where(desde, w, 0.0),
            })
            g_n[i] += base.w.sum()
            g_pj[i] += base.wpj.sum()
            g_to[i] += base.wto.sum()
            g_fr[i] += base.wfr.sum()
            if ok.any():
                gy = base[ok.to_numpy()].groupby(yi[ok].astype(int).to_numpy(), sort=False).w.sum()
                g_iy[i, gy.index.to_numpy()] += gy.to_numpy()
            agg = base.groupby(["marca", "fam"], sort=False)[["w", "wpj", "wto", "wfr"]].sum()
            for (b, f), row in agg.iterrows():
                slot = fams.get((b, f))
                if slot is None:
                    slot = acc()
                    fams[(b, f)] = slot
                slot["n"][i] += row.w
                slot["pj"][i] += row.wpj
                slot["to"][i] += row.wto
                slot["fr"][i] += row.wfr
            if ok.any():
                ybase = base[ok.to_numpy()][["marca", "fam", "w"]].copy()
                ybase["yi"] = yi[ok].astype(int).to_numpy()
                for (b, f, k), val in ybase.groupby(["marca", "fam", "yi"], sort=False).w.sum().items():
                    fams[(b, f)]["y"][int(k)] += val
            print(f"  {path.name} -> {mes}: {len(df):,} filas, {base.w.sum():,.0f} vehículos", flush=True)
        if mes not in por_mes:
            print(f"  sin archivo: {mes}", flush=True)

    brands_acc = {}
    for (b, f), slot in fams.items():
        bt = brands_acc.get(b)
        if bt is None:
            bt = acc()
            brands_acc[b] = bt
        bt["n"] += slot["n"]
        bt["pj"] += slot["pj"]
        bt["to"] += slot["to"]
        bt["fr"] += slot["fr"]
        bt["y"] += slot["y"]
    uso = g_iy.sum(axis=0) > 0
    years = [Y0 + k for k in range(ylen) if uso[k]]
    keep = np.flatnonzero(uso)

    def cortar(slot):
        slot["y"] = slot["y"][keep]

    for slot in list(fams.values()) + list(brands_acc.values()):
        cortar(slot)
    g_iy = g_iy[:, keep]

    brands = sorted(brands_acc, key=lambda b: -brands_acc[b]["n"].sum())
    bidx = {b: i for i, b in enumerate(brands)}
    fkeys = sorted(fams, key=lambda k: -fams[k]["n"].sum())
    data = {
        "months": eje,
        "years": years,
        "n": [limpio(x) for x in g_n],
        "pj": [limpio(x) for x in g_pj],
        "to": [limpio(x) for x in g_to],
        "fr": [limpio(x) for x in g_fr],
        "iy": [[limpio(x) for x in g_iy[i]] for i in range(mlen)],
        "brands": brands,
        "bs": matriz(brands_acc, brands, "n"),
        "bpj": matriz(brands_acc, brands, "pj"),
        "bto": matriz(brands_acc, brands, "to"),
        "bfr": matriz(brands_acc, brands, "fr"),
        "fams": [[bidx[b], f] for b, f in fkeys],
        "fs": matriz(fams, fkeys, "n"),
        "fpj": matriz(fams, fkeys, "pj"),
        "fto": matriz(fams, fkeys, "to"),
        "ffr": matriz(fams, fkeys, "fr"),
        "fy": matriz(fams, fkeys, "y"),
    }
    raw = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    dest = out_dir / "usados.json.gz"
    dest.parent.mkdir(parents=True, exist_ok=True)
    with gzip.GzipFile(filename="", mode="wb", fileobj=open(dest, "wb"), compresslevel=9, mtime=0) as gz:
        gz.write(raw)
    print(f"Usados: {len(por_mes)} meses ({eje[0]} a {eje[-1]}), {len(brands)} marcas, {len(fkeys)} modelos, "
          f"{g_n.sum():,.0f} vehículos, {dest.stat().st_size / 1e6:.1f} MB.")
    if years:
        print(f"  Inscripción inicial vista: {years[0]} a {years[-1]}.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add", help="procesar CSV de patentamientos")
    a.add_argument("csv", nargs="+")
    a.add_argument("--plain", action="store_true")
    r = sub.add_parser("reindex", help="reconstruir el índice")
    t = sub.add_parser("transfers", help="procesar CSV de transferencias")
    t.add_argument("csv", nargs="+", help="archivos CSV o una carpeta")
    for p in (a, r, t):
        p.add_argument("--out", default=str(DEFAULT_OUT))
    args = ap.parse_args()
    out = Path(args.out)
    if args.cmd == "transfers":
        procesar_transferencias(args.csv, out)
        return
    if args.cmd == "add":
        for f in args.csv:
            procesar(Path(f), out, args.plain)
    reindexar(out)


if __name__ == "__main__":
    sys.exit(main())
