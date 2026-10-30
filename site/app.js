(function () {
'use strict';

/* ---------- utilidades ---------- */
const $ = s => document.querySelector(s);
const nfmt = new Intl.NumberFormat('es-AR', { useGrouping: 'always', maximumFractionDigits: 0 });
const f0 = x => nfmt.format(Math.round(x));
const pc = x => (!isFinite(x) ? '–' : x > 0 && x < 0.001 ? '<0,1%' : (x * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + '%');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const slug = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const SMALL = new Set(['CON', 'SIN', 'DE', 'DEL', 'LA', 'EL', 'Y', 'PARA', 'POR', 'LOS', 'LAS']);
const tc = s => String(s).split(' ').map(w => (/\d/.test(w) || (w.length <= 3 && !SMALL.has(w)) || /^[^A-Za-zÁÉÍÓÚÑ]/.test(w)) ? w : w[0] + w.slice(1).toLowerCase()).join(' ');
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MC = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const mLabel = m => MESES[+m.slice(5) - 1] + ' ' + m.slice(0, 4);
const mShort = m => MC[+m.slice(5) - 1] + ' ' + m.slice(2, 4);
const AGE = ['Menos de 25', '25 a 34', '35 a 44', '45 a 54', '55 a 64', '65 o más'];
const AGE_MID = [21, 29.5, 39.5, 49.5, 59.5, 70];
const EV_LABEL = ['Combustión', 'Híbrido suave', 'Híbrido', 'Híbrido enchufable', 'Eléctrico'];
const ORIG_COL = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
const NOPASS = /CAMION|SEMIRREMOLQUE|REMOLQUE|ACOPLADO|TRACTOR|CHASIS|CARRETON|BATEA|OMNIBUS|MINIBUS|COLECTIVO|BOMBEROS|CISTERNA|VOLCADOR|CASA RODANTE|TRAILER|MAQUINA|AMBULANCIA|AUTOBOMBA|HORMIGONERO|GRUA|PLATAFORMA|ARTICULAD|EQUIPO/;
const SINDATO = /^SIN (ESPECIFICACION|MARCA|DATO)/;

/* ---------- estado ---------- */
const st = { period: '', months: [], origOff: new Set(), era: 'all', brand: -1, tipo: -1, prov: -1, pe: -1, ev: -1, q: '', ifam: -1, upre: -1, followModel: false, uGran: '', bGran: '', rGran: '', token: 0 };
let IX = null, CFG = { grupos: [], serie: [] }, U = null, uPick = -1, MAPA = null;
let sel = [], selP = [];
const MD = new Map();
const G = {
  marca: [], marcaM: new Map(), fam: [], famM: new Map(), famBrand: [], famName: [],
  ver: [], verM: new Map(), verFam: [], verTxt: [], verEx: [], verEv: [], verSearch: [],
  tipo: [], tipoM: new Map(), tipoPass: [], prov: [], provM: new Map(),
  orig: ['Nacional', 'Importado', 'Protocolo 21'], origM: new Map([['Nacional', 0], ['Importado', 1], ['Protocolo 21', 2]]),
};
function gid(arr, map, key, onNew) {
  let i = map.get(key);
  if (i === undefined) { i = arr.length; arr.push(key); map.set(key, i); if (onNew) onNew(i); }
  return i;
}

/* ---------- clasificación por nombre ---------- */
function exGroup(b, t) {
  for (let g = 0; g < CFG.grupos.length; g++) {
    const gr = CFG.grupos[g];
    if (gr.marcas.includes(b)) return g;
    for (const m of gr.mod) if (m.marca === b && m.re.test(t)) return g;
  }
  return -1;
}
function evCat(b, t) {
  if (/PHEV|DM-?[IPO]\b|PLUG-?IN|ENCHUFABLE/.test(t)) return 3;
  if (/MHEV|MILD/.test(t)) return 1;
  if (/\bHEV\b|HIBRID|HYBRID/.test(t)) return 2;
  if (/\bBEV\b|\bEV\b|ELECTRIC|E-TRON/.test(t) || b === 'BYD') return 4;
  return 0;
}

/* ---------- carga de datos ---------- */
async function getMonthJSON(file) {
  const r = await fetch('data/' + file);
  if (!r.ok) throw new Error(file + ' ' + r.status);
  let bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('sin DecompressionStream');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function addMonth(d) {
  const r = d.r, n = r.w.length;
  const mb = d.marca.map(x => gid(G.marca, G.marcaM, x));
  const mf = d.fam.map(([b, name]) => {
    const bi = mb[b];
    return gid(G.fam, G.famM, bi + '|' + name, i => { G.famBrand[i] = bi; G.famName[i] = name; });
  });
  const mv = d.ver.map(([f, txt]) => {
    const fi = mf[f];
    return gid(G.ver, G.verM, fi + '|' + txt, i => {
      const b = G.marca[G.famBrand[fi]];
      G.verFam[i] = fi; G.verTxt[i] = txt;
      G.verEx[i] = exGroup(b, txt); G.verEv[i] = evCat(b, txt);
      G.verSearch[i] = norm(b + ' ' + txt);
    });
  });
  const mt = d.tipo.map(x => gid(G.tipo, G.tipoM, x, i => { G.tipoPass[i] = !NOPASS.test(x); }));
  const mp = d.prov.map(x => gid(G.prov, G.provM, x));
  const mo = d.orig.map(x => gid(G.orig, G.origM, x));
  const M = {
    m: d.m, year: +d.m.slice(0, 4), n,
    o: new Uint8Array(n), y: new Uint16Array(n), t: new Uint16Array(n), v: new Int32Array(n), p: new Uint16Array(n),
    pe: new Uint8Array(n), g: new Uint8Array(n), a: new Int8Array(n), d: new Uint8Array(n), tr: new Uint8Array(n),
    w: new Uint8Array(n), f: new Int32Array(n), b: new Int16Array(n), all: new Int32Array(n),
  };
  for (let i = 0; i < n; i++) {
    const v = mv[r.v[i]];
    M.o[i] = mo[r.o[i]]; M.y[i] = r.y[i]; M.t[i] = mt[r.t[i]]; M.v[i] = v; M.p[i] = mp[r.p[i]];
    M.pe[i] = r.pe[i]; M.g[i] = r.g[i]; M.a[i] = r.a[i]; M.d[i] = r.d[i]; M.tr[i] = r.tr[i]; M.w[i] = r.w[i];
    M.f[i] = G.verFam[v]; M.b[i] = G.famBrand[M.f[i]]; M.all[i] = i;
  }
  MD.set(d.m, M);
}

function status(t) { $('#estado').textContent = t || ''; }
async function loadMonths(need, tok) {
  let k = 0, done = 0;
  async function worker() {
    while (k < need.length) {
      const m = need[k++];
      const d = await getMonthJSON(IX.months[IX.pos.get(m)].file);
      addMonth(d);
      done++; status(`Cargando datos… ${done} de ${need.length}`);
    }
  }
  status(`Cargando datos… 0 de ${need.length}`);
  await Promise.all(Array.from({ length: Math.min(5, need.length) }, worker));
  status('');
}

/* ---------- selección de filas ---------- */
function verMatch(q) {
  const toks = norm(q).split(/\s+/).filter(Boolean), ok = new Uint8Array(G.ver.length);
  for (let v = 0; v < ok.length; v++) ok[v] = toks.every(t => G.verSearch[v].includes(t)) ? 1 : 0;
  return ok;
}
function buildSel(months, filt) {
  const out = [];
  const vOk = filt && st.q ? verMatch(st.q) : null;
  const oOn = new Uint8Array(G.orig.length);
  G.orig.forEach((nm, i) => { oOn[i] = st.origOff.has(nm) ? 0 : 1; });
  for (const m of months) {
    const M = MD.get(m); if (!M) continue;
    if (!filt) { out.push({ M, idx: M.all }); continue; }
    const n = M.n, idx = new Int32Array(n), Y = M.year; let c = 0;
    for (let i = 0; i < n; i++) {
      if (!oOn[M.o[i]]) continue;
      if (st.brand >= 0 && M.b[i] !== st.brand) continue;
      if (st.tipo >= 0 && M.t[i] !== st.tipo) continue;
      if (st.prov >= 0 && provKey(G.prov[M.p[i]]) !== provKey(G.prov[st.prov])) continue;
      if (st.pe >= 0 && M.pe[i] !== st.pe) continue;
      if (st.ev >= 0 && G.verEv[M.v[i]] !== st.ev) continue;
      if (st.era !== 'all') {
        const a = Y - M.y[i];
        if (st.era === 'new' && a > 1) continue;
        if (st.era === 'old' && a < 2) continue;
        if (st.era === 'classic' && a < 30 && M.tr[i] !== 4) continue;
      }
      if (vOk && !vOk[M.v[i]]) continue;
      idx[c++] = i;
    }
    out.push({ M, idx: idx.subarray(0, c) });
  }
  return out;
}
function tally(s, key, size) {
  const out = new Float64Array(size);
  for (const { M, idx } of s) { const A = M[key], W = M.w; for (let k = 0; k < idx.length; k++) { const i = idx[k]; out[A[i]] += W[i]; } }
  for (let j = 0; j < size; j++) out[j] /= 100;
  return out;
}
function count(s) { let t = 0; for (const { M, idx } of s) for (let k = 0; k < idx.length; k++) t += M.w[idx[k]]; return t / 100; }
function ranked(vals, limit) {
  const a = []; for (let i = 0; i < vals.length; i++) if (vals[i] > 0) a.push([i, vals[i]]);
  a.sort((x, y) => y[1] - x[1]); return limit ? a.slice(0, limit) : a;
}
function ownerStats(s) {
  const o = { pj: 0, pf: 0, age: new Float64Array(6), gen: new Float64Array(3) };
  for (const { M, idx } of s) for (let k = 0; k < idx.length; k++) {
    const i = idx[k], w = M.w[i] / 100;
    if (M.pe[i]) o.pj += w; else { o.pf += w; o.gen[M.g[i]] += w; const a = M.a[i]; if (a >= 0) o.age[a] += w; }
  }
  return o;
}

/* ---------- etiquetas y enlaces ---------- */
const verLabel = v => { const b = G.marca[G.famBrand[G.verFam[v]]], t = G.verTxt[v]; return t.startsWith(b) ? tc(t) : tc(b) + ' ' + tc(t); };
const famLabel = f => tc(G.marca[G.famBrand[f]]) + ' ' + tc(G.famName[f]);
function mlLink(label, year, regYear, text) {
  const q = regYear - year <= 1 ? label + ' 0km' : label + ' ' + year;
  return `<a href="https://listado.mercadolibre.com.ar/${slug(q)}" target="_blank" rel="noopener">${text || 'Ver precios'}</a>`;
}

/* ---------- gráficos ---------- */
const tip = $('#tip');
document.addEventListener('mousemove', e => {
  const t = e.target.closest && e.target.closest('[data-tip]');
  if (!t) { tip.style.opacity = 0; return; }
  tip.textContent = t.getAttribute('data-tip'); tip.style.opacity = 1;
  tip.style.left = Math.max(8, Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8)) + 'px';
  tip.style.top = Math.min(e.clientY + 16, innerHeight - tip.offsetHeight - 8) + 'px';
});
document.addEventListener('scroll', () => { tip.style.opacity = 0; }, true);

function bars(el, items, opts) {
  opts = opts || {};
  const max = Math.max(1, ...items.map(x => x.v));
  el.innerHTML = items.map((x, k) => {
    const tag = x.click ? 'button' : 'div';
    return `<${tag} class="brow${x.on ? ' on' : ''}" ${x.click ? `type="button" data-k="${k}"` : ''} data-tip="${esc(x.tip || x.label + ': ' + f0(x.v))}"><span class="lab">${esc(x.label)}</span><span class="trk"><i style="width:${(x.v / max * 100).toFixed(1)}%${x.color ? ';background:' + x.color : ''}"></i></span><span class="val num">${f0(x.v)}</span></${tag}>`;
  }).join('') || '<div class="more">No hay datos con la selección actual.</div>';
  el.querySelectorAll('button.brow').forEach(b => { b.onclick = () => items[+b.dataset.k].click(); });
}
function niceMax(m) {
  const raw = m / 4, p = Math.max(1, Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1)))));
  const steps = p >= 10 ? [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] : [1, 2, 3, 4, 5, 6, 8, 10];
  for (const k of steps) if (k * p >= raw) return k * p * 4;
  return 40 * p;
}

/* o: { cats, series:[{color,v[]}], tip(i), tick(i), sel:Set, missing:[], alpha(i), pick(i), h, label } */
function chart(el, o) {
  const W = Math.max(280, el.clientWidth || 600), H = o.h || 200, l = 46, r = 6, t = 10, b = 24;
  const n = o.cats.length, bw = (W - l - r) / n, ph = H - t - b, gap = bw > 8 ? 1.5 : bw > 4 ? 1 : 0.4;
  const tot = o.cats.map((_, i) => o.series.reduce((a, s) => a + (s.v[i] || 0), 0));
  const mx = niceMax(Math.max(1, ...tot));
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const y = t + ph - ph * k / 4;
    g += `<line class="axl" x1="${l}" x2="${W - r}" y1="${y}" y2="${y}"/><text x="${l - 8}" y="${y + 4}" text-anchor="end">${f0(mx * k / 4)}</text>`;
  }
  for (let i = 0; i < n; i++) {
    const x = l + i * bw;
    if (o.sel && o.sel.has(i)) g += `<rect x="${x.toFixed(1)}" y="${t}" width="${bw.toFixed(1)}" height="${ph}" fill="var(--wash)"/>`;
    let y = t + ph;
    o.series.forEach((s, k) => {
      const v = s.v[i] || 0; if (!v) return;
      const h = Math.max(1, ph * v / mx); y -= h;
      g += `<rect x="${(x + gap).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 2 * gap).toFixed(1)}" height="${h.toFixed(1)}" fill="${s.color}"${o.alpha ? ` opacity="${o.alpha(i)}"` : ''}${o.series.length === 1 && bw > 6 ? ' rx="2"' : ''}/>`;
    });
    if (o.missing && o.missing[i]) g += `<line x1="${(x + gap).toFixed(1)}" x2="${(x + bw - gap).toFixed(1)}" y1="${t + ph - 1}" y2="${t + ph - 1}" stroke="var(--mute)" stroke-width="2" stroke-dasharray="2 2"/>`;
    const tk = o.tick ? o.tick(i) : '';
    if (tk) g += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle">${tk}</text>`;
  }
  for (let i = 0; i < n; i++) {
    g += `<rect class="hit" data-i="${i}" x="${(l + i * bw).toFixed(1)}" y="${t}" width="${bw.toFixed(1)}" height="${ph}" fill="transparent" data-tip="${esc(o.tip(i))}"/>`;
  }
  el.classList.add('chart'); el.classList.toggle('pick', !!o.pick);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || '')}">${g}</svg>`;
  if (o.pick) el.querySelectorAll('rect.hit').forEach(rc => { rc.onclick = () => o.pick(+rc.dataset.i); });
}

/* ---------- listas con "mostrar más" ---------- */
function makeList(tabSel, btnSel, head, step) {
  const tab = $(tabSel), btn = $(btnSel); let rows = [], shown = step;
  function draw() {
    tab.innerHTML = `<thead><tr>${head.map(h => `<th class="${h.r ? 'r' : ''}">${h.t}</th>`).join('')}</tr></thead><tbody>` +
      (rows.slice(0, shown).map(r => `<tr>${r.map((c, i) => `<td class="${head[i].cls || ''}">${c}</td>`).join('')}</tr>`).join('') ||
        `<tr><td colspan="${head.length}" class="vacio">No hay vehículos que coincidan con la selección.</td></tr>`) + '</tbody>';
    btn.hidden = rows.length <= shown;
    if (!btn.hidden) btn.textContent = `Mostrar más (${f0(rows.length - shown)} restantes)`;
  }
  btn.onclick = () => { shown += step; draw(); };
  return { set(r) { rows = r; shown = step; draw(); } };
}

/* ---------- titulares ---------- */
function ownersHTML(o, minN) {
  const n = o.pf + o.pj;
  if (n < minN) return `<p class="note">Los datos de titulares se ocultan cuando hay menos de ${minN} vehículos.</p>`;
  const gT = o.gen[0] + o.gen[1];
  return `<div class="kv" style="margin:0 0 12px"><span><b>${pc(o.pj / n)}</b> a nombre de empresas</span><span><b>${pc(o.pf / n)}</b> de personas</span></div>
  <h3>Personas por edad</h3><div class="bars own-age"></div>
  <h3 style="margin-top:14px">Personas por género</h3>` + (gT ? `<div class="stack" style="height:22px">${[['Hombres', o.gen[0], 'var(--s1)'], ['Mujeres', o.gen[1], 'var(--s2)']].map(x => `<i style="flex:${x[1]};background:${x[2]}" data-tip="${x[0]}: ${f0(x[1])} (${pc(x[1] / gT)})"></i>`).join('')}</div>
  <div class="legend"><div><span class="sw" style="background:var(--s1)"></span>Hombres<span class="nn num">${pc(o.gen[0] / gT)}</span></div><div><span class="sw" style="background:var(--s2)"></span>Mujeres<span class="nn num">${pc(o.gen[1] / gT)}</span></div></div>` : '<p class="note">Sin datos.</p>');
}
function fillOwners(root, o) {
  const el = root.querySelector('.own-age');
  if (el) bars(el, Array.from(o.age, (v, i) => ({ label: AGE[i], v })).filter(x => x.v > 0));
}

/* ---------- período ---------- */
function resolve(spec) {
  const av = IX.avail.map(x => x.m);
  if (spec.startsWith('m:')) return [spec.slice(2)];
  if (spec.startsWith('last:')) return av.slice(-(+spec.slice(5)));
  if (spec.startsWith('y:')) return av.filter(m => m.startsWith(spec.slice(2)));
  return av;
}
function buildPeriodSelect() {
  const av = IX.avail, mb = ms => ms.reduce((s, m) => s + IX.months[IX.pos.get(m)].bytes, 0) / 1e6;
  const sz = ms => { const b = mb(ms); return b > 0.3 ? ` (${b.toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB)` : ''; };
  const years = [...new Set(av.map(x => x.m.slice(0, 4)))].sort().reverse();
  let h = '<optgroup label="Rangos">';
  if (av.length > 1) h += `<option value="last:3">Últimos 3 meses${sz(resolve('last:3'))}</option>`;
  if (av.length > 3) h += `<option value="last:12">Últimos 12 meses${sz(resolve('last:12'))}</option>`;
  years.forEach(y => { const ms = resolve('y:' + y); if (ms.length > 1) h += `<option value="y:${y}">Año ${y}${ms.length < 12 ? ` (${ms.length} meses)` : ''}${sz(ms)}</option>`; });
  if (av.length > 1) h += `<option value="all">Todo el período, ${mShort(av[0].m)} a ${mShort(av[av.length - 1].m)}${sz(av.map(x => x.m))}</option>`;
  h += '</optgroup><optgroup label="Un mes">';
  av.slice().reverse().forEach(x => { h += `<option value="m:${x.m}">${mLabel(x.m)}</option>`; });
  $('#f-per').innerHTML = h + '</optgroup>';
}
async function setPeriod(spec) {
  const ms = resolve(spec), tok = ++st.token;
  st.period = spec; $('#f-per').value = spec;
  const need = ms.filter(m => !MD.has(m));
  try { if (need.length) await loadMonths(need, tok); }
  catch (e) { status('No se pudieron cargar los datos. Probá de nuevo.'); console.error(e); return; }
  if (tok !== st.token) return;
  st.months = ms;
  try { history.replaceState(null, '', ms.length === 1 && spec.startsWith('m:') ? '#' + ms[0] : location.pathname + location.search); } catch (e) { /* ignorar */ }
  refreshOptions(); update();
  if (st.ifam >= 0) showFam(st.ifam);
}

/* ---------- filtros ---------- */
function fillSel(id, first, opts, cur) {
  const el = $(id);
  el.innerHTML = `<option value="-1">${first}</option>` + opts.map(o => `<option value="${o[0]}">${esc(o[1])}</option>`).join('');
  el.value = String(cur);
  if (el.value === String(cur)) return cur;
  el.value = '-1'; return -1;
}
function refreshOptions() {
  selP = buildSel(st.months, false);
  const b = tally(selP, 'b', G.marca.length), t = tally(selP, 't', G.tipo.length), p = tally(selP, 'p', G.prov.length), o = tally(selP, 'o', G.orig.length);
  st.brand = fillSel('#f-brand', 'Todas las marcas', ranked(b).map(([i, v]) => [i, `${tc(G.marca[i])} (${f0(v)})`]), st.brand);
  st.tipo = fillSel('#f-tipo', 'Todas las carrocerías', ranked(t).map(([i, v]) => [i, `${tc(G.tipo[i])} (${f0(v)})`]), st.tipo);
  const mp = mergeProv(p);
  if (st.prov >= 0) { const row = mp.find(r => r.k === provKey(G.prov[st.prov])); st.prov = row ? row.i : -1; }
  st.prov = fillSel('#f-prov', 'Todas las provincias', mp.map(r => [r.i, `${provNice(r.k, G.prov[r.i])} (${f0(r.v)})`]), st.prov);
  const ec = { all: 0, new: 0, old: 0, classic: 0 };
  for (const { M, idx } of selP) for (let k = 0; k < idx.length; k++) {
    const i = idx[k], w = M.w[i] / 100, a = M.year - M.y[i];
    ec.all += w; if (a <= 1) ec.new += w; else ec.old += w; if (a >= 30 || M.tr[i] === 4) ec.classic += w;
  }
  const eras = [['all', 'Todas las antigüedades'], ['new', '0 km y modelo reciente'], ['old', 'Usados e importados antiguos'], ['classic', 'Clásicos, 30 años o más']];
  $('#f-era').innerHTML = eras.map(e => `<option value="${e[0]}">${e[1]} (${f0(ec[e[0]])})</option>`).join('');
  $('#f-era').value = st.era;
  const fo = $('#f-orig'); fo.querySelectorAll('.chip').forEach(c => c.remove());
  G.orig.forEach((nm, i) => {
    if (!o[i] && i > 2) return;
    const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'chip';
    bt.setAttribute('aria-pressed', st.origOff.has(nm) ? 'false' : 'true');
    bt.innerHTML = `<span class="dot" style="background:${ORIG_COL[Math.min(i, 3)]}"></span>${esc(nm)}<span class="c num">${f0(o[i])}</span>`;
    bt.onclick = () => { st.origOff.has(nm) ? st.origOff.delete(nm) : st.origOff.add(nm); bt.setAttribute('aria-pressed', st.origOff.has(nm) ? 'false' : 'true'); update(); };
    fo.appendChild(bt);
  });
}
$('#f-per').onchange = e => setPeriod(e.target.value);
$('#f-era').onchange = e => { st.era = e.target.value; update(); };
$('#f-brand').onchange = e => { st.brand = +e.target.value; update(); };
$('#f-tipo').onchange = e => { st.tipo = +e.target.value; update(); };
$('#f-prov').onchange = e => { st.prov = +e.target.value; update(); };
$('#f-pers').onchange = e => { st.pe = +e.target.value; update(); };
$('#f-q').oninput = e => { st.q = e.target.value.trim(); update(); };
$('#reset').onclick = () => {
  Object.assign(st, { origOff: new Set(), era: 'all', brand: -1, tipo: -1, prov: -1, pe: -1, ev: -1, q: '' });
  $('#f-pers').value = '-1'; $('#f-q').value = ''; refreshOptions(); update();
};
const toggle = (k, v, id) => { st[k] = st[k] === v ? -1 : v; $(id).value = st[k]; update(); };

function provKey(s) {
  const n = norm(s).replace(/\./g, '').replace(/\s+/g, ' ').trim();
  if (n.includes('autonoma') || n === 'caba' || n.includes('capital federal')) return 'caba';
  if (n.startsWith('tierra del fuego')) return 'tierra del fuego';
  return n;
}
function provNice(k, fallback) {
  if (MAPA) { const it = MAPA.items.find(x => x.k === k); if (it) return it.n; }
  return fallback || k;
}
function mergeProv(vals) {
  const acc = [], at = new Map();
  for (let i = 0; i < vals.length; i++) {
    if (!(vals[i] > 0)) continue;
    const k = provKey(G.prov[i]);
    let row = at.get(k);
    if (!row) { row = { i, v: 0, k, top: 0 }; at.set(k, row); acc.push(row); }
    row.v += vals[i];
    if (vals[i] >= row.top) { row.top = vals[i]; row.i = i; }
  }
  acc.sort((a, b) => b.v - a.v);
  return acc;
}
function provPick(key) {
  const row = mergeProv(tally(selP, 'p', G.prov.length)).find(r => r.k === key);
  if (!row) return;
  toggle('prov', row.i, '#f-prov');
}

/* ---------- buscador de modelos ---------- */
function suggest(q) {
  const toks = norm(q).split(/\s+/).filter(Boolean);
  const list = [];
  for (let i = 0; i < IX.fams.length && list.length < 8; i++) if (toks.every(t => IX.famSearch[i].includes(t))) list.push(i);
  const extra = [];
  if (U && toks.length) {
    const seen = new Set(list.map(i => IX.brands[IX.fams[i][0]] + '|' + IX.fams[i][1]));
    for (let i = 0; i < U.fams.length; i++) {
      if (!(U.pre[i] > 0) || !toks.every(t => U.search[i].includes(t))) continue;
      const f = U.fams[i];
      if (seen.has(U.brands[f[0]] + '|' + f[1])) continue;
      extra.push(i);
    }
    extra.sort((a, b) => U.pre[b] - U.pre[a]);
    extra.splice(6);
  }
  const chips = list.map(i => {
    const f = IX.fams[i], key = IX.brands[f[0]] + '|' + f[1];
    const ui = U ? U.famM.get(key) : undefined;
    const preN = ui !== undefined ? preShown(ui) : 0;
    const pre = preN > 0 ? ` · antes de 2018: ${f0(preN)}` : '';
    return `<button type="button" class="chip" data-f="${i}" aria-pressed="${i === st.ifam}">${esc(tc(IX.brands[f[0]]) + ' ' + tc(f[1]))}<span class="c num">${f0(IX.ftot[i])}${pre}</span></button>`;
  }).concat(extra.map(i => `<button type="button" class="chip" data-u="${i}" aria-pressed="${i === st.upre}">${esc(uFamLabel(i))}<span class="c num">antes de 2018: ${f0(preShown(i) || U.pre[i])}</span></button>`));
  $('#sugg').innerHTML = chips.length ? chips.join('') : '<span class="note">No encontré ese modelo. Probá con una parte del nombre.</span>';
  $('#sugg').querySelectorAll('.chip').forEach(c => {
    c.onclick = () => { st.followModel = true; c.dataset.u !== undefined ? showPre(+c.dataset.u) : showFam(+c.dataset.f); };
  });
  return { list, extra };
}
$('#q').oninput = e => suggest(e.target.value);
$('#q').onkeydown = e => { if (e.key === 'Enter') { const l = suggest(e.target.value); st.followModel = true; if (l.list.length) showFam(l.list[0]); else if (l.extra.length) showPre(l.extra[0]); else st.followModel = false; } };

function ymText(ym) { return MESES[(ym % 100) - 1] + ' ' + Math.floor(ym / 100); }
function partirRecorrido(hops) {
  const ordered = (hops || []).slice().sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const tracks = [];
  for (const h of ordered) {
    const fecha = h[0], prov = h[1] || '';
    let stay = null, move = null;
    for (const t of tracks) {
      if (fecha < t.last) continue;
      if (fecha === t.last) { if (prov === t.prov) stay = t; continue; }
      if (prov === t.prov) { if (!stay) stay = t; }
      else if (!move || t.last > move.last) move = t;
    }
    const dest = stay || move;
    if (!dest) tracks.push({ hops: [[fecha, prov]], last: fecha, prov });
    else if (!(dest.last === fecha && dest.prov === prov)) {
      dest.hops.push([fecha, prov]);
      dest.last = fecha;
      dest.prov = prov;
    }
  }
  return tracks.map(t => t.hops);
}
function caminoProv(hops) {
  const out = [];
  (hops || []).forEach(h => {
    const p = h[1] ? provNice(h[1], h[1]) : '';
    if (p && out[out.length - 1] !== p) out.push(p);
  });
  return out.join(' → ');
}
function unidadesRare(i) {
  if (!U || !U.rvM || i == null || i < 0) return null;
  const f = U.fams[i];
  if (!f) return null;
  const items = U.rvM.get(norm(U.brands[f[0]]) + '|' + norm(f[1]));
  if (!items || !items.length) return null;
  const cars = [];
  items.forEach(item => (item[3] || []).forEach(raw => {
    partirRecorrido(raw[2]).forEach(hops => cars.push({ modelo: item[2], insc: raw[0] || '', anio: raw[1] || 0, hops }));
  }));
  return cars;
}
function preYearMap(i) {
  const cars = unidadesRare(i);
  if (!cars) return null;
  const m = new Map();
  cars.forEach(c => {
    const y = +String(c.insc || '').slice(0, 4);
    if (y > 0 && y < 2018) m.set(y, (m.get(y) || 0) + 1);
  });
  return m;
}
function rarePreCount(i) {
  const cars = unidadesRare(i);
  if (!cars) return null;
  const modelos = new Set(cars.map(c => c.modelo));
  const month = new Map(), byMonthVer = new Map(), allVer = new Map();
  const add = (ym, modelo, n) => {
    if (!(n > 0) || !ym) return;
    month.set(ym, (month.get(ym) || 0) + n);
    allVer.set(modelo, (allVer.get(modelo) || 0) + n);
    let mv = byMonthVer.get(ym);
    if (!mv) { mv = new Map(); byMonthVer.set(ym, mv); }
    mv.set(modelo, (mv.get(modelo) || 0) + n);
  };
  const previas = [];
  cars.forEach(car => {
    const insc = String(car.insc || '');
    if (insc.length < 7) return;
    const y = +insc.slice(0, 4), mo = +insc.slice(5, 7);
    if (!(y > 0 && y < 2018 && mo >= 1 && mo <= 12)) return;
    const ym = y * 100 + mo;
    add(ym, car.modelo, 1);
    previas.push({ modelo: car.modelo, insc: car.insc, ym, hops: car.hops });
  });
  ((U.fyv && U.fyv[i]) || []).forEach(row => {
    (row[2] || []).forEach(([name, v]) => { if (!modelos.has(name)) add(row[0], name, v); });
  });
  return { month, byMonthVer, allVer, cars: previas };
}
function preShown(i) {
  const rc = rarePreCount(i);
  if (!rc) return (U && U.pre && U.pre[i]) || 0;
  let t = 0;
  rc.month.forEach(v => { t += v; });
  return t || (U.pre && U.pre[i]) || 0;
}
function preSeries(i) {
  const cats = [], vals = [];
  let total = 0, y0 = 0, y1 = 0;
  const rc = rarePreCount(i);
  const rows = U && U.fyv && i !== undefined && i >= 0 ? U.fyv[i] : null;
  const src = rc && rc.month.size ? rc.month : null;
  if (!src && (!rows || !rows.length)) return { cats, vals, total, y0, y1, once: false };
  const keys = src ? [...src.keys()].sort((a, b) => a - b) : rows.map(r => r[0]);
  const first = keys[0], last = keys[keys.length - 1];
  let y = Math.floor(first / 100), m = first % 100;
  const yEnd = Math.floor(last / 100), mEnd = last % 100;
  const by = src || new Map(rows.map(r => [r[0], r[1]]));
  while (y < yEnd || (y === yEnd && m <= mEnd)) {
    const key = y * 100 + m;
    const v = by.get(key) || 0;
    cats.push(key); vals.push(v);
    if (v > 0) { total += v; if (!y0) y0 = y; y1 = y; }
    m++; if (m === 13) { m = 1; y++; }
  }
  return { cats, vals, total, y0, y1, once: !!src };
}
let preYear = null;
function preVersionRows(i) {
  if (!U || i === undefined || i < 0) return [];
  const rc = rarePreCount(i);
  if (rc && rc.allVer.size) {
    const src = preYear != null ? (rc.byMonthVer.get(preYear) || new Map()) : rc.allVer;
    return [...src.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }
  if (preYear != null && U.fyv && U.fyv[i]) {
    const hit = U.fyv[i].find(r => r[0] === preYear);
    return hit ? hit[2] : [];
  }
  return (U.fv && U.fv[i]) || [];
}
function drawPre(el, i) {
  const s = preSeries(i);
  if (!el || !s.total) return;
  const marked = new Set();
  if (preYear != null) {
    const at = s.cats.indexOf(preYear);
    if (at >= 0) marked.add(at);
  }
  chart(el, {
    cats: s.cats, series: [{ color: 'var(--s2)', v: s.vals }], sel: marked, h: 140,
    label: 'Inscripciones anteriores a 2018 vistas en transferencias posteriores',
    tip: k => s.once
      ? `${ymText(s.cats[k])}: ${f0(s.vals[k])} ${Math.round(s.vals[k]) === 1 ? 'auto patentado' : 'autos patentados'} ese mes. Tocá la barra para ver las versiones.`
      : `${ymText(s.cats[k])}: ${f0(s.vals[k])} de este modelo se habían patentado ese mes y después se transfirieron. Tocá la barra para ver las versiones de ese mes.`,
    tick: k => {
      const ym = s.cats[k];
      if (ym % 100 !== 1) return '';
      const year = Math.floor(ym / 100), n = s.cats.length;
      if (n <= 36) return String(year);
      if (n <= 120) return year % 2 === 0 ? String(year) : '';
      return year % 5 === 0 ? String(year) : '';
    },
    pick: k => {
      if (!(s.vals[k] > 0)) return;
      const y = s.cats[k];
      preYear = preYear === y ? null : y;
      drawPre(el, i);
      drawPreVersions(i);
    },
  });
}
function preBlock(i) {
  const s = preSeries(i);
  if (!s.total) return '';
  const cuantos = s.once && Math.round(s.total) === 1 ? 'se patentó' : 'se habían patentado';
  const aviso = s.once
    ? 'Cada auto cuenta una sola vez, por el día en que se patentó. Si en el recorrido cambia la provincia, es el mismo auto pasando de un dueño al siguiente.'
    : 'No es el total patentado ese mes: el que nunca se transfirió en ese período no aparece, y uno transferido dos veces cuenta dos.';
  return `<h3 style="margin-top:18px">Antes de 2018</h3>
    <div class="kv"><span><b>${f0(s.total)}</b> ${cuantos} entre ${s.y0} y ${s.y1}</span><span>visto porque se transfirieron entre ${mLabel(U.months[0])} y ${mLabel(U.months[U.months.length - 1])}</span></div>
    <div id="f-pre" style="margin-top:8px"></div>
    ${preVersionsHTML(i)}
    <p class="note">Cada barra es un mes de inscripción inicial de autos de este modelo que después cambiaron de dueño. Tocá una barra y las versiones quedan solo de ese mes; tocala de nuevo para ver todos. ${aviso} De estos no hay provincia del primer patentamiento ni género del primer dueño.</p>`;
}
function preVersionsHTML(i) {
  const any = U && U.fv && i !== undefined && i >= 0 && U.fv[i] && U.fv[i].length;
  if (!any) return '';
  return `<h3 id="f-pre-ver-h" style="margin-top:14px">Versiones</h3><div class="bars" id="f-pre-ver"></div>`;
}
function drawPreVersions(i) {
  const el = $('#f-pre-ver'), h = $('#f-pre-ver-h');
  if (h) h.textContent = preYear == null ? 'Versiones' : 'Versiones en ' + ymText(preYear);
  if (!el || !U || i === undefined || i < 0) return;
  const rows = preVersionRows(i).slice(0, 8);
  if (!rows.length) {
    el.innerHTML = '<div class="more">No hay versiones con nombre para ese mes.</div>';
    return;
  }
  const rc = rarePreCount(i);
  bars(el, rows.map(([name, v]) => {
    const unos = rc && rc.cars ? rc.cars.filter(c => c.modelo === name && (preYear == null || c.ym === preYear)) : [];
    const tip = unos.length && unos.length <= 4
      ? unos.map(c => `${tc(name)}, inscripto el ${fechaCorta(c.insc)}: ${caminoProv(c.hops) || 'sin provincia'}`).join(' · ')
      : `${tc(name)}: ${f0(v)}`;
    return { label: tc(name), v, tip };
  }));
}
function markChips() {
  document.querySelectorAll('#sugg .chip').forEach(c => {
    const on = c.dataset.u !== undefined ? +c.dataset.u === st.upre : +c.dataset.f === st.ifam;
    c.setAttribute('aria-pressed', on);
  });
}
function showPre(i) {
  if (i !== st.upre) preYear = null;
  st.ifam = -1; st.upre = i;
  const s = preSeries(i), lab = uFamLabel(i);
  const inscLbl = Math.round(s.total) === 1 ? 'patentado antes de 2018 y transferido después' : 'patentados antes de 2018 y transferidos después';
  const once = s.once ? ' Cada auto cuenta una sola vez, por el día en que se patentó. Si en el recorrido cambia la provincia, es el mismo auto pasando de un dueño al siguiente.' : '';
  $('#fres').innerHTML = `<div class="big"><div><div class="fam">${esc(lab)}</div><div class="l">no está en el padrón mensual desde 2018</div></div>
      <div><div class="n num">${f0(s.total)}</div><div class="l">${inscLbl}</div></div>
      <div><div class="n num">${s.y0 || '–'}</div><div class="l">${s.y0 ? 'inscripción más antigua vista' + (s.y1 && s.y1 !== s.y0 ? ', hasta ' + s.y1 : '') : 'sin fecha anterior a 2018'}</div></div></div>
    <div id="f-pre"></div>
    ${preVersionsHTML(i)}
    <div id="f-rc"></div>
    <p class="note">Este nombre no aparece en los patentamientos mensuales, o está escrito distinto. Cada barra es un mes de inscripción inicial. Tocá una barra y las versiones quedan solo de ese mes; tocala de nuevo para ver todos.${once} No es el padrón completo. De estos no hay provincia del primer patentamiento ni género del primer dueño.</p>`;
  drawPre($('#f-pre'), i);
  drawPreVersions(i);
  const uf = U.fams[i];
  renderRecorrido(U.brands[uf[0]], uf[1]);
  markChips();
  renderMapa();
  renderMapaUsados();
}
function showFam(ifam) {
  if (ifam !== st.ifam) preYear = null;
  st.ifam = ifam;
  st.upre = -1;
  const [bi, fname] = IX.fams[ifam], brand = IX.brands[bi], label = tc(brand) + ' ' + tc(fname);
  const series = IX.fs[ifam], total = IX.ftot[ifam];
  const selIdx = new Set(st.months.map(m => IX.pos.get(m)));
  let per = 0; selIdx.forEach(i => { per += series[i]; });
  let rank = 0, active = 0;
  { const ids = [...selIdx]; if (per > 0) rank = 1;
    for (let j = 0; j < IX.fs.length; j++) { let s = 0; const a = IX.fs[j]; for (const i of ids) s += a[i]; if (s > 0) active++; if (per > 0 && j !== ifam && s > per) rank++; } }
  let nz = 0, best = 0; series.forEach((v, i) => { if (v > 0) nz++; if (v > series[best]) best = i; });
  const perTxt = st.months.length === 1 ? mLabel(st.months[0]) : `${mShort(st.months[0])} a ${mShort(st.months[st.months.length - 1])}`;

  const sb = G.marcaM.get(brand), sf = sb === undefined ? undefined : G.famM.get(sb + '|' + fname);
  const rows = [];
  if (sf !== undefined) for (const { M } of selP) {
    const idx = new Int32Array(M.n); let c = 0; for (let i = 0; i < M.n; i++) if (M.f[i] === sf) idx[c++] = i;
    if (c) rows.push({ M, idx: idx.subarray(0, c) });
  }
  let detail = '', after = null, y0 = 9999, y1 = 0;
  const hasRows = rows.length > 0;
  if (hasRows) {
    const ve = ranked(tally(rows, 'v', G.ver.length), 8), oc = ranked(tally(rows, 'o', G.orig.length)), pv = mergeProv(tally(rows, 'p', G.prov.length)).slice(0, 5), ty = ranked(tally(rows, 't', G.tipo.length), 3);
    const yc = {};
    rows.forEach(({ M, idx }) => { for (let k = 0; k < idx.length; k++) { const i = idx[k], y = M.y[i]; yc[y] = (yc[y] || 0) + M.w[i] / 100; y0 = Math.min(y0, y); y1 = Math.max(y1, y); } });
    const ys = Object.keys(yc).sort();
    detail = `<div class="kv"><span>Año modelo <b>${y0 === y1 ? y0 : y0 + ' a ' + y1}</b>${ys.length > 1 ? ` (${ys.slice(-6).map(y => y + ': ' + f0(yc[y])).join(', ')}${ys.length > 6 ? ', …' : ''})` : ''}</span>
      <span>Origen <b>${oc.map(([i, c]) => G.orig[i] + ' ' + pc(c / per)).join(', ')}</b></span>
      <span>Carrocería <b>${ty.map(([i]) => tc(G.tipo[i])).join(', ')}</b></span></div>
    <div class="two" style="margin-top:18px"><div><h3>Versiones en ${esc(perTxt)}</h3><div class="bars" id="fv"></div></div><div><h3>Provincias principales</h3><div class="bars" id="fp"></div></div></div>
    <div style="margin-top:18px" id="fo">${ownersHTML(ownerStats(rows), 10)}</div>`;
    after = () => {
      bars($('#fv'), ve.map(([i, c]) => ({ label: tc(G.verTxt[i]), v: c, tip: `${verLabel(i)}: ${f0(c)}` })));
      bars($('#fp'), pv.map(r => ({ label: provNice(r.k, G.prov[r.i]), v: r.v })));
      fillOwners($('#fo'), ownerStats(rows));
    };
  } else {
    detail = `<p class="vacio">No hay patentamientos de este modelo en ${esc(perTxt)}. Cambiá el período arriba o tocá una barra del gráfico.</p>`;
  }
  const regY = st.months.length ? +st.months[st.months.length - 1].slice(0, 4) : new Date().getFullYear();
  const recent = hasRows && y1 >= regY - 1;
  $('#fres').innerHTML = `
    <div class="big"><div><div class="fam">${esc(label)}</div><div class="l">patentados desde ${mLabel(IX.months[0].m)}</div></div>
      <div><div class="n num">${f0(total)}</div><div class="l">${IX.avail.length === 1 ? 'en el único mes cargado' : 'en los ' + f0(IX.avail.length) + ' meses cargados'}</div></div>
      <div><div class="n num">${f0(per)}</div><div class="l">en ${esc(perTxt)}</div></div>
      <div><div class="n num">${rank ? '#' + f0(rank) : '–'}</div><div class="l">${rank ? 'puesto entre ' + f0(active) + ' modelos patentados en ese período' : 'sin unidades en el período'}</div></div></div>
    <div class="kv"><span>Mejor mes: <b>${series[best] > 0 ? mLabel(IX.months[best].m) + ' (' + f0(series[best]) + ')' : '–'}</b></span><span>Meses con patentamientos: <b>${f0(nz)} de ${f0(IX.avail.length)}</b></span>
      <span><a href="https://listado.mercadolibre.com.ar/${slug(label + (recent ? ' 0km' : ''))}" target="_blank" rel="noopener">Ver precios de ${esc(label)} en Mercado Libre</a></span>${usadosSpan(brand, fname)}</div>
    <div id="f-chart" style="margin-top:16px"></div>
    ${detail}
    ${preBlock(U ? U.famM.get(brand + '|' + fname) : undefined)}
    <div id="f-rc"></div>
    <p class="note">Las barras azules son patentamientos iniciales del padrón mensual. Un auto patentado antes de ${esc(mLabel(IX.months[0].m))} no entra en esas barras. Los precios de Mercado Libre son los de hoy.</p>`;
  if (after) after();
  chart($('#f-chart'), {
    cats: IX.months, series: [{ color: 'var(--s1)', v: series }], sel: selIdx, h: 150, label: 'Patentamientos por mes de ' + label,
    missing: IX.months.map(x => !x.file),
    tip: i => `${mLabel(IX.months[i].m)}: ${IX.months[i].file ? f0(series[i]) : 'sin datos cargados'}`,
    tick: tickFn, pick: i => { if (IX.months[i].file) setPeriod('m:' + IX.months[i].m); },
  });
  const ui = U ? U.famM.get(brand + '|' + fname) : undefined;
  if (ui !== undefined) { drawPre($('#f-pre'), ui); drawPreVersions(ui); }
  renderRecorrido(brand, fname);
  markChips();
  renderMapa();
  renderMapaUsados();
}
function tickFn(i) {
  const n = IX.months.length, m = IX.months[i].m;
  if (n <= 14) return mShort(m);
  if (n <= 40) return m.endsWith('-01') || m.endsWith('-07') ? mShort(m) : '';
  return m.endsWith('-01') ? m.slice(0, 4) : '';
}

/* ---------- evolución mensual ---------- */
function renderEvo() {
  const mo = IX.months, selIdx = new Set(st.months.map(m => IX.pos.get(m)));
  const sv = [0, 1, 2, 3].map(k => mo.map(x => x.o[k] || 0));
  const names = ['Nacional', 'Importado', 'Protocolo 21', 'Otro'];
  chart($('#evo'), {
    cats: mo, series: sv.map((v, k) => ({ color: ORIG_COL[k], v })), sel: selIdx, h: 230, label: 'Patentamientos por mes según origen',
    missing: mo.map(x => !x.file),
    tip: i => mo[i].file ? `${mLabel(mo[i].m)}: ${f0(mo[i].n)} (${names.slice(0, 3).map((nm, k) => nm + ' ' + f0(mo[i].o[k])).join(', ')})` : `${mLabel(mo[i].m)}: sin datos cargados`,
    tick: tickFn, pick: i => { if (mo[i].file) setPeriod('m:' + mo[i].m); },
  });
  $('#evo-leg').innerHTML = names.map((nm, k) => (k < 3 || sv[3].some(x => x)) ? `<div><span class="sw" style="background:${ORIG_COL[k]}"></span>${nm}</div>` : '').join('') +
    (mo.some(x => !x.file) ? '<div><span class="sw" style="background:none;border-bottom:2px dashed var(--mute);height:8px;border-radius:0"></span>Mes sin cargar</div>' : '');
}

/* ---------- tablero ---------- */
function renderHint() {
  const z = st.months, p = [z.length === 1 ? mLabel(z[0]) : `${mLabel(z[0])} a ${mLabel(z[z.length - 1])}`];
  if (st.origOff.size) p.push('sin ' + [...st.origOff].join(' ni '));
  if (st.era !== 'all') p.push($('#f-era').selectedOptions[0].textContent.replace(/ \([^)]*\)$/, ''));
  if (st.brand >= 0) p.push(tc(G.marca[st.brand]));
  if (st.tipo >= 0) p.push(tc(G.tipo[st.tipo]));
  if (st.prov >= 0) p.push(provNice(provKey(G.prov[st.prov]), G.prov[st.prov]));
  if (st.pe >= 0) p.push(st.pe ? 'solo empresas' : 'solo personas');
  if (st.ev >= 0) p.push(EV_LABEL[st.ev]);
  if (st.q) p.push('modelo con “' + st.q + '”');
  $('#sel-hint').textContent = p.join(' · ');
}
function renderStats() {
  const o = tally(sel, 'o', G.orig.length), tot = o.reduce((a, b) => a + b, 0);
  const br = new Set(), fa = new Set(); let age = 0, ageN = 0;
  for (const { M, idx } of sel) for (let k = 0; k < idx.length; k++) { const i = idx[k]; br.add(M.b[i]); fa.add(M.f[i]); }
  const os = ownerStats(sel); os.age.forEach((v, i) => { age += v * AGE_MID[i]; ageN += v; });
  const imp = tot - o[0];
  const s = [[f0(tot), 'Vehículos patentados'], [f0(br.size), 'Marcas'], [f0(fa.size), 'Modelos'], [tot ? pc(imp / tot) : '–', 'Importados o Protocolo 21'], [ageN ? Math.round(age / ageN) : '–', 'Edad media del titular (aprox.)']];
  $('#stats').innerHTML = s.map(x => `<div class="stat"><div class="v num">${x[0]}</div><div class="k">${x[1]}</div></div>`).join('');
}
function renderTiempo() {
  const el = $('#tiempo'), single = st.months.length === 1;
  $('#h-tiempo').textContent = single ? 'Patentamientos por día' : 'Patentamientos por mes';
  $('#tiempo-leg').hidden = !single;
  if (single) {
    const [y, mo] = st.months[0].split('-').map(Number), nd = new Date(y, mo, 0).getDate(), d = tally(sel, 'd', 32);
    const vals = []; for (let k = 1; k <= nd; k++) vals.push(d[k]);
    const best = vals.indexOf(Math.max(...vals));
    chart(el, {
      cats: vals, series: [{ color: 'var(--s1)', v: vals }], h: 220, label: 'Patentamientos por día',
      alpha: i => { const w = new Date(y, mo - 1, i + 1).getDay(); return w === 0 || w === 6 ? 0.4 : 1; },
      tip: i => `${DOW[new Date(y, mo - 1, i + 1).getDay()]} ${i + 1} de ${MESES[mo - 1]}: ${f0(vals[i])}`,
      tick: i => (i === 0 || (i + 1) % 5 === 0) ? String(i + 1) : '',
    });
    $('#tiempo-hint').textContent = vals.some(v => v > 0) ? `Día más movido: ${best + 1} de ${MESES[mo - 1]}, con ${f0(vals[best])}` : '';
  } else {
    const vals = st.months.map(m => count(sel.filter(s => s.M.m === m)));
    chart(el, {
      cats: st.months, series: [{ color: 'var(--s1)', v: vals }], h: 220, label: 'Patentamientos por mes',
      tip: i => `${mLabel(st.months[i])}: ${f0(vals[i])}`, tick: i => st.months.length <= 14 ? mShort(st.months[i]) : st.months[i].endsWith('-01') ? st.months[i].slice(0, 4) : '',
      pick: i => setPeriod('m:' + st.months[i]),
    });
    $('#tiempo-hint').textContent = 'Tocá una barra para ver ese mes';
  }
}
function renderOrigen() {
  const o = tally(sel, 'o', G.orig.length), tot = o.reduce((a, b) => a + b, 0);
  if (!tot) { $('#origen').innerHTML = '<div class="more">No hay datos con la selección actual.</div>'; return; }
  $('#origen').innerHTML = `<div class="stack">${Array.from(o, (v, i) => v ? `<i style="flex:${v};background:${ORIG_COL[Math.min(i, 3)]}" data-tip="${esc(G.orig[i])}: ${f0(v)} (${pc(v / tot)})"></i>` : '').join('')}</div>
  <div class="legend">${Array.from(o, (v, i) => v ? `<div><span class="sw" style="background:${ORIG_COL[Math.min(i, 3)]}"></span>${esc(G.orig[i])}<span class="nn num">${f0(v)} · ${pc(v / tot)}</span></div>` : '').join('')}</div>
  <p class="note">Nacional es lo fabricado en Argentina. Importado y Protocolo 21 son categorías de importación del registro.</p>`;
}
function renderListas() {
  const tot = count(sel) || 1;
  bars($('#tipo'), ranked(tally(sel, 't', G.tipo.length), 9).map(([i, v]) => ({ label: tc(G.tipo[i]), v, tip: `${tc(G.tipo[i])}: ${f0(v)} (${pc(v / tot)})`, click: () => toggle('tipo', i, '#f-tipo'), on: st.tipo === i })));
  bars($('#marcas'), ranked(tally(sel, 'b', G.marca.length), 12).map(([i, v]) => ({ label: tc(G.marca[i]), v, tip: `${tc(G.marca[i])}: ${f0(v)} (${pc(v / tot)})`, click: () => toggle('brand', i, '#f-brand'), on: st.brand === i })));
  bars($('#modelos'), ranked(tally(sel, 'f', G.fam.length), 12).map(([f, v]) => ({
    label: famLabel(f), v, tip: `${famLabel(f)}: ${f0(v)} (${pc(v / tot)}). Tocá para ver su historia`,
    click: () => { const k = IX.famKey.get(G.marca[G.famBrand[f]] + '|' + G.famName[f]); if (k !== undefined) { st.followModel = true; showFam(k); $('#buscador').scrollIntoView({ behavior: 'smooth' }); } },
  })));
  bars($('#provs'), mergeProv(tally(sel, 'p', G.prov.length)).slice(0, 12).map(r => ({ label: provNice(r.k, G.prov[r.i]), v: r.v, tip: `${provNice(r.k, G.prov[r.i])}: ${f0(r.v)} (${pc(r.v / tot)})`, click: () => provPick(r.k), on: st.prov >= 0 && provKey(G.prov[st.prov]) === r.k })));
  const os = ownerStats(sel), el = $('#titulares'); el.innerHTML = ownersHTML(os, 10); fillOwners(el, os);
}

/* ---------- los más raros ---------- */
const rareList = makeList('#r-tab', '#r-more', [{ t: 'Marca y modelo' }, { t: 'Unidades', r: true, cls: 'r num' }, { t: 'Año modelo', cls: 'yr' }, { t: 'Origen' }, { t: 'Provincia' }, { t: 'Precios' }], 40);
function renderRaros() {
  const N = +$('#r-max').value, pass = $('#r-pass').checked, nf = G.fam.length;
  const ft = new Float64Array(nf);
  for (const { M, idx } of sel) for (let k = 0; k < idx.length; k++) {
    const i = idx[k]; if (pass && !G.tipoPass[M.t[i]]) continue;
    if (SINDATO.test(G.marca[M.b[i]])) continue;
    ft[M.f[i]] += M.w[i] / 100;
  }
  let nm = 0, rare = 0; const hist = [0, 0, 0, 0, 0, 0, 0];
  const cut = [1, 2, 5, 10, 50, 200];
  for (let f = 0; f < nf; f++) { const c = ft[f]; if (c <= 0) continue; nm++; if (c <= N) rare++; let b = 0; while (b < cut.length && c > cut[b]) b++; hist[b]++; }
  const hl = ['1 unidad', '2 unidades', '3 a 5', '6 a 10', '11 a 50', '51 a 200', 'Más de 200'];
  bars($('#r-hist'), hl.map((l, i) => ({ label: l, v: hist[i], tip: `${l}: ${f0(hist[i])} modelos` })));
  $('#r-sum').innerHTML = nm ? `<b>${f0(rare)}</b> de <b>${f0(nm)}</b> modelos (${pc(rare / nm)}) tuvieron ${N === 1 ? 'una sola unidad' : 'hasta ' + N + ' unidades'} en la selección.` : 'No hay datos con la selección actual.';
  const info = new Map();
  for (const { M, idx } of sel) for (let k = 0; k < idx.length; k++) {
    const i = idx[k], f = M.f[i], c = ft[f]; if (c <= 0 || c > N) continue;
    if (pass && !G.tipoPass[M.t[i]]) continue;
    let r = info.get(f); if (!r) { r = { f, units: c, v: M.v[i], y0: 9999, y1: 0, o: new Set(), p: new Set(), regY: M.year }; info.set(f, r); }
    r.y0 = Math.min(r.y0, M.y[i]); r.y1 = Math.max(r.y1, M.y[i]); r.o.add(G.orig[M.o[i]]); r.p.add(G.prov[M.p[i]]); r.regY = Math.max(r.regY, M.year);
  }
  const arr = [...info.values()].sort((a, b) => a.units - b.units || a.y0 - b.y0 || G.famName[a.f].localeCompare(G.famName[b.f])).slice(0, 1500);
  rareList.set(arr.map(r => {
    const label = r.units <= 1 ? verLabel(r.v) : famLabel(r.f), p = [...r.p];
    return [esc(label), f0(r.units), r.y0 === r.y1 ? r.y0 : r.y0 + ' a ' + r.y1, esc([...r.o].join(', ')), esc(p.slice(0, 2).join(', ') + (p.length > 2 ? ' y ' + (p.length - 2) + ' más' : '')), mlLink(label, r.y1, r.regY)];
  }));
}
$('#r-max').onchange = renderRaros; $('#r-pass').onchange = renderRaros;

/* ---------- superdeportivos y exóticos ---------- */
const exoList = makeList('#x-tab', '#x-more', [{ t: 'Grupo' }, { t: 'Marca y modelo' }, { t: 'Año modelo', cls: 'yr' }, { t: 'Origen' }, { t: 'Provincia' }, { t: 'Precios' }], 40);
function renderExoticos() {
  const gs = CFG.grupos, refs = [], gc = gs.map(() => 0);
  for (const { M, idx } of sel) for (let k = 0; k < idx.length; k++) {
    const i = idx[k], g = G.verEx[M.v[i]]; if (g < 0) continue;
    refs.push({ M, i, g }); gc[g] += M.w[i] / 100;
  }
  const tot = gc.reduce((a, b) => a + b, 0);
  $('#x-sum').innerHTML = gs.length ? `<span><b>${f0(tot)}</b> vehículos en la selección</span>` + gs.map((g, k) => `<span>${esc(g.nombre)}: <b>${f0(gc[k])}</b></span>`).join('') : '<span>No se pudo leer data/exoticos.json.</span>';
  const bc = new Map(); refs.forEach(r => { const b = G.marca[M_b(r)]; bc.set(b, (bc.get(b) || 0) + r.M.w[r.i] / 100); });
  bars($('#x-marcas'), [...bc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([b, v]) => ({ label: tc(b), v })));
  const sb = (CFG.serie || []).map(n => IX.brands.indexOf(n)).filter(i => i >= 0);
  const vals = IX.months.map((_, i) => sb.reduce((s, b) => s + (IX.bs[b][i] || 0), 0));
  const selIdx = new Set(st.months.map(m => IX.pos.get(m)));
  chart($('#x-serie'), { cats: IX.months, series: [{ color: 'var(--s2)', v: vals }], sel: selIdx, h: 150, label: 'Marcas exóticas por mes', missing: IX.months.map(x => !x.file), tip: i => `${mLabel(IX.months[i].m)}: ${IX.months[i].file ? f0(vals[i]) : 'sin datos cargados'}`, tick: tickFn, pick: i => { if (IX.months[i].file) setPeriod('m:' + IX.months[i].m); } });
  refs.sort((a, b) => a.g - b.g || G.marca[M_b(a)].localeCompare(G.marca[M_b(b)]) || G.verTxt[a.M.v[a.i]].localeCompare(G.verTxt[b.M.v[b.i]]));
  exoList.set(refs.slice(0, 1500).map(({ M, i, g }) => {
    const v = M.v[i], lab = verLabel(v);
    return [`<span class="tag">${esc(gs[g].nombre)}</span>`, esc(lab), M.y[i], esc(G.orig[M.o[i]]), esc(G.prov[M.p[i]]), mlLink(lab, M.y[i], M.year)];
  }));
}
const M_b = r => r.M.b[r.i];

/* ---------- clásicos ---------- */
const claList = makeList('#c-tab', '#c-more', [{ t: 'Año modelo', cls: 'yr' }, { t: 'Marca y modelo' }, { t: 'Carrocería' }, { t: 'Origen' }, { t: 'Provincia' }, { t: 'Trámite' }, { t: 'Precios' }], 40);
const TRAM = ['Nacional', 'Importado', 'Por dictamen u oficio', 'Formulario 05', 'Auto clásico'];
function renderClasicos() {
  const minAge = +$('#c-edad').value, refs = [], dec = {}; let tot = 0, imp = 0;
  const fc = new Float64Array(G.fam.length);
  for (const { M, idx } of sel) for (let k = 0; k < idx.length; k++) {
    const i = idx[k], a = M.year - M.y[i];
    if (!(a >= minAge || (minAge === 30 && M.tr[i] === 4))) continue;
    const w = M.w[i] / 100, y = M.y[i], key = y < 1960 ? 'Antes de 1960' : Math.floor(y / 10) * 10 + 's';
    dec[key] = (dec[key] || 0) + w; tot += w; if (M.o[i] !== 0) imp += w; fc[M.f[i]] += w;
    refs.push({ M, i });
  }
  const order = ['Antes de 1960', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s'];
  bars($('#c-dec'), order.filter(k => dec[k]).map(k => ({ label: k, v: dec[k] })));
  let oldest = 9999; refs.forEach(r => { oldest = Math.min(oldest, r.M.y[r.i]); });
  $('#c-sum').innerHTML = tot ? `<div class="kv" style="margin:0"><span><b>${f0(tot)}</b> vehículos</span><span><b>${oldest}</b> el año modelo más viejo</span><span><b>${pc(imp / tot)}</b> importados</span></div>` : '<div class="vacio">No hay vehículos tan antiguos en la selección.</div>';
  bars($('#c-top'), ranked(fc, 6).map(([f, v]) => ({ label: famLabel(f), v })));
  refs.sort((a, b) => a.M.y[a.i] - b.M.y[b.i] || a.M.v[a.i] - b.M.v[b.i]);
  claList.set(refs.slice(0, 1500).map(({ M, i }) => {
    const lab = verLabel(M.v[i]);
    return [M.y[i], esc(lab), esc(tc(G.tipo[M.t[i]])), esc(G.orig[M.o[i]]), esc(G.prov[M.p[i]]), esc(TRAM[M.tr[i]] || ''), mlLink(lab, M.y[i], M.year)];
  }));
}
$('#c-edad').onchange = renderClasicos;

/* ---------- híbridos y eléctricos ---------- */
function toggleEv(i) {
  st.ev = st.ev === i ? -1 : i;
  update();
}
function renderElectricos() {
  let open = sel;
  if (st.ev >= 0) {
    const prev = st.ev;
    st.ev = -1;
    try { open = buildSel(st.months, true); }
    finally { st.ev = prev; }
  }
  const cat = new Float64Array(5), fc = new Float64Array(G.fam.length);
  for (const { M, idx } of open) for (let k = 0; k < idx.length; k++) {
    const i = idx[k], c = G.verEv[M.v[i]], w = M.w[i] / 100; cat[c] += w;
  }
  for (const { M, idx } of sel) for (let k = 0; k < idx.length; k++) {
    const i = idx[k], c = G.verEv[M.v[i]]; if (c > 0 || c === st.ev) fc[M.f[i]] += M.w[i] / 100;
  }
  const tot = cat.reduce((a, b) => a + b, 0), ele = tot - cat[0];
  const col = ['var(--s4)', 'var(--s3)', 'var(--s1)', 'var(--s2)', 'var(--ink)'];
  const stack = Array.from(cat, (v, i) => v ? `<button type="button" class="seg${st.ev === i ? ' on' : ''}" style="flex:${v};background:${col[i]}" data-tip="${EV_LABEL[i]}: ${f0(v)} (${pc(v / tot)})" aria-label="${esc(EV_LABEL[i])}" aria-pressed="${st.ev === i}" data-ev="${i}"></button>` : '').join('');
  const legend = Array.from(cat, (v, i) => `<button type="button" class="legbtn${st.ev === i ? ' on' : ''}" data-ev="${i}" aria-pressed="${st.ev === i}"><span class="sw" style="background:${col[i]}"></span>${EV_LABEL[i]}<span class="nn num">${f0(v)}</span></button>`).join('');
  const lead = !tot ? '' : st.ev >= 0
    ? `<div class="lead">Filtro activo: <b>${EV_LABEL[st.ev]}</b>. El resto de la página muestra solo esos. Tocá de nuevo para ver todos.</div>`
    : `<div class="lead"><b>${pc(ele / tot)}</b> de la selección (${f0(ele)} de ${f0(tot)} vehículos) tiene algún grado de electrificación.</div>`;
  $('#e-sum').innerHTML = tot ? `${lead}<div class="stack">${stack}</div><div class="legend row-legend">${legend}</div>` : '<div class="vacio">No hay datos con la selección actual.</div>';
  $('#e-sum').querySelectorAll('[data-ev]').forEach(b => { b.onclick = () => toggleEv(+b.dataset.ev); });
  const top = ranked(fc, 10), set = new Map(top.map(([f]) => [f, new Float64Array(5)]));
  for (const { M, idx } of sel) for (let k = 0; k < idx.length; k++) { const i = idx[k], a = set.get(M.f[i]); if (a) a[G.verEv[M.v[i]]] += M.w[i] / 100; }
  bars($('#e-top'), top.map(([f, v]) => {
    const a = set.get(f), parts = [...a].map((x, i) => x > 0 && (i > 0 || st.ev === 0) ? EV_LABEL[i] + ' ' + f0(x) : '').filter(Boolean).join(', ');
    return { label: famLabel(f), v, tip: `${famLabel(f)}: ${parts}` };
  }));
}

/* ---------- usados y transferencias ---------- */
function sumAt(arr, ids) {
  let t = 0;
  if (!arr) return 0;
  for (let k = 0; k < ids.length; k++) t += arr[ids[k]] || 0;
  return t;
}
function transferIds() {
  if (!U || !st.months.length) return [];
  const ids = [];
  for (const m of st.months) { const i = U.pos.get(m); if (i !== undefined) ids.push(i); }
  return ids;
}
function uFamLabel(i) {
  const f = U.fams[i];
  return tc(U.brands[f[0]]) + ' ' + tc(f[1]);
}
function pickUsado(i) {
  uPick = uPick === i ? -1 : i;
  if (uPick >= 0) st.followModel = true;
  renderUsados();
  if (uPick < 0) return;
  const f = U.fams[i], key = U.brands[f[0]] + '|' + f[1];
  const k = IX.famKey.get(key);
  if (k !== undefined) showFam(k); else showPre(i);
  $('#buscador').scrollIntoView({ behavior: 'smooth' });
}
async function loadUsados() {
  try {
    const d = await getMonthJSON('usados.json.gz');
    d.pos = new Map(d.months.map((m, i) => [m, i]));
    d.famM = new Map(d.fams.map((f, i) => [d.brands[f[0]] + '|' + f[1], i]));
    d.search = d.fams.map(f => norm(d.brands[f[0]] + ' ' + f[1]));
    d.pre = d.fy.map(row => { let t = 0; for (let y = 0; y < d.years.length; y++) if (d.years[y] < 2018) t += row[y] || 0; return t; });
    d.rvM = new Map();
    (d.rv || []).forEach(item => {
      const k = norm(item[0]) + '|' + norm(item[1]);
      let arr = d.rvM.get(k);
      if (!arr) { arr = []; d.rvM.set(k, arr); }
      arr.push(item);
    });
    U = d;
  } catch (e) {
    U = null;
    console.error(e);
  }
  renderUsados();
  renderMapaUsados();
  if ($('#q')) suggest($('#q').value);
  if (U && st.ifam >= 0) showFam(st.ifam);
  else if (U && st.upre >= 0) showPre(st.upre);
}
function fechaCorta(iso) {
  if (!iso || String(iso).length < 8) return 'sin fecha';
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return 'sin fecha';
  return d + ' ' + MC[m - 1] + ' ' + y;
}
function renderRecorrido(brand, fam) {
  const el = $('#f-rc');
  if (!el) return;
  const items = (U && U.rvM && U.rvM.get(norm(brand) + '|' + norm(fam))) || [];
  const cars = [];
  items.forEach(item => item[3].forEach(car => {
    partirRecorrido(car[2]).forEach(hops => cars.push({ modelo: item[2], insc: car[0], anio: car[1], hops }));
  }));
  if (!cars.length || cars.length > 24) { el.innerHTML = ''; return; }
  cars.sort((a, b) => {
    const ch = c => c.hops.reduce((s, h, i) => s + (i && h[1] !== c.hops[i - 1][1] ? 1 : 0), 0);
    return ch(b) - ch(a) || String(a.insc).localeCompare(String(b.insc));
  });
  const draw = n => {
    const html = cars.slice(0, n).map(car => {
      const steps = car.hops.map((h, i) => {
        const prev = i ? car.hops[i - 1][1] : '';
        const donde = h[1] ? provNice(h[1], h[1]) : 'sin provincia';
        const desde = prev && prev !== h[1] ? ` <span class="from">desde ${esc(provNice(prev, prev))}</span>` : '';
        return `<li><span class="when">${esc(fechaCorta(h[0]))}</span><b>${esc(donde)}</b>${desde}</li>`;
      }).join('');
      const anio = car.anio ? `<span>año modelo ${car.anio}</span>` : '';
      return `<div class="unidad"><div class="kv"><span><b>${esc(tc(car.modelo))}</b></span><span>inscripto el ${esc(fechaCorta(car.insc))}</span>${anio}</div><ol class="path">${steps}</ol></div>`;
    }).join('');
    const more = cars.length > n ? `<button type="button" class="btn more-btn" id="f-rc-more">Mostrar más (${f0(cars.length - n)} restantes)</button>` : '';
    el.innerHTML = `<h3 style="margin-top:18px">Recorrido</h3>${html}${more}<p class="note">El mismo día de patentamiento y el mismo año modelo son el mismo auto: el archivo no trae el dominio. Cada provincia es el registro de esa venta. Si cambia, el auto pasó de un dueño al siguiente. Dos provincias el mismo día cuentan como dos autos.</p>`;
    const btn = $('#f-rc-more');
    if (btn) btn.onclick = () => draw(n + 8);
  };
  draw(8);
}
function usadosSpan(brand, fname) {
  if (!U) return '';
  const i = U.famM.get(brand + '|' + fname);
  if (i === undefined) return '';
  const ids = transferIds();
  const n = sumAt(U.fs[i], ids), pj = sumAt(U.fpj[i], ids), to = sumAt(U.fto[i], ids), fr = sumAt(U.ffr[i], ids);
  if (!n) return '';
  return `<span>Transferencias en el período <b>${f0(n)}</b> · nuevo dueño empresa ${pc(pj / n)} · hacia comerciante ${pc(to / n)} · desde comerciante ${pc(fr / n)}</span>`;
}
function flujoHTML(el, partes) {
  const tot = partes.reduce((s, p) => s + p.v, 0);
  if (!tot) { el.innerHTML = '<div class="more">No hay transferencias en el período.</div>'; return; }
  el.innerHTML = `<div class="stack">${partes.map(p => p.v ? `<i style="flex:${p.v};background:${p.color}" data-tip="${esc(p.label)}: ${f0(p.v)} (${pc(p.v / tot)})"></i>` : '').join('')}</div>
    <div class="legend">${partes.map(p => `<div><span class="sw" style="background:${p.color}"></span>${esc(p.label)}<span class="nn num">${f0(p.v)} · ${pc(p.v / tot)}</span></div>`).join('')}</div>`;
}
function isoWeekKey(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wd = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - wd);
  const isoYear = dt.getUTCFullYear();
  const start = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((dt - start) / 86400000) + 1) / 7);
  return isoYear * 100 + week;
}
function rangoDias(a, b) {
  if (a.y === b.y && a.m === b.m) return `${a.d} al ${b.d} de ${MESES[a.m - 1]} de ${a.y}`;
  if (a.y === b.y) return `${a.d} de ${MESES[a.m - 1]} al ${b.d} de ${MESES[b.m - 1]} de ${a.y}`;
  return `${a.d} de ${MESES[a.m - 1]} de ${a.y} al ${b.d} de ${MESES[b.m - 1]} de ${b.y}`;
}
function diasTransfer(ids) {
  const out = [];
  ids.forEach(i => {
    const [y, mo] = U.months[i].split('-').map(Number);
    const nDays = new Date(y, mo, 0).getDate();
    for (let d = 1; d <= nDays; d++) {
      out.push({ y, m: mo, d, n: U.nd[i][d - 1] || 0, pj: U.ndpj[i][d - 1] || 0, dt: new Date(y, mo - 1, d) });
    }
  });
  return out;
}
function semanasTransfer(days) {
  const weeks = [];
  let cur = null;
  days.forEach(day => {
    const key = isoWeekKey(day.y, day.m, day.d);
    if (!cur || cur.key !== key) {
      cur = { key, start: day, end: day, n: 0, pj: 0 };
      weeks.push(cur);
    }
    cur.n += day.n;
    cur.pj += day.pj;
    cur.end = day;
  });
  return weeks;
}
function volumenLegend() {
  const el = $('#u-mes-leg');
  if (el) el.innerHTML = '<div><span class="sw" style="background:var(--s1)"></span>Nuevo dueño persona</div><div><span class="sw" style="background:var(--s2)"></span>Nuevo dueño empresa</div>';
}
function renderVolumen(ids) {
  const g = (st.uGran || (ids.length === 1 ? 'w' : 'm'));
  document.querySelectorAll('#u-gran button').forEach(b => b.setAttribute('aria-pressed', b.dataset.g === g ? 'true' : 'false'));
  const titulo = $('#u-vol-h');
  if (titulo) titulo.textContent = g === 'd' ? 'Transferencias por día' : g === 'w' ? 'Transferencias por semana' : 'Transferencias por mes';
  const serie = (n, pj) => [{ color: 'var(--s1)', v: n.map((x, i) => Math.max(0, x - pj[i])) }, { color: 'var(--s2)', v: pj }];
  if (g === 'm' || !U.nd) {
    chart($('#u-mes'), {
      cats: ids, series: serie(ids.map(i => U.n[i]), ids.map(i => U.pj[i])), h: 180, label: 'Transferencias por mes',
      tip: k => `${mLabel(U.months[ids[k]])}: ${f0(U.n[ids[k]])} transferencias, ${f0(U.pj[ids[k]])} con nuevo dueño empresa`,
      tick: k => ids.length <= 14 ? mShort(U.months[ids[k]]) : U.months[ids[k]].endsWith('-01') ? U.months[ids[k]].slice(0, 4) : '',
    });
    volumenLegend();
    return;
  }
  const days = diasTransfer(ids);
  if (g === 'd') {
    chart($('#u-mes'), {
      cats: days, series: serie(days.map(x => x.n), days.map(x => x.pj)), h: 180, label: 'Transferencias por día',
      alpha: k => { const w = days[k].dt.getDay(); return w === 0 || w === 6 ? 0.4 : 1; },
      tip: k => `${DOW[days[k].dt.getDay()]} ${days[k].d} de ${MESES[days[k].m - 1]} de ${days[k].y}: ${f0(days[k].n)} transferencias, ${f0(days[k].pj)} con nuevo dueño empresa`,
      tick: k => days.length <= 45 ? ((days[k].d === 1 || days[k].d % 5 === 0) ? String(days[k].d) : '') : (days[k].d === 1 ? MC[days[k].m - 1] + ' ' + String(days[k].y).slice(2) : ''),
    });
    volumenLegend();
    return;
  }
  const weeks = semanasTransfer(days);
  chart($('#u-mes'), {
    cats: weeks, series: serie(weeks.map(x => x.n), weeks.map(x => x.pj)), h: 180, label: 'Transferencias por semana',
    tip: k => `Semana del ${rangoDias(weeks[k].start, weeks[k].end)}: ${f0(weeks[k].n)} transferencias, ${f0(weeks[k].pj)} con nuevo dueño empresa`,
    tick: k => {
      if (weeks.length <= 18) return weeks[k].start.d + ' ' + MC[weeks[k].start.m - 1];
      const prev = weeks[k - 1];
      if (!prev || weeks[k].start.y !== prev.start.y) return String(weeks[k].start.y);
      if (weeks.length <= 80 && weeks[k].start.m !== prev.start.m) return MC[weeks[k].start.m - 1];
      return '';
    },
  });
  volumenLegend();
}
document.querySelectorAll('#u-gran button').forEach(b => { b.onclick = () => { st.uGran = b.dataset.g; renderUsados(); }; });
function renderUsados() {
  const box = $('#u-stats');
  if (!box) return;
  if (!U) {
    box.innerHTML = '<div class="stat"><div class="k">Cargando transferencias…</div></div>';
    return;
  }
  const ids = transferIds();
  if (!ids.length) {
    box.innerHTML = '<div class="stat"><div class="k">No hay transferencias en el período elegido.</div></div>';
    ['#u-mes', '#u-mes-leg', '#u-marcas', '#u-modelos', '#u-dueno', '#u-flujo', '#u-empresa', '#u-desde', '#u-hacia', '#u-anio', '#u-anio-leg', '#u-det'].forEach(s => { const n = $(s); if (n) n.innerHTML = ''; });
    return;
  }
  let n = 0, pj = 0, to = 0, fr = 0;
  ids.forEach(i => { n += U.n[i]; pj += U.pj[i]; to += U.to[i]; fr += U.fr[i]; });
  const stats = [[f0(n), 'Vehículos transferidos'], [pc(pj / n), 'Nuevo dueño empresa'], [pc(fr / n), 'Desde comerciante habitual'], [pc(to / n), 'Hacia comerciante habitual']];
  box.innerHTML = stats.map(x => `<div class="stat"><div class="v num">${x[0]}</div><div class="k">${x[1]}</div></div>`).join('');
  const perTxt = ids.length === 1 ? mLabel(U.months[ids[0]]) : `${mShort(U.months[ids[0]])} a ${mShort(U.months[ids[ids.length - 1]])}`;
  renderVolumen(ids);
  const brands = U.brands.map((_, b) => [b, sumAt(U.bs[b], ids)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  bars($('#u-marcas'), brands.slice(0, 12).map(([b, v]) => ({
    label: tc(U.brands[b]), v, tip: `${tc(U.brands[b])}: ${f0(v)} (${pc(v / n)})`,
    click: () => { const i = G.marcaM.get(U.brands[b]); if (i !== undefined) { st.brand = st.brand === i ? -1 : i; $('#f-brand').value = st.brand; update(); } },
    on: G.marcaM.get(U.brands[b]) === st.brand,
  })));
  const fams = U.fams.map((_, f) => [f, sumAt(U.fs[f], ids), sumAt(U.fpj[f], ids), sumAt(U.fto[f], ids), sumAt(U.ffr[f], ids)]).filter(x => x[1] > 0);
  fams.sort((a, b) => b[1] - a[1]);
  const famBar = (rows, key) => rows.slice(0, 8).map(x => ({ label: uFamLabel(x[0]), v: x[key], tip: `${uFamLabel(x[0])}: ${f0(x[key])}`, click: () => pickUsado(x[0]), on: uPick === x[0] }));
  bars($('#u-modelos'), famBar(fams, 1));
  flujoHTML($('#u-dueno'), [
    { label: 'Nuevo dueño persona', v: n - pj, color: 'var(--s1)' },
    { label: 'Nuevo dueño empresa', v: pj, color: 'var(--s2)' },
  ]);
  flujoHTML($('#u-flujo'), [
    { label: 'Transferencia común', v: Math.max(0, n - to - fr), color: 'var(--s1)' },
    { label: 'Desde comerciante habitual', v: fr, color: 'var(--s3)' },
    { label: 'Hacia comerciante habitual', v: to, color: 'var(--s2)' },
  ]);
  const porEmpresa = fams.filter(x => x[2] > 0).sort((a, b) => b[2] - a[2]);
  const porDesde = fams.filter(x => x[4] > 0).sort((a, b) => b[4] - a[4]);
  const porHacia = fams.filter(x => x[3] > 0).sort((a, b) => b[3] - a[3]);
  bars($('#u-empresa'), famBar(porEmpresa, 2));
  bars($('#u-desde'), famBar(porDesde, 4));
  bars($('#u-hacia'), famBar(porHacia, 3));
  const corte = U.years.findIndex(y => y >= 2018);
  const antes = new Float64Array(U.years.length), despues = new Float64Array(U.years.length);
  ids.forEach(i => U.iy[i].forEach((v, y) => { (corte < 0 || y < corte ? antes : despues)[y] += v; }));
  chart($('#u-anio'), {
    cats: U.years, series: [{ color: 'var(--s2)', v: Array.from(antes) }, { color: 'var(--s1)', v: Array.from(despues) }],
    h: 180, label: 'Año de la inscripción inicial de los autos transferidos en ' + perTxt,
    tip: k => `${U.years[k]}: ${f0(antes[k] + despues[k])} autos transferidos en el período se habían patentado ese año`,
    tick: k => U.years[k] % 5 === 0 ? String(U.years[k]) : '',
  });
  $('#u-anio-leg').innerHTML = '<div><span class="sw" style="background:var(--s2)"></span>Patentados antes de 2018</div><div><span class="sw" style="background:var(--s1)"></span>Patentados desde 2018</div>';
  if (uPick < 0 || !U.fs[uPick]) { $('#u-det').innerHTML = ''; return; }
  const un = sumAt(U.fs[uPick], ids), upj = sumAt(U.fpj[uPick], ids), uto = sumAt(U.fto[uPick], ids), ufr = sumAt(U.ffr[uPick], ids);
  const lab = uFamLabel(uPick);
  const ya = U.fy[uPick].map((v, k) => v > 0 ? [U.years[k], v] : null).filter(Boolean);
  const y0 = ya.length ? ya[0][0] : null, y1 = ya.length ? ya[ya.length - 1][0] : null;
  $('#u-det').innerHTML = `<h3 style="margin-top:16px">${esc(lab)}</h3>
    <div class="kv"><span><b>${f0(un)}</b> transferencias en el período</span><span>nuevo dueño empresa <b>${un ? pc(upj / un) : '–'}</b></span><span>hacia comerciante <b>${un ? pc(uto / un) : '–'}</b></span><span>desde comerciante <b>${un ? pc(ufr / un) : '–'}</b></span>${y0 ? `<span>inscripción vista <b>${y0}${y0 === y1 ? '' : ' a ' + y1}</b>, en todas las transferencias cargadas</span>` : ''}</div>
    <div id="u-det-anio" style="margin-top:10px"></div>`;
  if (ya.length) {
    const porAnio = preYearMap(uPick);
    const valorAnio = k => {
      const y = U.years[k];
      if (porAnio && y < 2018) return porAnio.get(y) || 0;
      return U.fy[uPick][k] || 0;
    };
    const aa = U.years.map((y, k) => y < 2018 ? valorAnio(k) : 0);
    const dd = U.years.map((y, k) => y >= 2018 ? (U.fy[uPick][k] || 0) : 0);
    chart($('#u-det-anio'), {
      cats: U.years, series: [{ color: 'var(--s2)', v: aa }, { color: 'var(--s1)', v: dd }], h: 140,
      label: 'Año de patentamiento de los usados ' + lab,
      tip: k => `${U.years[k]}: ${f0(valorAnio(k))}`,
      tick: k => U.years[k] % 5 === 0 ? String(U.years[k]) : '',
    });
  }
}

/* ---------- mapas ---------- */
function mapSel() {
  if (!st.followModel || st.ifam < 0 || !IX) return sel;
  const f = IX.fams[st.ifam], sb = G.marcaM.get(IX.brands[f[0]]);
  const sf = sb === undefined ? undefined : G.famM.get(sb + '|' + f[1]);
  if (sf === undefined) return [];
  return sel.map(({ M, idx }) => {
    const out = new Int32Array(idx.length); let c = 0;
    for (let k = 0; k < idx.length; k++) if (M.f[idx[k]] === sf) out[c++] = idx[k];
    return { M, idx: out.subarray(0, c) };
  });
}
function countsByMap(rawByKey) {
  const out = new Float64Array(MAPA.items.length);
  MAPA.items.forEach((it, i) => { out[i] = rawByKey.get(it.k) || 0; });
  return out;
}
function inscriptionCounts() {
  const raw = tally(mapSel(), 'p', G.prov.length), by = new Map();
  for (let i = 0; i < raw.length; i++) {
    if (!(raw[i] > 0)) continue;
    const k = provKey(G.prov[i]);
    by.set(k, (by.get(k) || 0) + raw[i]);
  }
  return countsByMap(by);
}
function usadoDeLaSeleccion() {
  if (!U || !st.followModel) return -1;
  if (st.ifam >= 0) {
    const f = IX.fams[st.ifam];
    const i = U.famM.get(IX.brands[f[0]] + '|' + f[1]);
    if (i !== undefined) return i;
  }
  if (st.upre >= 0) return st.upre;
  if (uPick >= 0) return uPick;
  return -1;
}
function transferCounts() {
  const by = new Map();
  const ui = usadoDeLaSeleccion();
  if (ui >= 0 && U.fp && U.pk) {
    (U.fp[ui] || []).forEach(pair => {
      const k = U.pk[pair[0]];
      by.set(k, (by.get(k) || 0) + pair[1]);
    });
    return { counts: countsByMap(by), modelo: true };
  }
  const ids = transferIds();
  if (U.ps && U.pk) U.pk.forEach((k, p) => { const v = sumAt(U.ps[p], ids); if (v) by.set(k, v); });
  return { counts: countsByMap(by), modelo: false };
}
function paintMap(el, barEl, capEl, counts, label) {
  if (!el) return;
  const onKey = st.prov >= 0 ? provKey(G.prov[st.prov]) : '';
  if (!MAPA) {
    el.innerHTML = '<p class="note">El mapa no está cargado.</p>';
    if (barEl) barEl.innerHTML = '';
    if (capEl) capEl.textContent = '';
    return;
  }
  let max = 0, total = 0, best = '';
  counts.forEach((v, i) => { total += v; if (v > max) { max = v; best = MAPA.items[i].n; } });
  el.innerHTML = `<svg viewBox="0 0 ${MAPA.w} ${MAPA.h}" role="img" aria-label="${esc(label)}">` + MAPA.items.map((it, i) => {
    const v = counts[i] || 0;
    const t = max ? Math.sqrt(v / max) : 0;
    const op = v ? (0.16 + 0.84 * t).toFixed(3) : '0.08';
    return `<path d="${it.d}" fill-opacity="${op}"${onKey === it.k ? ' class="on"' : ''} data-k="${it.k}" tabindex="0" role="button" aria-label="${esc(it.n)}" data-tip="${esc(it.n + ': ' + f0(v) + (total ? ' (' + pc(v / total) + ')' : ''))}"/>`;
  }).join('') + '</svg>';
  el.querySelectorAll('path').forEach(p => {
    const go = () => provPick(p.dataset.k);
    p.onclick = go;
    p.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });
  if (barEl) {
    const items = MAPA.items.map((it, i) => ({ it, v: counts[i] || 0 })).filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 8);
    bars(barEl, items.map(x => ({
      label: x.it.n, v: x.v, tip: `${x.it.n}: ${f0(x.v)} (${total ? pc(x.v / total) : '–'})`,
      click: () => provPick(x.it.k), on: onKey === x.it.k,
    })));
  }
  if (capEl) capEl.textContent = total ? `Donde más: ${best}, ${f0(max)}.` : 'No hay datos con la selección actual.';
}
function renderMapa() {
  const el = $('#mapa');
  if (!el || !st.months.length) return;
  const counts = MAPA ? inscriptionCounts() : null;
  const quien = st.followModel && st.ifam >= 0 ? famLabelFromIndex(st.ifam) : '';
  paintMap(el, $('#mapa-bars'), $('#mapa-cap'), counts || [], quien ? 'Dónde se patenta ' + quien : 'Dónde se patentan los vehículos de la selección');
  const cap = $('#mapa-cap');
  if (cap && quien && cap.textContent && !cap.textContent.startsWith('No hay')) cap.textContent = quien + '. ' + cap.textContent;
}
function famLabelFromIndex(i) {
  const f = IX.fams[i];
  return tc(IX.brands[f[0]]) + ' ' + tc(f[1]);
}
function renderMapaUsados() {
  const el = $('#u-mapa'), note = $('#u-mapa-note');
  if (!el) return;
  if (!U || !MAPA || !U.pk) {
    if (U && !U.pk) {
      el.innerHTML = '';
      if (note) note.textContent = 'El mapa de transferencias aparece cuando se vuelve a armar el archivo de usados.';
    }
    return;
  }
  const pack = transferCounts();
  const ui = usadoDeLaSeleccion();
  const quien = ui >= 0 ? uFamLabel(ui) : '';
  paintMap(el, $('#u-mapa-bars'), $('#u-mapa-cap'), pack.counts, quien ? 'Dónde se transfiere ' + quien : 'Dónde se transfieren los vehículos del período');
  const cap = $('#u-mapa-cap');
  if (cap && quien && cap.textContent && !cap.textContent.startsWith('No hay')) cap.textContent = quien + '. ' + cap.textContent;
  if (note) {
    note.textContent = pack.modelo
      ? `Todas las transferencias cargadas de este modelo, de ${mLabel(U.months[0])} a ${mLabel(U.months[U.months.length - 1])}, no solo el período de arriba. Tocar una provincia filtra los patentamientos.`
      : 'Transferencias del período elegido. Si elegís un modelo, el mapa pasa a mostrar ese modelo en todas las transferencias cargadas. Tocar una provincia filtra los patentamientos.';
  }
}

/* ---------- bajas y robos ---------- */
let BAJ = null, ROB = null;
const AGE_LAB = ['0 a 1 año', '2 a 3 años', '4 a 6', '7 a 10', '11 a 15', '16 o más'];
const EV_COL = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--ink)'];
function prepEvento(d) {
  d.pos = new Map(d.months.map((m, i) => [m, i]));
  return d;
}
async function loadEvento(file) {
  try { return prepEvento(await getMonthJSON(file)); }
  catch (e) { console.error(e); return null; }
}
function eventIds(D) {
  if (!D || !st.months.length) return [];
  const ids = [];
  for (const m of st.months) { const i = D.pos.get(m); if (i !== undefined) ids.push(i); }
  return ids;
}
function renderEvento(D, p, opts) {
  const box = $('#' + p + '-stats');
  if (!box) return;
  if (!D) { box.innerHTML = '<div class="stat"><div class="k">Todavía no están cargados estos datos.</div></div>'; return; }
  const ids = eventIds(D);
  if (!ids.length) { box.innerHTML = '<div class="stat"><div class="k">No hay datos en el período.</div></div>'; return; }
  const sum = arr => ids.reduce((s, i) => s + (arr[i] || 0), 0);
  const n = sum(D.n), co = sum(D.co), ok = sum(D.cook), parcial = sum(D.parcial), early = sum(D.early);
  const stats = [[f0(n), 'Vehículos'], [f0(co), 'Con cotitulares'], [co ? pc(ok / co) : '–', 'De esos, las partes suman 100'], [f0(parcial), 'Una sola parte, menor al 100%']];
  if (opts.early) stats.push([n ? pc(early / n) : '–', 'Antes de los 2 años']);
  if (opts.net) {
    const den = sum(D.sub[0]) + sum(D.sub[1]), rec = sum(D.sub[2]);
    stats.push([f0(den - rec), 'Denuncias menos recuperos']);
  }
  box.innerHTML = stats.map(x => `<div class="stat"><div class="v num">${x[0]}</div><div class="k">${x[1]}</div></div>`).join('');
  renderEventoVolumen(D, p, ids);
  const famN = D.fams.map((_, f) => ids.reduce((s, i) => s + (D.fs[f][i] || 0), 0));
  const brands = D.brands.map((_, b) => [b, ids.reduce((s, i) => s + (D.bs[b][i] || 0), 0)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  bars($('#' + p + '-marcas'), brands.slice(0, 12).map(([b, v]) => ({ label: tc(D.brands[b]), v, tip: `${tc(D.brands[b])}: ${f0(v)}` })));
  const abrir = f => {
    const brand = D.brands[D.fams[f][0]], name = D.fams[f][1], k = IX.famKey.get(brand + '|' + name);
    $('#q').value = tc(brand) + ' ' + tc(name);
    suggest($('#q').value);
    if (k !== undefined) { st.followModel = true; showFam(k); $('#buscador').scrollIntoView({ behavior: 'smooth' }); }
  };
  const fams = famN.map((v, f) => [f, v]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  bars($('#' + p + '-modelos'), fams.slice(0, 12).map(([f, v]) => {
    const brand = D.brands[D.fams[f][0]], name = D.fams[f][1];
    return { label: tc(brand) + ' ' + tc(name), v, tip: `${tc(brand)} ${tc(name)}: ${f0(v)}`, click: () => abrir(f) };
  }));
  bars($('#' + p + '-edad'), AGE_LAB.map((lb, i) => ({ label: lb, v: sum(D.age[i]) })).filter(x => x.v > 0));
  if (opts.early) {
    const rank = famN.map((v, f) => [f, v, ids.reduce((s, i) => s + (D.fe[f][i] || 0), 0)]).filter(x => x[1] >= 30).sort((a, b) => b[2] / b[1] - a[2] / a[1]).slice(0, 8);
    bars($('#' + p + '-temprana'), rank.map(([f, v, e]) => {
      const brand = D.brands[D.fams[f][0]], name = D.fams[f][1];
      return { label: tc(brand) + ' ' + tc(name), v: 100 * e / v, tip: `${tc(brand)} ${tc(name)}: ${pc(e / v)} (${f0(e)} de ${f0(v)})`, click: () => abrir(f) };
    }));
  }
  if (opts.net) {
    const rank = famN.map((v, f) => {
      const den = ids.reduce((s, i) => s + (D.sk[0][f][i] || 0) + (D.sk[1][f][i] || 0), 0);
      const rec = ids.reduce((s, i) => s + (D.sk[2][f][i] || 0), 0);
      return [f, den, rec];
    }).filter(x => x[1] >= 30).sort((a, b) => b[2] / b[1] - a[2] / a[1]).slice(0, 8);
    bars($('#' + p + '-ratio'), rank.map(([f, den, rec]) => {
      const brand = D.brands[D.fams[f][0]], name = D.fams[f][1];
      return { label: tc(brand) + ' ' + tc(name), v: 100 * rec / den, tip: `${tc(brand)} ${tc(name)}: ${f0(rec)} recuperos cada ${f0(den)} denuncias`, click: () => abrir(f) };
    }));
  }
  const by = new Map();
  if (D.ps && D.pk) D.pk.forEach((k, pi) => { const v = ids.reduce((s, i) => s + (D.ps[pi][i] || 0), 0); if (v) by.set(k, v); });
  paintMap($('#' + p + '-mapa'), $('#' + p + '-mapa-bars'), $('#' + p + '-mapa-cap'), countsByMap(by), opts.map);
  const note = $('#' + p + '-note');
  if (note) note.textContent = opts.note;
}
function renderBajas() {
  renderEvento(BAJ, 'b', {
    early: true, chart: 'Bajas por mes', map: 'Dónde se dan de baja',
    note: 'Cada vehículo cuenta una vez. Si el mismo día, registro, modelo y año aparecen en varias filas, son cotitulares, y se muestra si esas partes suman 100. Una baja no se puede unir a un robo ni a una transferencia: no hay dominio.',
  });
}
function renderRobos() {
  renderEvento(ROB, 'r', {
    net: true, chart: 'Robos y recuperos por mes', map: 'Dónde se denuncian',
    note: 'Robo o hurto y retención indebida van aparte. Un recupero no se puede atribuir a la misma denuncia: no hay dominio. El saldo es denuncias menos recuperos del período, no una tasa de autos sin recuperar.',
  });
}
function eventoLeyenda(D, p) {
  const el = $('#' + p + '-mes-leg');
  if (el) el.innerHTML = D.labels.map((lb, s) => `<div><span class="sw" style="background:${EV_COL[s % EV_COL.length]}"></span>${esc(lb)}</div>`).join('');
}
function diasEvento(D, ids) {
  const out = [];
  ids.forEach(i => {
    const [y, mo] = D.months[i].split('-').map(Number);
    const nDays = new Date(y, mo, 0).getDate();
    for (let d = 1; d <= nDays; d++) {
      const sub = D.labels.map((_, s) => (D.sd[s][i] && D.sd[s][i][d - 1]) || 0);
      out.push({ y, m: mo, d, n: sub.reduce((s, x) => s + x, 0), sub, dt: new Date(y, mo - 1, d) });
    }
  });
  return out;
}
function semanasEvento(days) {
  const weeks = [];
  let cur = null;
  days.forEach(day => {
    const key = isoWeekKey(day.y, day.m, day.d);
    if (!cur || cur.key !== key) {
      cur = { key, start: day, end: day, n: 0, sub: day.sub.map(() => 0) };
      weeks.push(cur);
    }
    cur.n += day.n;
    cur.sub = cur.sub.map((v, s) => v + day.sub[s]);
    cur.end = day;
  });
  return weeks;
}
function renderEventoVolumen(D, p, ids) {
  const key = p === 'b' ? 'bGran' : 'rGran';
  const g = st[key] || (ids.length === 1 ? 'w' : 'm');
  document.querySelectorAll('#' + p + '-gran button').forEach(b => b.setAttribute('aria-pressed', b.dataset.g === g ? 'true' : 'false'));
  const titulo = $('#' + p + '-vol-h');
  const noun = p === 'b' ? 'Bajas' : 'Robos y recuperos';
  if (titulo) titulo.textContent = g === 'd' ? noun + ' por día' : g === 'w' ? noun + ' por semana' : noun + ' por mes';
  const serie = rows => D.labels.map((_, s) => ({ color: EV_COL[s % EV_COL.length], v: rows.map(row => row[s] || 0) }));
  const partes = vals => D.labels.map((lb, s) => lb + ' ' + f0(vals[s] || 0)).join(', ');
  if (g === 'm' || !D.sd) {
    chart($('#' + p + '-mes'), {
      cats: ids, series: serie(ids.map(i => D.labels.map((_, s) => D.sub[s][i] || 0))), h: 180, label: noun + ' por mes',
      tip: k => `${mLabel(D.months[ids[k]])}: ${f0(D.n[ids[k]])} · ` + partes(D.labels.map((_, s) => D.sub[s][ids[k]] || 0)),
      tick: k => {
        const m = D.months[ids[k]], len = ids.length;
        if (len <= 14) return mShort(m);
        if (len <= 40) return m.endsWith('-01') || m.endsWith('-07') ? mShort(m) : '';
        return m.endsWith('-01') ? m.slice(0, 4) : '';
      },
    });
    eventoLeyenda(D, p);
    return;
  }
  const days = diasEvento(D, ids);
  if (g === 'd') {
    chart($('#' + p + '-mes'), {
      cats: days, series: serie(days.map(x => x.sub)), h: 180, label: noun + ' por día',
      alpha: k => { const w = days[k].dt.getDay(); return w === 0 || w === 6 ? 0.4 : 1; },
      tip: k => `${DOW[days[k].dt.getDay()]} ${days[k].d} de ${MESES[days[k].m - 1]} de ${days[k].y}: ${f0(days[k].n)} · ` + partes(days[k].sub),
      tick: k => days.length <= 45 ? ((days[k].d === 1 || days[k].d % 5 === 0) ? String(days[k].d) : '') : (days[k].d === 1 ? MC[days[k].m - 1] + ' ' + String(days[k].y).slice(2) : ''),
    });
    eventoLeyenda(D, p);
    return;
  }
  const weeks = semanasEvento(days);
  chart($('#' + p + '-mes'), {
    cats: weeks, series: serie(weeks.map(x => x.sub)), h: 180, label: noun + ' por semana',
    tip: k => `Semana del ${rangoDias(weeks[k].start, weeks[k].end)}: ${f0(weeks[k].n)} · ` + partes(weeks[k].sub),
    tick: k => {
      if (weeks.length <= 18) return weeks[k].start.d + ' ' + MC[weeks[k].start.m - 1];
      const prev = weeks[k - 1];
      if (!prev || weeks[k].start.y !== prev.start.y) return String(weeks[k].start.y);
      if (weeks.length <= 80 && weeks[k].start.m !== prev.start.m) return MC[weeks[k].start.m - 1];
      return '';
    },
  });
  eventoLeyenda(D, p);
}
['b', 'r'].forEach(p => {
  document.querySelectorAll('#' + p + '-gran button').forEach(b => {
    b.onclick = () => { st[p === 'b' ? 'bGran' : 'rGran'] = b.dataset.g; p === 'b' ? renderBajas() : renderRobos(); };
  });
});

/* ---------- ciclo principal ---------- */
function update() {
  sel = buildSel(st.months, true);
  renderHint(); renderStats(); renderTiempo(); renderOrigen(); renderListas(); renderRaros(); renderExoticos(); renderClasicos(); renderElectricos();
  renderEvo(); renderUsados(); renderBajas(); renderRobos(); renderMapa(); renderMapaUsados();
}
let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (IX && st.months.length) { renderTiempo(); renderEvo(); renderExoticos(); renderUsados(); renderBajas(); renderRobos(); if (st.ifam >= 0) showFam(st.ifam); } }, 150); });

/* ---------- arranque ---------- */
async function init() {
  try {
    const [ix, cfg, mapa] = await Promise.all([
      fetch('data/index.json').then(r => { if (!r.ok) throw new Error('index ' + r.status); return r.json(); }),
      fetch('data/exoticos.json').then(r => r.ok ? r.json() : { grupos: [], serie: [] }).catch(() => ({ grupos: [], serie: [] })),
      fetch('data/mapa.json').then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    IX = ix; CFG = cfg; MAPA = mapa;
  } catch (e) {
    $('#cobertura').textContent = 'Todavía no hay datos cargados. Corré tools/build.py con los CSV (ver README).';
    console.error(e); return;
  }
  CFG.grupos.forEach(g => { g.mod = (g.modelos || []).map(m => ({ marca: m.marca, re: new RegExp(m.patron, 'i') })); });
  IX.months.forEach((x, i) => { x.i = i; });
  IX.pos = new Map(IX.months.map((x, i) => [x.m, i]));
  IX.avail = IX.months.filter(x => x.file);
  IX.famKey = new Map(IX.fams.map((f, i) => [IX.brands[f[0]] + '|' + f[1], i]));
  IX.famSearch = IX.fams.map(f => norm(IX.brands[f[0]] + ' ' + f[1]));
  IX.ftot = IX.fs.map(a => a.reduce((s, x) => s + x, 0));
  const a = IX.avail[0].m, z = IX.avail[IX.avail.length - 1].m;
  $('#cobertura').textContent = `Datos cargados: desde ${IX.avail.length === 1 ? mLabel(a) : `${mLabel(a)} a ${mLabel(z)}`} (${IX.avail.length} meses). Fuente: DNRPA, datos abiertos`;
  buildPeriodSelect();
  const h = location.hash.slice(1);
  const start = /^\d{4}-\d{2}$/.test(h) && IX.pos.has(h) && IX.months[IX.pos.get(h)].file ? 'm:' + h : 'm:' + z;
  suggest('');
  const pendientes = Promise.all([
    loadUsados(),
    loadEvento('bajas.json.gz').then(d => { BAJ = d; }),
    loadEvento('robos.json.gz').then(d => { ROB = d; }),
  ]);
  await setPeriod(start);
  showFam(0);
  await pendientes;
  renderBajas();
  renderRobos();
}
init();
})();
