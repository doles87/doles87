// Postaje omrežja: Slovenija, severna Italija, Hrvaška, Avstrija, južna Nemčija, Madžarska, Slovaška, Srbija.
// Izbor sledi omrežju skupnih prevozov, kakršnega imajo ponudniki kot GoOpti (letališča in večja mesta);
// koordinate so približne (središče mesta, avtobusna postaja ali letališče).
//
// Imena so ključ v bazi (vožnje, rezervacije, iskanja), zato obstoječih ne spreminjaj — nove lahko dodajaš.
//
// Vrsta postaje:
//   city    — mesto ob poti; vožnja ga pokrije samodejno, če je le majhen ovinek od njene poti
//   stop    — letališče ali postaja tik ob avtocesti; enako kot city
//   airport — letališče, ki je ovinek; vožnja ga pokrije le, če ga prevoznik doda
//   resort  — turistični kraj izven glavne ceste (morje, gore); le, če ga prevoznik doda
const STATIONS = [
  // Slovenija
  ['Ljubljana — avtobusna postaja', 46.0577, 14.5108, 'SI', 'city'],
  ['Ljubljana — letališče Brnik (LJU)', 46.2237, 14.4576, 'SI', 'airport'],
  ['Maribor — avtobusna postaja', 46.5597, 15.6556, 'SI', 'city'],
  ['Maribor — letališče (MBX)', 46.4799, 15.6861, 'SI', 'airport'],
  ['Celje', 46.2309, 15.2604, 'SI', 'city'],
  ['Kranj', 46.2389, 14.3556, 'SI', 'city'],
  ['Škofja Loka', 46.1655, 14.3064, 'SI', 'city'],
  ['Kamnik', 46.2259, 14.6121, 'SI', 'city'],
  ['Domžale', 46.1382, 14.5944, 'SI', 'city'],
  ['Grosuplje', 45.9550, 14.6589, 'SI', 'city'],
  ['Radovljica', 46.3444, 14.1744, 'SI', 'city'],
  ['Jesenice', 46.4300, 14.0592, 'SI', 'city'],
  ['Bled', 46.3683, 14.1146, 'SI', 'resort'],
  ['Bohinj', 46.2775, 13.9550, 'SI', 'resort'],
  ['Kranjska Gora', 46.4846, 13.7857, 'SI', 'resort'],
  ['Bovec', 46.3378, 13.5522, 'SI', 'resort'],
  ['Kobarid', 46.2470, 13.5786, 'SI', 'resort'],
  ['Tolmin', 46.1830, 13.7331, 'SI', 'city'],
  ['Idrija', 46.0028, 14.0306, 'SI', 'city'],
  ['Nova Gorica', 45.9560, 13.6436, 'SI', 'city'],
  ['Ajdovščina', 45.8871, 13.9095, 'SI', 'city'],
  ['Vrhnika', 45.9634, 14.2958, 'SI', 'city'],
  ['Logatec', 45.9145, 14.2259, 'SI', 'city'],
  ['Postojna — avtobusna postaja', 45.7752, 14.2137, 'SI', 'city'],
  ['Divača', 45.6847, 13.9703, 'SI', 'city'],
  ['Sežana', 45.7092, 13.8733, 'SI', 'city'],
  ['Ilirska Bistrica', 45.5679, 14.2406, 'SI', 'city'],
  ['Koper — avtobusna postaja', 45.5469, 13.7295, 'SI', 'city'],
  ['Izola', 45.5370, 13.6600, 'SI', 'resort'],
  ['Piran', 45.5283, 13.5683, 'SI', 'resort'],
  ['Portorož', 45.5142, 13.5919, 'SI', 'resort'],
  ['Kočevje', 45.6431, 14.8633, 'SI', 'city'],
  ['Trebnje', 45.9040, 15.0213, 'SI', 'city'],
  ['Novo mesto', 45.8034, 15.1689, 'SI', 'city'],
  ['Krško', 45.9590, 15.4917, 'SI', 'city'],
  ['Brežice', 45.9033, 15.5911, 'SI', 'city'],
  ['Trbovlje', 46.1550, 15.0533, 'SI', 'city'],
  ['Velenje', 46.3592, 15.1103, 'SI', 'city'],
  ['Slovenj Gradec', 46.5103, 15.0806, 'SI', 'city'],
  ['Rogaška Slatina', 46.2370, 15.6360, 'SI', 'resort'],
  ['Ptuj', 46.4200, 15.8700, 'SI', 'city'],
  ['Ormož', 46.4071, 16.1544, 'SI', 'city'],
  ['Murska Sobota', 46.6625, 16.1664, 'SI', 'city'],
  ['Lendava', 46.5631, 16.4508, 'SI', 'city'],

  // Italija
  ['Trst — avtobusna postaja', 45.6563, 13.7726, 'IT', 'city'],
  ['Trst — letališče Ronchi (TRS)', 45.8275, 13.4722, 'IT', 'stop'],
  ['Tržič (Monfalcone)', 45.8090, 13.5330, 'IT', 'city'],
  ['Gorica (Gorizia)', 45.9409, 13.6219, 'IT', 'city'],
  ['Videm (Udine)', 46.0711, 13.2346, 'IT', 'city'],
  ['Palmanova', 45.9056, 13.3097, 'IT', 'city'],
  ['Gradež (Grado)', 45.6781, 13.3953, 'IT', 'resort'],
  ['Lignano Sabbiadoro', 45.6764, 13.1236, 'IT', 'resort'],
  ['Bibione', 45.6372, 13.0367, 'IT', 'resort'],
  ['Caorle', 45.6008, 12.8853, 'IT', 'resort'],
  ['Jesolo', 45.5052, 12.6447, 'IT', 'resort'],
  ['Pordenone', 45.9564, 12.6615, 'IT', 'city'],
  ['Treviso', 45.6669, 12.2430, 'IT', 'city'],
  ['Treviso — letališče (TSF)', 45.6484, 12.1944, 'IT', 'airport'],
  ['Belluno', 46.1425, 12.2167, 'IT', 'city'],
  ['Cortina d’Ampezzo', 46.5405, 12.1357, 'IT', 'resort'],
  ['Benetke — letališče Marco Polo (VCE)', 45.5053, 12.3519, 'IT', 'stop'],
  ['Benetke — Piazzale Roma', 45.4380, 12.3186, 'IT', 'airport'],
  ['Mestre — železniška postaja', 45.4826, 12.2320, 'IT', 'city'],
  ['Padova', 45.4177, 11.8807, 'IT', 'city'],
  ['Rovigo', 45.0700, 11.7900, 'IT', 'city'],
  ['Ferrara', 44.8381, 11.6198, 'IT', 'city'],
  ['Vicenza', 45.5410, 11.5404, 'IT', 'city'],
  ['Verona — Porta Nuova', 45.4290, 10.9824, 'IT', 'city'],
  ['Verona — letališče (VRN)', 45.3957, 10.8885, 'IT', 'airport'],
  ['Peschiera del Garda', 45.4394, 10.6923, 'IT', 'city'],
  ['Trento', 46.0748, 11.1217, 'IT', 'city'],
  ['Bocen (Bolzano)', 46.4983, 11.3548, 'IT', 'city'],
  ['Brescia', 45.5323, 10.2127, 'IT', 'city'],
  ['Bergamo', 45.6983, 9.6773, 'IT', 'city'],
  ['Bergamo — letališče Orio al Serio (BGY)', 45.6689, 9.7004, 'IT', 'stop'],
  ['Milano — Centrale', 45.4859, 9.2045, 'IT', 'city'],
  ['Milano — letališče Linate (LIN)', 45.4451, 9.2767, 'IT', 'airport'],
  ['Milano — letališče Malpensa (MXP)', 45.6301, 8.7231, 'IT', 'airport'],
  ['Como', 45.8081, 9.0852, 'IT', 'city'],
  ['Novara', 45.4469, 8.6219, 'IT', 'city'],
  ['Torino', 45.0703, 7.6869, 'IT', 'city'],
  ['Torino — letališče (TRN)', 45.2008, 7.6497, 'IT', 'airport'],
  ['Piacenza', 45.0526, 9.6930, 'IT', 'city'],
  ['Parma', 44.8015, 10.3279, 'IT', 'city'],
  ['Reggio Emilia', 44.6989, 10.6297, 'IT', 'city'],
  ['Modena', 44.6471, 10.9252, 'IT', 'city'],
  ['Bologna', 44.4949, 11.3426, 'IT', 'city'],
  ['Bologna — letališče (BLQ)', 44.5354, 11.2887, 'IT', 'airport'],
  ['Imola', 44.3533, 11.7141, 'IT', 'city'],
  ['Faenza', 44.2856, 11.8833, 'IT', 'city'],
  ['Forlì', 44.2227, 12.0407, 'IT', 'city'],
  ['Cesena', 44.1391, 12.2431, 'IT', 'city'],
  ['Rimini', 44.0678, 12.5695, 'IT', 'city'],
  ['Firence (Firenze)', 43.7696, 11.2558, 'IT', 'city'],

  // Hrvaška
  ['Zagreb — avtobusni kolodvor', 45.8044, 15.9932, 'HR', 'city'],
  ['Zagreb — letališče (ZAG)', 45.7429, 16.0688, 'HR', 'airport'],
  ['Karlovac', 45.4929, 15.5553, 'HR', 'city'],
  ['Varaždin', 46.3044, 16.3366, 'HR', 'city'],
  ['Čakovec', 46.3844, 16.4339, 'HR', 'city'],
  ['Osijek', 45.5550, 18.6955, 'HR', 'city'],
  ['Reka (Rijeka)', 45.3271, 14.4422, 'HR', 'city'],
  ['Reka — letališče Krk (RJK)', 45.2169, 14.5703, 'HR', 'airport'],
  ['Opatija', 45.3376, 14.3052, 'HR', 'resort'],
  ['Crikvenica', 45.1736, 14.6922, 'HR', 'resort'],
  ['Umag', 45.4361, 13.5197, 'HR', 'resort'],
  ['Novigrad', 45.3167, 13.5639, 'HR', 'resort'],
  ['Poreč', 45.2269, 13.5947, 'HR', 'resort'],
  ['Rovinj', 45.0812, 13.6387, 'HR', 'resort'],
  ['Pulj (Pula)', 44.8666, 13.8496, 'HR', 'city'],
  ['Pulj — letališče (PUY)', 44.8935, 13.9222, 'HR', 'airport'],
  ['Plitvička jezera', 44.8654, 15.5820, 'HR', 'resort'],
  ['Zadar', 44.1194, 15.2314, 'HR', 'city'],
  ['Zadar — letališče (ZAD)', 44.1083, 15.3467, 'HR', 'airport'],
  ['Šibenik', 43.7350, 15.8952, 'HR', 'city'],
  ['Split', 43.5081, 16.4402, 'HR', 'city'],
  ['Split — letališče (SPU)', 43.5389, 16.2980, 'HR', 'airport'],

  // Avstrija
  ['Celovec (Klagenfurt)', 46.6249, 14.3050, 'AT', 'city'],
  ['Celovec — letališče (KLU)', 46.6425, 14.3377, 'AT', 'airport'],
  ['Beljak (Villach)', 46.6167, 13.8500, 'AT', 'city'],
  ['Gradec (Graz)', 47.0707, 15.4395, 'AT', 'city'],
  ['Gradec — letališče (GRZ)', 46.9911, 15.4396, 'AT', 'stop'],
  ['Dunaj (Wien)', 48.2082, 16.3738, 'AT', 'city'],
  ['Dunaj — letališče (VIE)', 48.1103, 16.5697, 'AT', 'stop'],
  ['Linz', 48.3069, 14.2858, 'AT', 'city'],
  ['Salzburg', 47.8095, 13.0550, 'AT', 'city'],
  ['Salzburg — letališče (SZG)', 47.7933, 13.0043, 'AT', 'stop'],
  ['Innsbruck', 47.2692, 11.4041, 'AT', 'city'],

  // Nemčija
  ['München — glavna postaja', 48.1402, 11.5586, 'DE', 'city'],
  ['München — letališče (MUC)', 48.3538, 11.7861, 'DE', 'airport'],
  ['Rosenheim', 47.8561, 12.1289, 'DE', 'city'],
  ['Memmingen — letališče (FMM)', 47.9888, 10.2395, 'DE', 'airport'],

  // Madžarska, Slovaška, Srbija
  ['Budimpešta (Budapest)', 47.4979, 19.0402, 'HU', 'city'],
  ['Budimpešta — letališče (BUD)', 47.4369, 19.2556, 'HU', 'airport'],
  ['Nagykanizsa', 46.4590, 16.9897, 'HU', 'city'],
  ['Bratislava', 48.1486, 17.1077, 'SK', 'city'],
  ['Bratislava — letališče (BTS)', 48.1702, 17.2127, 'SK', 'airport'],
  ['Beograd', 44.7866, 20.4489, 'RS', 'city'],
  ['Beograd — letališče (BEG)', 44.8184, 20.3091, 'RS', 'airport'],
];

export const COUNTRIES = {
  SI: 'Slovenija', IT: 'Italija', HR: 'Hrvaška', AT: 'Avstrija', DE: 'Nemčija', HU: 'Madžarska', SK: 'Slovaška', RS: 'Srbija',
};
export const PLACE_COORDS = Object.fromEntries(STATIONS.map(([name, lat, lng]) => [name, [lat, lng]]));
export const PLACE_COUNTRY = Object.fromEntries(STATIONS.map(([name, , , country]) => [name, country]));
export const PLACE_KIND = Object.fromEntries(STATIONS.map(([name, , , , kind]) => [name, kind]));
export const PLACES = STATIONS.map(([name]) => name);
export const PLACE_SET = new Set(PLACES);
// Postaje, ki jih vožnja pokrije samodejno, če so le majhen ovinek od njene poti.
export const MAIN_PLACES = new Set(STATIONS.filter((s) => s[4] === 'city' || s[4] === 'stop').map(([name]) => name));
