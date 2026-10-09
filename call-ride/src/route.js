// Cestno omrežje med postajami in pot vožnje.
// Pot vožnje je najkrajša pot po omrežju od začetka prek izrecnih vmesnih točk do cilja. Na poti so
// postaje, ki ležijo na tej poti, in mesta, ki so od nje oddaljena največ ON_ROUTE_KM. Letališča
// in turistični kraji (vrsta airport/resort) so lahko le začetek, cilj ali izrecna vmesna točka.
import { PLACE_COORDS, PLACE_KIND, PLACE_SET, MAIN_PLACES } from './places.js';

// Povezave po glavnih cestah (zaporedne postaje v vsaki verigi so povezane). Število na začetku verige
// je faktor počasnejše regionalne ceste (pri izbiri poti je povezava toliko »daljša«).
const CHAINS = [
  // Italija: A4 Torino – Milano – Benetke – Trst
  ['Torino', 'Novara', 'Milano — Centrale', 'Bergamo — letališče Orio al Serio (BGY)', 'Brescia', 'Peschiera del Garda', 'Verona — Porta Nuova',
    'Vicenza', 'Padova', 'Mestre — železniška postaja', 'Benetke — letališče Marco Polo (VCE)', 'Palmanova', 'Trst — letališče Ronchi (TRS)',
    'Tržič (Monfalcone)', 'Trst — avtobusna postaja', 'Sežana'],
  ['Milano — Centrale', 'Piacenza', 'Parma', 'Reggio Emilia', 'Modena', 'Bologna', 'Imola', 'Faenza', 'Forlì', 'Cesena', 'Rimini'],
  ['Brescia', 'Piacenza'],
  ['Padova', 'Rovigo', 'Ferrara', 'Bologna', 'Firence (Firenze)'],
  ['Verona — Porta Nuova', 'Modena'],
  ['Verona — Porta Nuova', 'Trento', 'Bocen (Bolzano)', 'Innsbruck', 'Rosenheim', 'München — glavna postaja'],
  ['Mestre — železniška postaja', 'Treviso', 'Pordenone', 'Videm (Udine)', 'Palmanova'],
  ['Treviso', 'Belluno'],
  ['Videm (Udine)', 'Gorica (Gorizia)', 'Tržič (Monfalcone)'],
  ['Videm (Udine)', 'Beljak (Villach)'],
  // Slovenija
  ['Sežana', 'Divača', 'Postojna — avtobusna postaja', 'Logatec', 'Vrhnika', 'Ljubljana — avtobusna postaja', 'Domžale', 'Celje', 'Maribor — avtobusna postaja'],
  ['Trst — avtobusna postaja', 'Koper — avtobusna postaja', 'Divača'],
  ['Postojna — avtobusna postaja', 'Ajdovščina', 'Nova Gorica', 'Gorica (Gorizia)'],
  [1.4, 'Nova Gorica', 'Tolmin', 'Idrija', 'Logatec'],
  ['Postojna — avtobusna postaja', 'Ilirska Bistrica', 'Reka (Rijeka)'],
  ['Ljubljana — avtobusna postaja', 'Kranj', 'Radovljica', 'Jesenice', 'Beljak (Villach)'],
  [1.3, 'Ljubljana — avtobusna postaja', 'Škofja Loka', 'Kranj'],
  ['Domžale', 'Kamnik'],
  [1.5, 'Ljubljana — avtobusna postaja', 'Trbovlje', 'Celje'],
  ['Ljubljana — avtobusna postaja', 'Grosuplje', 'Trebnje', 'Novo mesto', 'Krško', 'Brežice', 'Zagreb — avtobusni kolodvor'],
  ['Grosuplje', 'Kočevje'],
  [1.3, 'Celje', 'Velenje', 'Slovenj Gradec', 'Celovec (Klagenfurt)'],
  ['Maribor — avtobusna postaja', 'Ptuj', 'Ormož'],
  ['Ptuj', 'Varaždin', 'Zagreb — avtobusni kolodvor'],
  ['Maribor — avtobusna postaja', 'Murska Sobota', 'Lendava', 'Nagykanizsa', 'Budimpešta (Budapest)'],
  ['Varaždin', 'Čakovec', 'Nagykanizsa'],
  ['Čakovec', 'Lendava'],
  // Avstrija, Nemčija, Slovaška
  ['Maribor — avtobusna postaja', 'Gradec — letališče (GRZ)', 'Gradec (Graz)', 'Dunaj (Wien)', 'Dunaj — letališče (VIE)', 'Bratislava', 'Budimpešta (Budapest)'],
  ['Beljak (Villach)', 'Celovec (Klagenfurt)', 'Gradec (Graz)'],
  ['Beljak (Villach)', 'Salzburg', 'Rosenheim'],
  ['Salzburg', 'Linz', 'Dunaj (Wien)'],
  // Hrvaška, Srbija
  ['Zagreb — avtobusni kolodvor', 'Karlovac', 'Reka (Rijeka)'],
  ['Karlovac', 'Zadar', 'Šibenik', 'Split'],
  ['Koper — avtobusna postaja', 'Pulj (Pula)', 'Reka (Rijeka)'],
  ['Zagreb — avtobusni kolodvor', 'Osijek', 'Beograd'],
];

// Letališča in turistični kraji: povezave do najbližjih postaj (pot skoznje ne vodi).
const SPURS = {
  'Ljubljana — letališče Brnik (LJU)': ['Kranj', 'Ljubljana — avtobusna postaja', 'Kamnik'],
  'Maribor — letališče (MBX)': ['Maribor — avtobusna postaja', 'Ptuj'],
  Bled: ['Radovljica'],
  Bohinj: ['Radovljica'],
  'Kranjska Gora': ['Jesenice'],
  Bovec: ['Tolmin'],
  Kobarid: ['Tolmin'],
  Izola: ['Koper — avtobusna postaja'],
  Piran: ['Koper — avtobusna postaja'],
  Portorož: ['Koper — avtobusna postaja'],
  'Rogaška Slatina': ['Celje'],
  'Gradež (Grado)': ['Tržič (Monfalcone)', 'Palmanova'],
  'Lignano Sabbiadoro': ['Palmanova'],
  Bibione: ['Palmanova'],
  Caorle: ['Benetke — letališče Marco Polo (VCE)'],
  Jesolo: ['Benetke — letališče Marco Polo (VCE)'],
  'Treviso — letališče (TSF)': ['Treviso', 'Mestre — železniška postaja'],
  'Cortina d’Ampezzo': ['Belluno'],
  'Benetke — Piazzale Roma': ['Mestre — železniška postaja'],
  'Verona — letališče (VRN)': ['Verona — Porta Nuova'],
  Bergamo: ['Bergamo — letališče Orio al Serio (BGY)'],
  'Milano — letališče Linate (LIN)': ['Milano — Centrale'],
  'Milano — letališče Malpensa (MXP)': ['Milano — Centrale', 'Novara'],
  Como: ['Milano — Centrale'],
  'Torino — letališče (TRN)': ['Torino'],
  'Bologna — letališče (BLQ)': ['Bologna'],
  'Zagreb — letališče (ZAG)': ['Zagreb — avtobusni kolodvor', 'Karlovac'],
  'Reka — letališče Krk (RJK)': ['Reka (Rijeka)'],
  Opatija: ['Reka (Rijeka)'],
  Crikvenica: ['Reka (Rijeka)'],
  Umag: ['Koper — avtobusna postaja'],
  Novigrad: ['Koper — avtobusna postaja'],
  Poreč: ['Koper — avtobusna postaja', 'Pulj (Pula)'],
  Rovinj: ['Pulj (Pula)'],
  'Pulj — letališče (PUY)': ['Pulj (Pula)'],
  'Plitvička jezera': ['Karlovac', 'Zadar'],
  'Zadar — letališče (ZAD)': ['Zadar'],
  'Split — letališče (SPU)': ['Split', 'Šibenik'],
  'Celovec — letališče (KLU)': ['Celovec (Klagenfurt)'],
  'Salzburg — letališče (SZG)': ['Salzburg'],
  'München — letališče (MUC)': ['München — glavna postaja'],
  'Memmingen — letališče (FMM)': ['München — glavna postaja'],
  'Budimpešta — letališče (BUD)': ['Budimpešta (Budapest)'],
  'Bratislava — letališče (BTS)': ['Bratislava'],
  'Beograd — letališče (BEG)': ['Beograd'],
};

const ON_ROUTE_KM = 4;

function haversineKm([lat1, lng1], [lat2, lng2]) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
export const distKm = (p, q) => haversineKm(PLACE_COORDS[p], PLACE_COORDS[q]);

const GRAPH = new Map([...PLACE_SET].map((p) => [p, new Map()]));
function link(a, b, factor = 1) {
  if (!GRAPH.has(a) || !GRAPH.has(b)) throw new Error(`Neznana postaja v omrežju: ${GRAPH.has(a) ? b : a}`);
  const km = distKm(a, b) * factor;
  GRAPH.get(a).set(b, km);
  GRAPH.get(b).set(a, km);
}
for (const row of CHAINS) {
  const [factor, chain] = typeof row[0] === 'number' ? [row[0], row.slice(1)] : [1, row];
  for (let i = 1; i < chain.length; i++) link(chain[i - 1], chain[i], factor);
}
for (const [spur, hubs] of Object.entries(SPURS)) hubs.forEach((h) => link(spur, h));

// Skozi letališča in turistične kraje pot ne vodi (so le začetek ali cilj odseka).
const passable = (p) => PLACE_KIND[p] === 'city' || PLACE_KIND[p] === 'stop';

// Najkrajša pot po omrežju (Dijkstra); null, če povezave ni.
function shortestPath(from, to) {
  if (from === to) return [from];
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const done = new Set();
  while (true) {
    let cur = null;
    for (const [p, d] of dist) if (!done.has(p) && (cur === null || d < dist.get(cur))) cur = p;
    if (cur === null) return null;
    if (cur === to) break;
    done.add(cur);
    if (cur !== from && !passable(cur)) continue;
    for (const [next, km] of GRAPH.get(cur)) {
      const d = dist.get(cur) + km;
      if (!dist.has(next) || d < dist.get(next)) { dist.set(next, d); prev.set(next, cur); }
    }
  }
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0]));
  return path;
}

// Razdalja točke od daljice A–B (km) in položaj projekcije na daljici (0..1), v lokalni ravnini.
export function segmentOffset(a, b, p) {
  const [la, lo] = PLACE_COORDS[a];
  const k = Math.cos((la * Math.PI) / 180);
  const xy = (q) => [(PLACE_COORDS[q][1] - lo) * 111.32 * k, (PLACE_COORDS[q][0] - la) * 110.57];
  const [bx, by] = xy(b);
  const [px, py] = xy(p);
  const len2 = bx * bx + by * by || 1;
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return { km: Math.hypot(px - t * bx, py - t * by), t };
}

// Vmesna točka je smiselna, če je bližje cilju kot začetek in bližje začetku kot cilj.
export function stopBetween(origin, destination, p) {
  const total = distKm(origin, destination);
  return distKm(origin, p) < total && distKm(p, destination) < total;
}

function orderStops(origin, destination, stops) {
  const t = (p) => distKm(origin, p) / (distKm(origin, p) + distKm(p, destination));
  return [...new Set(stops)].filter((p) => PLACE_SET.has(p) && p !== origin && p !== destination).sort((x, y) => t(x) - t(y));
}

const cache = new Map();
// Celotna pot vožnje: postaje po vrsti od začetka do cilja.
export function routePoints(origin, destination, stops = []) {
  const key = `${origin}|${destination}|${stops.join('|')}`;
  if (cache.has(key)) return cache.get(key);
  const fixed = [origin, ...orderStops(origin, destination, stops), destination];
  let path = [origin];
  for (let i = 1; i < fixed.length; i++) {
    const leg = shortestPath(fixed[i - 1], fixed[i]) || [fixed[i - 1], fixed[i]];
    path.push(...leg.slice(1));
  }
  path = path.filter((p, i) => path.indexOf(p) === i);
  // Mesta tik ob poti (npr. Bergamo ob letališču Orio al Serio).
  const out = [path[0]];
  const used = new Set(path);
  for (let i = 1; i < path.length; i++) {
    const near = [...MAIN_PLACES]
      .filter((p) => !used.has(p))
      .map((p) => ({ p, ...segmentOffset(path[i - 1], path[i], p) }))
      .filter((x) => x.km <= ON_ROUTE_KM && x.t > 0 && x.t < 1)
      .sort((x, y) => x.t - y.t);
    near.forEach((x) => used.add(x.p));
    out.push(...near.map((x) => x.p), path[i]);
  }
  if (cache.size > 2000) cache.clear();
  cache.set(key, out);
  return out;
}

// Postaje, ki jih prevoznik lahko doda kot ovinek: niso na poti, ovinek prek njih je največ 60 km.
export function detourOptions(route) {
  const on = new Set(route);
  const out = [];
  for (const p of PLACE_SET) {
    if (on.has(p)) continue;
    let best = null;
    for (let i = 1; i < route.length; i++) {
      const extra = distKm(route[i - 1], p) + distKm(p, route[i]) - distKm(route[i - 1], route[i]);
      if (best === null || extra < best.extra) best = { extra, i };
    }
    if (best && best.extra <= 60 && stopBetween(route[0], route[route.length - 1], p)) {
      out.push({ place: p, km: Math.max(1, Math.round(best.extra)), at: best.i });
    }
  }
  return out.sort((a, b) => a.at - b.at || a.km - b.km).map(({ place, km }) => ({ place, km }));
}

export function graphCheck() {
  const start = 'Ljubljana — avtobusna postaja';
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) for (const n of GRAPH.get(queue.shift()).keys()) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  return [...PLACE_SET].filter((p) => !seen.has(p));
}
