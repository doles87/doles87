import { PLACES, PLACE_SET, PLACE_COORDS } from './places.js';
import {
  policy, nowLocal, nowLocalMs, localToMs, ridePoints, suggestedPickupTime, refreshEta, delayMinutes, cancelTerms,
} from './live.js';

const SESSION_COOKIE = 'pv_session';
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100000;
const COMMISSION = 0.12;
// Rezervacije s temi statusi zasedajo sedeže.
const ACTIVE_BOOKING = "('pending','confirmed','completed')";
const LICENSE_TYPES = ['avtotaksi', 'potniki_do_8', 'avtobus', 'skupnost'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- pomožne funkcije ----------

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

function fail(status, message) {
  throw new HttpError(status, message);
}

async function readBody(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    fail(415, 'Pričakujem JSON.');
  }
  try {
    return await request.json();
  } catch {
    fail(400, 'Neveljaven JSON.');
  }
}

function str(value, field, { required = true, max = 200 } = {}) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) {
    if (required) fail(400, `Polje »${field}« je obvezno.`);
    return null;
  }
  if (v.length > max) fail(400, `Polje »${field}« je predolgo.`);
  return v;
}

function int(value, field, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `Polje »${field}« mora biti celo število med ${min} in ${max}.`);
  return n;
}

function euroToCents(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 10000) fail(400, `Polje »${field}« mora biti znesek v evrih.`);
  return Math.round(n * 100);
}

function place(value, field) {
  const v = str(value, field);
  if (!PLACE_SET.has(v)) fail(400, `Neznana lokacija: ${v}`);
  return v;
}

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

function randomToken(bytes = 32) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, saltB64) {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return b64(bits);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

function sessionCookie(request, token, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function publicUser(u) {
  return u && { id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role };
}

// ---------- seja ----------

async function currentUser(env, request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now')`,
  ).bind(token).first();
}

function requireRole(user, ...roles) {
  if (!user) fail(401, 'Prijavi se.');
  if (roles.length && !roles.includes(user.role)) fail(403, 'Nimaš dostopa.');
  return user;
}

async function startSession(env, request, userId) {
  const token = randomToken();
  await env.DB.prepare(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`,
  ).bind(token, userId, `+${SESSION_DAYS} days`).run();
  return sessionCookie(request, token, SESSION_DAYS * 86400);
}

function adminEmails(env) {
  return (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

// ---------- prevoznik ----------

function carrierFields(input) {
  const licenseType = str(input.license_type, 'vrsta licence');
  if (!LICENSE_TYPES.includes(licenseType)) fail(400, 'Neznana vrsta licence.');
  const country = (str(input.country, 'država', { required: false, max: 2 }) || 'SI').toUpperCase();
  const validUntil = str(input.license_valid_until, 'veljavnost licence', { required: false, max: 10 });
  if (validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) fail(400, 'Veljavnost licence mora biti datum.');
  return {
    company_name: str(input.company_name, 'naziv podjetja'),
    country,
    registration_number: str(input.registration_number, 'matična številka', { max: 20 }),
    tax_number: str(input.tax_number, 'davčna številka', { required: false, max: 20 }),
    license_type: licenseType,
    license_number: str(input.license_number, 'številka licence', { max: 50 }),
    community_license_number: str(input.community_license_number, 'licenca Skupnosti', { required: false, max: 50 }),
    license_valid_until: validUntil,
    vehicle: str(input.vehicle, 'vozilo', { required: false, max: 120 }),
  };
}

// ---------- vožnje ----------

// Vožnja ustreza, če sta obe točki na njeni poti in je prevzem pred izstopom.
function segmentMatches(ride, from, to) {
  const points = ridePoints(ride);
  const a = points.indexOf(from);
  const b = points.indexOf(to);
  return a !== -1 && b !== -1 && a < b;
}

const RIDE_SELECT = `
  SELECT r.*, c.company_name, c.vehicle,
    r.seats_total - COALESCE((SELECT SUM(b.seats) FROM bookings b WHERE b.ride_id = r.id AND b.status IN ${ACTIVE_BOOKING}), 0) AS seats_left,
    (SELECT COUNT(*) FROM bookings b WHERE b.ride_id = r.id AND b.status IN ${ACTIVE_BOOKING}) AS active_bookings,
    (SELECT ROUND(AVG(b.rating), 1) FROM bookings b JOIN rides r2 ON r2.id = b.ride_id WHERE r2.carrier_id = r.carrier_id AND b.rating IS NOT NULL) AS carrier_rating,
    (SELECT COUNT(b.rating) FROM bookings b JOIN rides r2 ON r2.id = b.ride_id WHERE r2.carrier_id = r.carrier_id AND b.rating IS NOT NULL) AS carrier_rating_count
  FROM rides r JOIN carriers c ON c.user_id = r.carrier_id`;

function rideOut(r) {
  return {
    id: r.id,
    carrier_id: r.carrier_id,
    company_name: r.company_name,
    vehicle: r.vehicle,
    carrier_rating: r.carrier_rating,
    carrier_rating_count: r.carrier_rating_count,
    origin: r.origin,
    destination: r.destination,
    stops: JSON.parse(r.stops || '[]'),
    departure_at: r.departure_at,
    seats_total: r.seats_total,
    seats_left: r.seats_left,
    price_per_seat: r.price_per_seat,
    private_allowed: !!r.private_allowed,
    private_available: !!r.private_allowed && r.active_bookings === 0,
    private_price: r.private_price,
    max_detour_min: r.max_detour_min,
    note: r.note,
    status: r.status,
    started_at: r.started_at,
  };
}

async function searchRides(env, url) {
  const q = url.searchParams;
  const from = place(q.get('from'), 'od');
  const to = place(q.get('to'), 'do');
  const date = q.get('date') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, 'Izberi datum.');
  const seats = int(q.get('seats') || 1, 'potniki', 1, 60);
  const timeFrom = /^\d{2}:\d{2}$/.test(q.get('time_from') || '') ? q.get('time_from') : '00:00';
  const timeTo = /^\d{2}:\d{2}$/.test(q.get('time_to') || '') ? q.get('time_to') : '23:59';
  const maxTotal = q.get('max_total') ? euroToCents(q.get('max_total'), 'največja cena') : null;

  const lower = `${date}T${timeFrom}`;
  const now = nowLocal();
  const { results } = await env.DB.prepare(
    `${RIDE_SELECT}
     WHERE r.status = 'open' AND c.status = 'approved'
       AND r.departure_at >= ? AND r.departure_at <= ? AND r.departure_at > ?
     ORDER BY r.departure_at`,
  ).bind(lower > now ? lower : now, `${date}T${timeTo}`, now).all();

  const rides = results
    .filter((r) => segmentMatches(r, from, to))
    .map(rideOut)
    .map((r) => {
      const sharedTotal = r.seats_left >= seats ? r.price_per_seat * seats : null;
      const privateTotal = r.private_available && r.seats_total >= seats ? r.private_price : null;
      return { ...r, shared_total: sharedTotal, private_total: privateTotal };
    })
    .filter((r) => r.shared_total !== null || r.private_total !== null)
    .filter((r) => maxTotal === null || Math.min(r.shared_total ?? Infinity, r.private_total ?? Infinity) <= maxTotal)
    .sort((a, b) => (a.shared_total ?? a.private_total) - (b.shared_total ?? b.private_total));

  return json({ rides });
}

async function getRide(env, id) {
  const r = await env.DB.prepare(`${RIDE_SELECT} WHERE r.id = ?`).bind(id).first();
  if (!r) fail(404, 'Vožnja ne obstaja.');
  return r;
}

async function createRide(env, user, body) {
  const carrier = await env.DB.prepare('SELECT * FROM carriers WHERE user_id = ?').bind(user.id).first();
  if (!carrier || carrier.status !== 'approved') fail(403, 'Vožnje lahko objaviš, ko admin potrdi tvojo licenco.');

  const origin = place(body.origin, 'od');
  const destination = place(body.destination, 'do');
  if (origin === destination) fail(400, 'Začetek in cilj morata biti različna.');
  const stops = Array.isArray(body.stops) ? body.stops.map((s) => place(s, 'vmesna točka')) : [];
  if (new Set([origin, destination, ...stops]).size !== stops.length + 2) fail(400, 'Točke na poti se ne smejo ponavljati.');

  const departure = str(body.departure_at, 'odhod', { max: 16 });
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(departure)) fail(400, 'Neveljaven čas odhoda.');
  if (departure <= nowLocal()) fail(400, 'Odhod mora biti v prihodnosti.');

  const seats = int(body.seats_total, 'prosti sedeži', 1, 60);
  const price = euroToCents(body.price_per_seat, 'cena na sedež');
  const privateAllowed = !!body.private_allowed;
  const privatePrice = privateAllowed ? euroToCents(body.private_price, 'cena zasebnega najema') : null;
  const detour = int(body.max_detour_min ?? 0, 'največji ovinek', 0, 180);
  const note = str(body.note, 'opomba', { required: false, max: 500 });

  const res = await env.DB.prepare(
    `INSERT INTO rides (carrier_id, origin, destination, stops, departure_at, seats_total, price_per_seat,
       private_allowed, private_price, max_detour_min, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(user.id, origin, destination, JSON.stringify(stops), departure, seats, price,
    privateAllowed ? 1 : 0, privatePrice, detour, note).run();
  return json({ id: res.meta.last_row_id }, 201);
}

async function carrierRides(env, user) {
  const { results: rides } = await env.DB.prepare(
    `${RIDE_SELECT} WHERE r.carrier_id = ? ORDER BY (r.status = 'open') DESC, r.departure_at DESC LIMIT 100`,
  ).bind(user.id).all();
  const { results: bookings } = await env.DB.prepare(
    `SELECT b.*, u.name AS passenger_name, u.phone AS passenger_phone, u.email AS passenger_email
     FROM bookings b JOIN rides r ON r.id = b.ride_id JOIN users u ON u.id = b.passenger_id
     WHERE r.carrier_id = ? ORDER BY b.created_at`,
  ).bind(user.id).all();
  return json({
    commission: COMMISSION,
    rides: rides.map((r) => ({
      ...rideOut(r),
      bookings: bookings.filter((b) => b.ride_id === r.id),
    })),
  });
}

async function ownRide(env, user, id) {
  const ride = await env.DB.prepare('SELECT * FROM rides WHERE id = ?').bind(id).first();
  if (!ride || (ride.carrier_id !== user.id && user.role !== 'admin')) fail(404, 'Vožnja ne obstaja.');
  return ride;
}

async function cancelRide(env, user, id) {
  const ride = await ownRide(env, user, id);
  if (ride.status !== 'open') fail(400, 'Vožnja ni več odprta.');
  await env.DB.batch([
    env.DB.prepare(`UPDATE rides SET status = 'cancelled' WHERE id = ?`).bind(id),
    env.DB.prepare(
      `UPDATE bookings SET status = 'cancelled', cancel_fee = 0, cancelled_at = ?, cancel_reason = 'Prevoznik je odpovedal vožnjo.'
       WHERE ride_id = ? AND status IN ('pending','confirmed')`,
    ).bind(nowLocal(), id),
  ]);
  return json({ ok: true });
}

async function completeRide(env, user, id) {
  const ride = await ownRide(env, user, id);
  if (ride.status !== 'open') fail(400, 'Vožnja ni več odprta.');
  await env.DB.batch([
    env.DB.prepare(`UPDATE rides SET status = 'completed' WHERE id = ?`).bind(id),
    env.DB.prepare(`UPDATE bookings SET status = 'completed' WHERE ride_id = ? AND status = 'confirmed'`).bind(id),
    env.DB.prepare(`UPDATE bookings SET status = 'rejected' WHERE ride_id = ? AND status = 'pending'`).bind(id),
  ]);
  return json({ ok: true });
}

// ---------- rezervacije ----------

async function createBooking(env, user, body) {
  const rideId = int(body.ride_id, 'vožnja', 1, Number.MAX_SAFE_INTEGER);
  const ride = await getRide(env, rideId);
  if (ride.status !== 'open' || ride.departure_at <= nowLocal()) fail(400, 'Te vožnje ni več mogoče rezervirati.');
  if (ride.carrier_id === user.id) fail(400, 'Svoje vožnje ne moreš rezervirati.');

  const pickup = place(body.pickup, 'prevzem');
  const dropoff = place(body.dropoff, 'izstop');
  if (!segmentMatches(ride, pickup, dropoff)) fail(400, 'Ta vožnja ne pelje po tej relaciji.');

  const kind = body.kind === 'private' ? 'private' : 'shared';
  let seats = int(body.seats, 'potniki', 1, 60);
  let total;
  let capacityCheck;
  if (kind === 'private') {
    if (!ride.private_allowed) fail(400, 'Zasebni najem za to vožnjo ni na voljo.');
    if (seats > ride.seats_total) fail(400, 'V vozilu ni dovolj sedežev.');
    seats = ride.seats_total; // zasebni najem zasede cel kombi
    total = ride.private_price;
    capacityCheck = `NOT EXISTS (SELECT 1 FROM bookings WHERE ride_id = ? AND status IN ${ACTIVE_BOOKING})`;
  } else {
    total = ride.price_per_seat * seats;
    capacityCheck = `(SELECT seats_total FROM rides WHERE id = ?) - COALESCE((SELECT SUM(seats) FROM bookings WHERE ride_id = ? AND status IN ${ACTIVE_BOOKING}), 0) >= ${seats}`;
  }
  const flight = str(body.flight_number, 'številka leta', { required: false, max: 12 });
  const note = str(body.note, 'opomba', { required: false, max: 500 });

  // Preverba prostih sedežev in vnos v enem stavku, da se dve hkratni rezervaciji ne prekrijeta.
  const capacityBinds = kind === 'private' ? [rideId] : [rideId, rideId];
  const res = await env.DB.prepare(
    `INSERT INTO bookings (ride_id, passenger_id, pickup, dropoff, seats, kind, total, flight_number, note)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE (SELECT status FROM rides WHERE id = ?) = 'open' AND ${capacityCheck}`,
  ).bind(rideId, user.id, pickup, dropoff, seats, kind, total, flight, note, rideId, ...capacityBinds).run();
  if (!res.meta.changes) fail(409, 'Žal ni več dovolj prostih sedežev.');
  return json({ id: res.meta.last_row_id, total }, 201);
}

async function myBookings(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT b.*, r.departure_at, r.origin, r.destination, r.status AS ride_status, r.started_at,
       c.company_name, cu.phone AS carrier_phone
     FROM bookings b JOIN rides r ON r.id = b.ride_id
     JOIN carriers c ON c.user_id = r.carrier_id JOIN users cu ON cu.id = r.carrier_id
     WHERE b.passenger_id = ? ORDER BY r.departure_at DESC LIMIT 100`,
  ).bind(user.id).all();
  // Telefon prevoznika pokažemo šele po potrditvi.
  return json({
    bookings: results.map((b) => ({
      ...b,
      carrier_phone: ['confirmed', 'completed'].includes(b.status) ? b.carrier_phone : null,
      delay_min: delayMinutes(b),
    })),
  });
}

async function bookingWithRide(env, id) {
  const b = await env.DB.prepare(
    `SELECT b.*, r.carrier_id, r.departure_at, r.status AS ride_status, r.started_at FROM bookings b JOIN rides r ON r.id = b.ride_id WHERE b.id = ?`,
  ).bind(id).first();
  if (!b) fail(404, 'Rezervacija ne obstaja.');
  return b;
}

async function setBookingStatus(env, id, from, to) {
  const res = await env.DB.prepare(
    `UPDATE bookings SET status = ? WHERE id = ? AND status IN (${from.map(() => '?').join(',')})`,
  ).bind(to, id, ...from).run();
  if (!res.meta.changes) fail(409, 'Statusa rezervacije ni mogoče spremeniti.');
  return json({ ok: true });
}

async function passengerBookingAction(env, user, id, action, body) {
  const b = await bookingWithRide(env, id);
  if (b.passenger_id !== user.id) fail(404, 'Rezervacija ne obstaja.');
  if (action === 'cancel') {
    if (!['pending', 'confirmed'].includes(b.status)) fail(409, 'Rezervacije ni več mogoče odpovedati.');
    if (b.picked_up_at) fail(400, 'Vožnja s to rezervacijo je že v teku.');
    const ride = await env.DB.prepare('SELECT * FROM rides WHERE id = ?').bind(b.ride_id).first();
    const terms = cancelTerms(env, b, ride);
    const res = await env.DB.prepare(
      `UPDATE bookings SET status = 'cancelled', cancel_fee = ?, cancelled_at = ?, cancel_reason = ?
       WHERE id = ? AND status IN ('pending','confirmed')`,
    ).bind(terms.fee, nowLocal(), `Potnik: ${terms.reason}`, id).run();
    if (!res.meta.changes) fail(409, 'Rezervacije ni več mogoče odpovedati.');
    return json({ ok: true, ...terms });
  }
  if (action === 'rate') {
    if (b.status !== 'completed') fail(400, 'Oceniš lahko le zaključeno vožnjo.');
    const rating = int(body.rating, 'ocena', 1, 5);
    const comment = str(body.comment, 'komentar', { required: false, max: 500 });
    await env.DB.prepare('UPDATE bookings SET rating = ?, rating_comment = ? WHERE id = ?').bind(rating, comment, id).run();
    return json({ ok: true });
  }
  fail(404, 'Neznana akcija.');
}

async function carrierBookingAction(env, user, id, action, body) {
  const b = await bookingWithRide(env, id);
  if (b.carrier_id !== user.id) fail(404, 'Rezervacija ne obstaja.');
  if (b.ride_status !== 'open') fail(400, 'Vožnja ni več odprta.');
  const ride = await env.DB.prepare('SELECT * FROM rides WHERE id = ?').bind(b.ride_id).first();

  if (action === 'confirm') {
    // Dogovorjen čas prevzema: "HH:MM" od prevoznika ali predlog iz ocene poti.
    let pickupTime = suggestedPickupTime(ride, b.pickup);
    if (body.pickup_time) {
      if (!/^\d{2}:\d{2}$/.test(body.pickup_time)) fail(400, 'Čas prevzema mora biti v obliki HH:MM.');
      pickupTime = `${ride.departure_at.slice(0, 10)}T${body.pickup_time}`;
      if (pickupTime < ride.departure_at) {
        // Prevzem po polnoči (npr. odhod 23:00, prevzem 00:40) pade na naslednji dan.
        if (localToMs(ride.departure_at) - localToMs(pickupTime) < 12 * 3600000) fail(400, 'Prevzem ne more biti pred odhodom vožnje.');
        pickupTime = new Date(localToMs(pickupTime) + 86400000).toISOString().slice(0, 16);
      }
    }
    const res = await env.DB.prepare(
      `UPDATE bookings SET status = 'confirmed', confirmed_at = ?, pickup_time = ? WHERE id = ? AND status = 'pending'`,
    ).bind(nowLocal(), pickupTime, id).run();
    if (!res.meta.changes) fail(409, 'Statusa rezervacije ni mogoče spremeniti.');
    return json({ ok: true, pickup_time: pickupTime });
  }
  if (action === 'reject') return setBookingStatus(env, id, ['pending'], 'rejected');
  if (action === 'picked_up') {
    const res = await env.DB.prepare(
      `UPDATE bookings SET picked_up_at = ? WHERE id = ? AND status = 'confirmed' AND picked_up_at IS NULL`,
    ).bind(nowLocal(), id).run();
    if (!res.meta.changes) fail(409, 'Potnik je že označen kot pobran.');
    return json({ ok: true });
  }
  if (action === 'no_show') {
    const p = policy(env);
    const pickupMs = localToMs(b.pickup_time || ride.departure_at);
    if (nowLocalMs() < pickupMs + p.no_show_wait_min * 60000) {
      fail(400, `Neprihod lahko označiš šele ${p.no_show_wait_min} min po dogovorjenem času prevzema.`);
    }
    if (b.picked_up_at) fail(400, 'Potnik je že pobran.');
    const fee = Math.min(p.cancel_fee, b.total);
    const res = await env.DB.prepare(
      `UPDATE bookings SET status = 'no_show', cancel_fee = ?, cancelled_at = ?, cancel_reason = 'Potnik ni prišel na prevzem.'
       WHERE id = ? AND status = 'confirmed'`,
    ).bind(fee, nowLocal(), id).run();
    if (!res.meta.changes) fail(409, 'Statusa rezervacije ni mogoče spremeniti.');
    return json({ ok: true, fee });
  }
  fail(404, 'Neznana akcija.');
}

// ---------- sledenje v živo ----------

async function startRide(env, user, id) {
  const ride = await ownRide(env, user, id);
  if (ride.status !== 'open') fail(400, 'Vožnja ni več odprta.');
  if (localToMs(ride.departure_at) - nowLocalMs() > 3 * 3600000) fail(400, 'Vožnjo lahko začneš največ 3 ure pred odhodom.');
  if (!ride.started_at) await env.DB.prepare('UPDATE rides SET started_at = ? WHERE id = ?').bind(nowLocal(), id).run();
  return json({ ok: true });
}

async function updateLocation(env, user, id, body) {
  const ride = await ownRide(env, user, id);
  if (ride.status !== 'open' || !ride.started_at) fail(400, 'Vožnja ni v teku.');
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) fail(400, 'Neveljavna lokacija.');
  await env.DB.prepare('UPDATE rides SET driver_lat = ?, driver_lng = ?, driver_pos_ms = ? WHERE id = ?')
    .bind(lat, lng, Date.now(), id).run();
  return json({ ok: true });
}

async function bookingLive(env, user, id) {
  const b = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first();
  if (!b) fail(404, 'Rezervacija ne obstaja.');
  const ride = await env.DB.prepare('SELECT * FROM rides WHERE id = ?').bind(b.ride_id).first();
  if (b.passenger_id !== user.id && ride.carrier_id !== user.id && user.role !== 'admin') fail(404, 'Rezervacija ne obstaja.');

  const fresh = await refreshEta(env, ride, b);
  const hasPos = ride.driver_pos_ms !== null && ride.driver_pos_ms !== undefined;
  const tracking = !!ride.started_at && ride.status === 'open' && fresh.status === 'confirmed' && !fresh.picked_up_at;
  return json({
    status: fresh.status,
    started: !!ride.started_at,
    picked_up: !!fresh.picked_up_at,
    pickup: { name: fresh.pickup, coords: PLACE_COORDS[fresh.pickup] },
    pickup_time: fresh.pickup_time,
    driver: tracking && hasPos
      ? { lat: ride.driver_lat, lng: ride.driver_lng, age_s: Math.round((Date.now() - ride.driver_pos_ms) / 1000) }
      : null,
    eta_at: tracking ? fresh.eta_at : null,
    eta_in_min: tracking && fresh.eta_at ? Math.max(0, Math.round((localToMs(fresh.eta_at) - nowLocalMs()) / 60000)) : null,
    eta_source: tracking ? fresh.eta_source : null,
    delay_min: tracking ? delayMinutes(fresh) : 0,
    late_threshold_min: policy(env).late_min,
    cancel: ['pending', 'confirmed'].includes(fresh.status) && !fresh.picked_up_at ? cancelTerms(env, fresh, ride) : null,
  });
}

// ---------- admin ----------

async function adminOverview(env) {
  const now = nowLocal();
  const [stats, carriers, bookings, rides, feedback, users] = await env.DB.batch([
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM users WHERE role = 'passenger') AS passengers,
         (SELECT COUNT(*) FROM carriers WHERE status = 'approved') AS carriers_approved,
         (SELECT COUNT(*) FROM carriers WHERE status = 'pending') AS carriers_pending,
         (SELECT COUNT(*) FROM rides WHERE status = 'open' AND departure_at > ?) AS rides_upcoming,
         (SELECT COUNT(*) FROM rides WHERE status = 'completed') AS rides_completed,
         (SELECT COUNT(*) FROM bookings) AS bookings,
         (SELECT COALESCE(SUM(total), 0) FROM bookings WHERE status = 'completed') AS revenue_completed,
         (SELECT COALESCE(SUM(seats), 0) FROM bookings WHERE status IN ('confirmed','completed')) AS seats_sold,
         (SELECT COALESCE(SUM(seats_total), 0) FROM rides WHERE status IN ('open','completed')) AS seats_offered,
         (SELECT COALESCE(SUM(cancel_fee), 0) FROM bookings) AS cancel_fees,
         (SELECT COUNT(*) FROM bookings WHERE cancel_fee > 0) AS cancel_fee_count`,
    ).bind(now),
    env.DB.prepare(
      `SELECT c.*, u.name, u.email, u.phone FROM carriers c JOIN users u ON u.id = c.user_id
       ORDER BY (c.status = 'pending') DESC, c.created_at DESC`,
    ),
    env.DB.prepare(
      `SELECT b.id, b.pickup, b.dropoff, b.seats, b.kind, b.total, b.status, b.created_at, b.cancel_fee, b.cancel_reason,
         b.pickup_time, r.departure_at,
         c.company_name, u.name AS passenger_name
       FROM bookings b JOIN rides r ON r.id = b.ride_id JOIN carriers c ON c.user_id = r.carrier_id
       JOIN users u ON u.id = b.passenger_id ORDER BY b.created_at DESC LIMIT 50`,
    ),
    env.DB.prepare(`${RIDE_SELECT} ORDER BY r.departure_at DESC LIMIT 50`),
    env.DB.prepare(
      `SELECT f.*, u.name, u.email FROM feedback f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.created_at DESC LIMIT 100`,
    ),
    env.DB.prepare(`SELECT id, email, name, phone, role, created_at FROM users ORDER BY created_at DESC LIMIT 200`),
  ]);
  const s = stats.results[0];
  return json({
    commission: COMMISSION,
    stats: { ...s, commission_completed: Math.round(s.revenue_completed * COMMISSION) },
    carriers: carriers.results,
    bookings: bookings.results,
    rides: rides.results.map(rideOut),
    feedback: feedback.results,
    users: users.results,
  });
}

async function reviewCarrier(env, id, action, body) {
  const status = action === 'approve' ? 'approved' : 'rejected';
  const note = str(body.note, 'opomba', { required: false, max: 500 });
  const res = await env.DB.prepare(
    `UPDATE carriers SET status = ?, review_note = ?, reviewed_at = datetime('now') WHERE user_id = ?`,
  ).bind(status, note, id).run();
  if (!res.meta.changes) fail(404, 'Prevoznik ne obstaja.');
  return json({ ok: true });
}

// ---------- usmerjanje ----------

async function handleApi(request, env, url) {
  const path = url.pathname.replace(/^\/api/, '');
  const method = request.method;
  const user = await currentUser(env, request);
  let m;

  if (path === '/places' && method === 'GET') return json({ places: PLACES });

  if (path === '/config' && method === 'GET') {
    // Ključ za Maps Embed API je javen (omejen na domeno v Google Cloud), ključ za Routes API ostane na strežniku.
    return json({ policy: policy(env), maps_embed_key: env.GOOGLE_MAPS_EMBED_KEY || null, live_traffic: !!env.GOOGLE_MAPS_API_KEY });
  }

  if (path === '/auth/register' && method === 'POST') {
    const body = await readBody(request);
    const email = str(body.email, 'e-pošta', { max: 120 }).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Neveljaven e-naslov.');
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 8) fail(400, 'Geslo mora imeti vsaj 8 znakov.');
    const name = str(body.name, 'ime', { max: 80 });
    const phone = str(body.phone, 'telefon', { required: body.role === 'carrier', max: 30 });
    let role = body.role === 'carrier' ? 'carrier' : 'passenger';
    if (adminEmails(env).includes(email)) role = 'admin';
    const carrier = role === 'carrier' ? carrierFields(body.carrier || {}) : null;

    if (await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) {
      fail(409, 'Ta e-naslov je že registriran.');
    }
    const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await hashPassword(password, salt);
    const res = await env.DB.prepare(
      'INSERT INTO users (email, password_hash, salt, name, phone, role) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(email, hash, salt, name, phone, role).run();
    const userId = res.meta.last_row_id;
    if (carrier) {
      await env.DB.prepare(
        `INSERT INTO carriers (user_id, company_name, country, registration_number, tax_number, license_type,
           license_number, community_license_number, license_valid_until, vehicle)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(userId, ...Object.values(carrier)).run();
    }
    const cookie = await startSession(env, request, userId);
    return json({ ok: true }, 201, { 'set-cookie': cookie });
  }

  if (path === '/auth/login' && method === 'POST') {
    const body = await readBody(request);
    const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
    const u = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    const hash = u ? await hashPassword(String(body.password || ''), u.salt) : '';
    if (!u || !timingSafeEqual(hash, u.password_hash)) fail(401, 'Napačen e-naslov ali geslo.');
    const cookie = await startSession(env, request, u.id);
    return json({ ok: true }, 200, { 'set-cookie': cookie });
  }

  if (path === '/auth/logout' && method === 'POST') {
    const token = getCookie(request, SESSION_COOKIE);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', 0) });
  }

  if (path === '/me' && method === 'GET') {
    if (!user) return json({ user: null });
    const carrier = user.role === 'carrier'
      ? await env.DB.prepare('SELECT * FROM carriers WHERE user_id = ?').bind(user.id).first()
      : null;
    return json({ user: publicUser(user), carrier });
  }

  if (path === '/me/carrier' && method === 'PUT') {
    requireRole(user, 'carrier');
    const c = carrierFields(await readBody(request));
    // Po spremembi podatkov gre prevoznik ponovno v preverbo.
    await env.DB.prepare(
      `UPDATE carriers SET company_name = ?, country = ?, registration_number = ?, tax_number = ?, license_type = ?,
         license_number = ?, community_license_number = ?, license_valid_until = ?, vehicle = ?,
         status = 'pending', review_note = NULL, reviewed_at = NULL
       WHERE user_id = ?`,
    ).bind(...Object.values(c), user.id).run();
    return json({ ok: true });
  }

  if (path === '/rides/search' && method === 'GET') return searchRides(env, url);

  if ((m = path.match(/^\/rides\/(\d+)$/)) && method === 'GET') {
    const ride = await getRide(env, Number(m[1]));
    if (ride.status !== 'open' && !user) fail(404, 'Vožnja ne obstaja.');
    return json({ ride: rideOut(ride) });
  }

  if (path === '/rides' && method === 'POST') {
    requireRole(user, 'carrier');
    return createRide(env, user, await readBody(request));
  }

  if (path === '/carrier/rides' && method === 'GET') {
    requireRole(user, 'carrier');
    return carrierRides(env, user);
  }

  if ((m = path.match(/^\/rides\/(\d+)\/(cancel|complete)$/)) && method === 'POST') {
    requireRole(user, 'carrier', 'admin');
    return m[2] === 'cancel' ? cancelRide(env, user, Number(m[1])) : completeRide(env, user, Number(m[1]));
  }

  if ((m = path.match(/^\/rides\/(\d+)\/start$/)) && method === 'POST') {
    requireRole(user, 'carrier');
    return startRide(env, user, Number(m[1]));
  }

  if ((m = path.match(/^\/rides\/(\d+)\/location$/)) && method === 'POST') {
    requireRole(user, 'carrier');
    return updateLocation(env, user, Number(m[1]), await readBody(request));
  }

  if ((m = path.match(/^\/bookings\/(\d+)\/live$/)) && method === 'GET') {
    requireRole(user);
    return bookingLive(env, user, Number(m[1]));
  }

  if (path === '/bookings' && method === 'POST') {
    requireRole(user, 'passenger', 'admin');
    return createBooking(env, user, await readBody(request));
  }

  if (path === '/bookings/mine' && method === 'GET') {
    requireRole(user);
    return myBookings(env, user);
  }

  if ((m = path.match(/^\/bookings\/(\d+)\/(cancel|rate)$/)) && method === 'POST') {
    requireRole(user);
    return passengerBookingAction(env, user, Number(m[1]), m[2], await readBody(request));
  }

  if ((m = path.match(/^\/bookings\/(\d+)\/(confirm|reject|no_show|picked_up)$/)) && method === 'POST') {
    requireRole(user, 'carrier');
    return carrierBookingAction(env, user, Number(m[1]), m[2], await readBody(request));
  }

  if (path === '/admin/overview' && method === 'GET') {
    requireRole(user, 'admin');
    return adminOverview(env);
  }

  if ((m = path.match(/^\/admin\/carriers\/(\d+)\/(approve|reject)$/)) && method === 'POST') {
    requireRole(user, 'admin');
    return reviewCarrier(env, Number(m[1]), m[2], await readBody(request));
  }

  if (path === '/feedback' && method === 'POST') {
    const body = await readBody(request);
    const message = str(body.message, 'sporočilo', { max: 2000 });
    const page = str(body.page, 'stran', { required: false, max: 100 });
    await env.DB.prepare('INSERT INTO feedback (user_id, page, message) VALUES (?, ?, ?)')
      .bind(user ? user.id : null, page, message).run();
    return json({ ok: true }, 201);
  }

  fail(404, 'Ni najdeno.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        if (err instanceof HttpError) return json({ error: err.message }, err.status);
        console.error(err);
        return json({ error: 'Napaka na strežniku. Poskusi znova.' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
