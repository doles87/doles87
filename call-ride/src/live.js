// Sledenje vozniku, izračun prihoda (ETA) in pravila odpovedi.
import { PLACES, PLACE_SET, PLACE_COORDS, MAIN_PLACES } from './places.js';

// Pravila odpovedi; vrednosti lahko prepišeš s spremenljivkami okolja (wrangler.toml [vars]).
export function policy(env) {
  const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    cancel_fee: Math.round(num(env.CANCEL_FEE_EUR, 4) * 100), // pristojbina za pozno odpoved / neprihod
    grace_min: num(env.FREE_CANCEL_GRACE_MIN, 10),          // brezplačna odpoved po oddaji rezervacije
    free_hours: num(env.FREE_CANCEL_HOURS, 2),               // brezplačna odpoved do toliko ur pred prevzemom
    late_min: num(env.LATE_THRESHOLD_MIN, 15),               // zamuda voznika, ki omogoči brezplačno odpoved
    no_show_wait_min: num(env.NO_SHOW_WAIT_MIN, 5),          // koliko mora voznik čakati, preden označi neprihod
  };
}

// Lokalne čase ("YYYY-MM-DDTHH:MM", Europe/Ljubljana) računamo kot psevdo-UTC milisekunde.
export const localToMs = (s) => Date.parse(`${s}:00Z`);
export const msToLocal = (ms) => new Date(ms).toISOString().slice(0, 16);

export function nowLocal() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Ljubljana',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export const nowLocalMs = () => localToMs(nowLocal()) + (Date.now() % 60000);

const utcSqlToMs = (s) => Date.parse(`${s.replace(' ', 'T')}Z`);

export function haversineKm([lat1, lng1], [lat2, lng2]) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

// Groba ocena brez prometa: zračna razdalja med točkami poti × 1,2 pri povprečno 90 km/h (avtocesta).
export function estimateSeconds(coords) {
  let km = 0;
  for (let i = 1; i < coords.length; i++) km += haversineKm(coords[i - 1], coords[i]);
  return Math.round(((km * 1.2) / 90) * 3600);
}

const STOP_DWELL_S = 180; // čas za pobiranje na vsakem vmesnem postanku

async function googleSeconds(env, coords) {
  const point = ([latitude, longitude]) => ({ location: { latLng: { latitude, longitude } } });
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': 'routes.duration',
    },
    body: JSON.stringify({
      origin: point(coords[0]),
      destination: point(coords[coords.length - 1]),
      intermediates: coords.slice(1, -1).map(point),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
    }),
  });
  if (!res.ok) throw new Error(`Routes API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const duration = data.routes?.[0]?.duration;
  if (!duration) throw new Error('Routes API: ni poti');
  return parseInt(duration, 10);
}

export const explicitStops = (ride) => JSON.parse(ride.stops || '[]');

// Celotna pot vožnje v smeri vožnje: začetek, kraji ob glavni poti med začetkom in ciljem,
// izrecno dodane vmesne točke (tudi ovinki) in cilj. Vožnja Milano → Ljubljana tako pokrije
// tudi Verono, Benetke, Trst, Koper, Postojno …, ne da bi jih prevoznik moral naštevati.
export function ridePoints(ride) {
  const a = PLACES.indexOf(ride.origin);
  const b = PLACES.indexOf(ride.destination);
  const dir = a < b ? 1 : -1;
  const inside = new Set(explicitStops(ride));
  for (let i = a + dir; i !== b; i += dir) if (MAIN_PLACES.has(PLACES[i])) inside.add(PLACES[i]);
  const middle = [...inside].filter((p) => PLACE_SET.has(p) && p !== ride.origin && p !== ride.destination).sort((x, y) => (PLACES.indexOf(x) - PLACES.indexOf(y)) * dir);
  return [ride.origin, ...middle, ride.destination];
}

function routeKm(points) {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(PLACE_COORDS[points[i - 1]], PLACE_COORDS[points[i]]);
  return km;
}

// Cena sedeža za odsek: sorazmerno z dolžino odseka glede na celotno pot,
// zaokroženo navzgor na cel evro, najmanj 5 € (oz. polna cena, če je nižja).
export function segmentPrice(ride, pickup, dropoff) {
  const pts = ridePoints(ride);
  const a = pts.indexOf(pickup);
  const b = pts.indexOf(dropoff);
  if (a === 0 && b === pts.length - 1) return ride.price_per_seat;
  const share = routeKm(pts.slice(a, b + 1)) / routeKm(pts);
  const cents = Math.ceil((ride.price_per_seat * share) / 100) * 100;
  return Math.min(ride.price_per_seat, Math.max(cents, 500));
}

// Predlagan čas prevzema ob potrditvi: odhod + ocena vožnje od začetka do točke prevzema, zaokroženo na 5 min.
export function suggestedPickupTime(ride, pickup) {
  const pts = ridePoints(ride);
  const before = pts.slice(0, pts.indexOf(pickup) + 1);
  const coords = before.map((p) => PLACE_COORDS[p]);
  // Postanek se šteje le na izrecno dodanih točkah (kraji ob poti so le prevoženi).
  const explicit = new Set(explicitStops(ride));
  const stops = before.slice(1, -1).filter((p) => explicit.has(p)).length;
  const secs = coords.length > 1 ? estimateSeconds(coords) + stops * STOP_DWELL_S : 0;
  const ms = localToMs(ride.departure_at) + Math.ceil(secs / 300) * 300000;
  return msToLocal(ms);
}

export function delayMinutes(booking) {
  if (!booking.eta_at || !booking.pickup_time) return 0;
  return Math.max(0, Math.round((localToMs(booking.eta_at) - localToMs(booking.pickup_time)) / 60000));
}

// Izračun prihoda voznika na prevzem potnika. Rezultat se shrani in velja 60 s,
// da Google API kličemo največ enkrat na minuto na rezervacijo.
export async function refreshEta(env, ride, booking) {
  if (!ride.started_at || ride.status !== 'open' || booking.picked_up_at || booking.status !== 'confirmed') return booking;
  if (ride.driver_pos_ms === null || ride.driver_pos_ms === undefined) return booking;
  if (booking.eta_computed_ms && Date.now() - booking.eta_computed_ms < 60000 && booking.eta_computed_ms >= ride.driver_pos_ms) return booking;

  const pts = ridePoints(ride);
  const myIndex = pts.indexOf(booking.pickup);
  // Vmesni postanki: prevzemi drugih potrjenih, še nepobranih potnikov pred mojo točko.
  const { results: others } = await env.DB.prepare(
    `SELECT DISTINCT pickup FROM bookings WHERE ride_id = ? AND id != ? AND status = 'confirmed' AND picked_up_at IS NULL`,
  ).bind(ride.id, booking.id).all();
  const stops = others.map((o) => o.pickup)
    .filter((p) => p !== booking.pickup && pts.indexOf(p) < myIndex)
    .sort((a, b) => pts.indexOf(a) - pts.indexOf(b));
  const coords = [[ride.driver_lat, ride.driver_lng], ...stops.map((p) => PLACE_COORDS[p]), PLACE_COORDS[booking.pickup]];

  let seconds;
  let source = 'ocena';
  if (env.GOOGLE_MAPS_API_KEY) {
    try {
      seconds = await googleSeconds(env, coords);
      source = 'google';
    } catch (err) {
      console.error(err);
    }
  }
  if (seconds === undefined) seconds = estimateSeconds(coords);
  seconds += stops.length * STOP_DWELL_S;

  const etaAt = msToLocal(nowLocalMs() + seconds * 1000);
  const computed = Date.now();
  await env.DB.prepare('UPDATE bookings SET eta_at = ?, eta_source = ?, eta_computed_ms = ? WHERE id = ?')
    .bind(etaAt, source, computed, booking.id).run();
  return { ...booking, eta_at: etaAt, eta_source: source, eta_computed_ms: computed };
}

// Ali lahko potnik zdaj odpove brezplačno in koliko znaša pristojbina.
export function cancelTerms(env, booking, ride) {
  const p = policy(env);
  const free = (reason) => ({ fee: 0, refund: booking.total, free: true, reason });
  if (booking.status === 'pending') return free('Rezervacija še ni potrjena.');
  if (ride.status === 'cancelled') return free('Prevoznik je odpovedal vožnjo.');
  const delay = delayMinutes(booking);
  if (delay >= p.late_min) return free(`Voznik zamuja ${delay} min.`);
  if (!ride.started_at && Date.now() - utcSqlToMs(booking.created_at) < p.grace_min * 60000) {
    return free(`Odpoved v ${p.grace_min} min po rezervaciji je brezplačna.`);
  }
  const pickupMs = localToMs(booking.pickup_time || ride.departure_at);
  if (!ride.started_at && nowLocalMs() + p.free_hours * 3600000 <= pickupMs) {
    return free(`Do ${p.free_hours} h pred prevzemom je odpoved brezplačna.`);
  }
  const fee = Math.min(p.cancel_fee, booking.total);
  return {
    fee,
    refund: booking.total - fee,
    free: false,
    reason: ride.started_at ? 'Voznik je že na poti.' : `Manj kot ${p.free_hours} h do prevzema.`,
  };
}
