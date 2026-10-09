// Točke na koridorju Benetke ↔ Ljubljana, urejene v smeri Benetke → Ljubljana.
// Ujemanje vožnje in iskanja temelji na teh imenih, zato naj ostanejo nespremenjena,
// ko so v bazi že vožnje (nove točke lahko dodajaš). Koordinate so za izračun prihoda.
export const PLACE_COORDS = {
  'Benetke — letališče Marco Polo (VCE)': [45.5053, 12.3519],
  'Benetke — Piazzale Roma': [45.4380, 12.3186],
  'Mestre — železniška postaja': [45.4826, 12.2320],
  'Treviso — letališče (TSF)': [45.6484, 12.1944],
  'Trst — letališče Ronchi (TRS)': [45.8275, 13.4722],
  'Trst — avtobusna postaja': [45.6563, 13.7726],
  'Sežana': [45.7092, 13.8733],
  'Divača': [45.6847, 13.9703],
  'Postojna — avtobusna postaja': [45.7752, 14.2137],
  'Logatec': [45.9145, 14.2259],
  'Vrhnika': [45.9634, 14.2958],
  'Ljubljana — avtobusna postaja': [46.0577, 14.5108],
  'Ljubljana — letališče Brnik (LJU)': [46.2237, 14.4576],
};

export const PLACES = Object.keys(PLACE_COORDS);
export const PLACE_SET = new Set(PLACES);
