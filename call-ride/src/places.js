// Točke na koridorju Milano ↔ Benetke ↔ Trst ↔ Ljubljana, urejene v smeri zahod → vzhod.
// Ujemanje vožnje in iskanja temelji na teh imenih, zato naj ostanejo nespremenjena,
// ko so v bazi že vožnje (nove točke lahko dodajaš). Koordinate so za izračun prihoda in cene odseka.
//
// main: true  — kraj ob glavni poti; vožnja ga samodejno pokrije, če leži med začetkom in ciljem
//               (potnik jo najde, prevoznik prevzem potrdi ob potrditvi rezervacije).
// main: false — ovinek (letališča, mestna središča izven avtoceste); vožnja ga pokrije le,
//               če ga prevoznik izrecno doda kot vmesno točko.
const CORRIDOR = [
  ['Milano — letališče Malpensa (MXP)', 45.6301, 8.7231, false],
  ['Milano — Centrale', 45.4859, 9.2045, true],
  ['Milano — letališče Linate (LIN)', 45.4451, 9.2767, false],
  ['Bergamo — letališče Orio al Serio (BGY)', 45.6689, 9.7004, true],
  ['Brescia', 45.5323, 10.2127, true],
  ['Verona — Porta Nuova', 45.4290, 10.9824, true],
  ['Vicenza', 45.5410, 11.5404, true],
  ['Padova', 45.4177, 11.8807, true],
  ['Mestre — železniška postaja', 45.4826, 12.2320, true],
  ['Benetke — Piazzale Roma', 45.4380, 12.3186, false],
  ['Benetke — letališče Marco Polo (VCE)', 45.5053, 12.3519, true],
  ['Treviso — letališče (TSF)', 45.6484, 12.1944, false],
  ['Trst — letališče Ronchi (TRS)', 45.8275, 13.4722, true],
  ['Trst — avtobusna postaja', 45.6563, 13.7726, true],
  ['Koper — avtobusna postaja', 45.5469, 13.7295, true],
  ['Sežana', 45.7092, 13.8733, true],
  ['Divača', 45.6847, 13.9703, true],
  ['Postojna — avtobusna postaja', 45.7752, 14.2137, true],
  ['Logatec', 45.9145, 14.2259, true],
  ['Vrhnika', 45.9634, 14.2958, true],
  ['Ljubljana — avtobusna postaja', 46.0577, 14.5108, true],
  ['Ljubljana — letališče Brnik (LJU)', 46.2237, 14.4576, false],
];

export const PLACE_COORDS = Object.fromEntries(CORRIDOR.map(([name, lat, lng]) => [name, [lat, lng]]));
export const PLACES = CORRIDOR.map(([name]) => name);
export const PLACE_SET = new Set(PLACES);
export const MAIN_PLACES = new Set(CORRIDOR.filter((p) => p[3]).map(([name]) => name));
