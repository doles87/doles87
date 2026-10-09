// Točke na koridorju Benetke ↔ Ljubljana, urejene v smeri Benetke → Ljubljana.
// Ujemanje vožnje in iskanja temelji na teh imenih, zato naj ostanejo nespremenjena,
// ko so v bazi že vožnje (nove točke lahko dodajaš).
export const PLACES = [
  'Benetke — letališče Marco Polo (VCE)',
  'Benetke — Piazzale Roma',
  'Mestre — železniška postaja',
  'Treviso — letališče (TSF)',
  'Trst — letališče Ronchi (TRS)',
  'Trst — avtobusna postaja',
  'Sežana',
  'Divača',
  'Postojna — avtobusna postaja',
  'Logatec',
  'Vrhnika',
  'Ljubljana — avtobusna postaja',
  'Ljubljana — letališče Brnik (LJU)',
];

export const PLACE_SET = new Set(PLACES);
