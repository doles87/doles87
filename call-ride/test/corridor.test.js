// Koridor Milano ↔ Ljubljana: samodejni kraji na poti, okno po času prevzema, cena odseka,
// iskanje z zemljevida in iskanja potnikov. Zahteva zagnan strežnik (glej README).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://localhost:8787';
const run = Date.now();

function client() {
  let cookie = '';
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const MILANO = 'Milano — Centrale';
const MXP = 'Milano — letališče Malpensa (MXP)';
const VERONA = 'Verona — Porta Nuova';
const TREVISO = 'Treviso — letališče (TSF)';
const TRST = 'Trst — avtobusna postaja';
const KOPER = 'Koper — avtobusna postaja';
const POSTOJNA = 'Postojna — avtobusna postaja';
const LJ = 'Ljubljana — avtobusna postaja';
const search = (c, q) => c(`/rides/search?${new URLSearchParams({ date, seats: 1, ...q })}`);

test('vožnja iz Milana pokrije kraje na poti, cena odseka, iskanje z zemljevida in iskanja potnikov', async () => {
  const admin = client();
  const carrier = client();
  const other = client();
  const ana = client();

  let r = await admin('/auth/login', { method: 'POST', body: { email: 'admin@test.si', password: 'adminadmin' } });
  if (r.status !== 200) await admin('/auth/register', { method: 'POST', body: { email: 'admin@test.si', password: 'adminadmin', name: 'Admin' } });
  const carrierBody = (n) => ({
    email: `mc${n}${run}@test.si`, password: 'geslo1234', name: 'Voznik', phone: '+38640111222', role: 'carrier',
    carrier: { company_name: `Milano Shuttle ${n}${run}`, registration_number: '2222222000', license_type: 'skupnost', license_number: 'SI-2' },
  });
  await carrier('/auth/register', { method: 'POST', body: carrierBody('a') });
  await other('/auth/register', { method: 'POST', body: carrierBody('b') });
  await admin(`/admin/carriers/${(await carrier('/me')).data.user.id}/approve`, { method: 'POST', body: {} });
  await ana('/auth/register', { method: 'POST', body: { email: `ma${run}@test.si`, password: 'geslo1234', name: 'Ana', phone: '+38641222333' } });

  // Vmesna točka izven poti ni dovoljena.
  r = await carrier('/rides', { method: 'POST', body: { origin: MILANO, destination: LJ, stops: [MXP], departure_at: `${date}T08:00`, seats_total: 8, price_per_seat: 45 } });
  assert.equal(r.status, 400);
  r = await carrier('/rides', { method: 'POST', body: { origin: MILANO, destination: LJ, stops: [KOPER], departure_at: `${date}T08:00`, seats_total: 8, price_per_seat: 45 } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const rideId = r.data.id;

  const ride = (await ana(`/rides/${rideId}`)).data.ride;
  for (const p of [VERONA, TRST, KOPER, POSTOJNA]) assert.ok(ride.route.includes(p), `pot vsebuje ${p}`);
  // Koper je ovinek: brez izrecne vmesne točke ni na poti iz Milana, Padova pa je samodejno.
  const plain = (await carrier('/carrier/price-suggestion?' + new URLSearchParams({ origin: MILANO, destination: LJ }))).data;
  assert.ok(!plain.route.includes(KOPER) && plain.route.includes('Padova'), plain.route.join(', '));
  assert.ok(plain.detours.some((d) => d.place === KOPER), 'Koper je med ponujenimi ovinki');
  assert.ok(!ride.route.includes(TREVISO), 'ovinek ni samodejno na poti');
  assert.equal(ride.segment_prices[`0-${ride.route.length - 1}`], 4500);

  // Trst → Ljubljana: vožnja odpelje iz Milana ob 8:00, v Trst pride okoli poldneva.
  r = await search(ana, { from: TRST, to: LJ, time_from: '11:00', time_to: '15:00' });
  let found = r.data.rides.find((x) => x.id === rideId);
  assert.ok(found, 'vožnja iz Milana se ujema s Trstom');
  assert.ok(found.pickup_eta > `${date}T11:00` && found.pickup_eta < `${date}T15:00`, found.pickup_eta);
  assert.ok(found.seat_price < 4500 && found.seat_price >= 500, `cena odseka ${found.seat_price}`);
  r = await search(ana, { from: TRST, to: LJ, time_from: '07:00', time_to: '09:00' });
  assert.ok(!r.data.rides.some((x) => x.id === rideId), 'okno se primerja s časom prevzema v Trstu, ne z odhodom iz Milana');

  assert.ok((await search(ana, { from: KOPER, to: POSTOJNA })).data.rides.some((x) => x.id === rideId), 'Koper → Postojna');
  assert.ok((await search(ana, { from: VERONA, to: TRST })).data.rides.some((x) => x.id === rideId), 'Verona → Trst');
  assert.ok(!(await search(ana, { from: TREVISO, to: LJ })).data.rides.some((x) => x.id === rideId), 'Treviso ni na poti');
  assert.ok(!(await search(ana, { from: LJ, to: TRST })).data.rides.some((x) => x.id === rideId), 'napačna smer');

  // Iskanje z zemljevida: točka pri Kopru, radij 5 km.
  r = await search(ana, { lat: '45.55', lng: '13.74', radius: '5', to: LJ });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.near[0].place, KOPER);
  found = r.data.rides.find((x) => x.id === rideId);
  assert.ok(found, 'najdeno z zemljevida');
  assert.equal(found.pickup, KOPER);
  assert.ok(found.pickup_km < 5);
  r = await search(ana, { lat: '44.0', lng: '10.0', radius: '5', to: LJ });
  assert.deepEqual(r.data.near, []);
  assert.equal(r.data.rides.length, 0);
  assert.equal((await search(ana, { lat: 'x', lng: '1', to: LJ })).status, 400);

  // Rezervacija odseka plača ceno odseka.
  r = await ana('/bookings', { method: 'POST', body: { ride_id: rideId, pickup: TRST, dropoff: LJ, seats: 2, kind: 'shared' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const trstLj = ride.segment_prices[`${ride.route.indexOf(TRST)}-${ride.route.indexOf(LJ)}`];
  assert.equal(r.data.total, trstLj * 2);

  // Iskanje potnika: Verona → Trst, dopoldne. Prevoznik ga vidi pri svoji vožnji.
  assert.equal((await ana('/requests', { method: 'POST', body: { origin: TRST, destination: TRST, date } })).status, 400);
  r = await ana('/requests', { method: 'POST', body: { origin: VERONA, destination: TRST, date, time_from: '08:00', time_to: '12:00', seats: 2, note: 'dva kovčka' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const reqId = r.data.id;
  assert.equal((await carrier('/requests', { method: 'POST', body: { origin: VERONA, destination: TRST, date } })).status, 403, 'prevoznik ne objavlja iskanj');

  r = await carrier('/carrier/requests');
  const seen = r.data.requests.find((x) => x.id === reqId);
  assert.ok(seen, 'prevoznik vidi iskanje');
  assert.deepEqual(seen.rides, [rideId]);
  assert.equal(seen.passenger_phone, '+38641222333');
  assert.deepEqual((await other('/carrier/requests')).data.requests, [], 'nepotrjen prevoznik ne vidi iskanj');
  assert.equal((await ana('/carrier/requests')).status, 403);

  r = await ana('/requests/mine');
  assert.ok(r.data.requests.find((x) => x.id === reqId).matches >= 1, 'iskanje ima vsaj eno ujemanje');
  assert.equal((await other(`/requests/${reqId}/close`, { method: 'POST', body: {} })).status, 404, 'tuje iskanje');
  assert.equal((await ana(`/requests/${reqId}/close`, { method: 'POST', body: {} })).status, 200);
  assert.ok(!(await ana('/requests/mine')).data.requests.some((x) => x.id === reqId));
  assert.ok(!(await carrier('/carrier/requests')).data.requests.some((x) => x.id === reqId));

  assert.equal((await carrier(`/rides/${rideId}/cancel`, { method: 'POST', body: {} })).status, 200);
});
