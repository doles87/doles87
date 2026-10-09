// Zasebni prevoz na delu poti: potnik doplača, od njegovega prevzema do izstopa voznik ne pobira nikogar.
// Zahteva zagnan strežnik (glej README).
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

const date = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
const MILANO = 'Milano — Centrale';
const BRESCIA = 'Brescia';
const VERONA = 'Verona — Porta Nuova';
const PADOVA = 'Padova';
const VCE = 'Benetke — letališče Marco Polo (VCE)';
const TRST = 'Trst — avtobusna postaja';
const LJ = 'Ljubljana — avtobusna postaja';

test('zasebni prevoz od Benetk: brez drugih potnikov na tem delu poti, pred njim lahko', async () => {
  const admin = client();
  const carrier = client();
  const [a, b, c, d] = [client(), client(), client(), client()];
  let r = await admin('/auth/login', { method: 'POST', body: { email: 'admin@test.si', password: 'adminadmin' } });
  if (r.status !== 200) await admin('/auth/register', { method: 'POST', body: { email: 'admin@test.si', password: 'adminadmin', name: 'Admin' } });
  await carrier('/auth/register', {
    method: 'POST',
    body: {
      email: `zc${run}@test.si`, password: 'geslo1234', name: 'Voznik', phone: '+38640000333', role: 'carrier',
      carrier: { company_name: `Zasebno ${run}`, registration_number: '5555555000', license_type: 'skupnost', license_number: 'SI-5' },
    },
  });
  await admin(`/admin/carriers/${(await carrier('/me')).data.user.id}/approve`, { method: 'POST', body: {} });
  for (const [cl, n] of [[a, 'a'], [b, 'b'], [c, 'c'], [d, 'd']]) {
    await cl('/auth/register', { method: 'POST', body: { email: `zp${n}${run}@test.si`, password: 'geslo1234', name: n } });
  }

  r = await carrier('/rides', {
    method: 'POST',
    body: { origin: MILANO, destination: LJ, stops: [], departure_at: `${date}T07:00`, seats_total: 8, price_per_seat: 45, private_allowed: true, private_surcharge: 60 },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const rideId = r.data.id;
  let ride = (await a(`/rides/${rideId}`)).data.ride;
  assert.equal(ride.private_surcharge, 6000);
  const price = (p, q) => ride.segment_prices[`${ride.route.indexOf(p)}-${ride.route.indexOf(q)}`];

  // Iskanje: zasebno od Benetk = cena odseka + doplačilo.
  const search = (cl, from, to, seats = 1) => cl(`/rides/search?${new URLSearchParams({ from, to, date, seats })}`);
  let found = (await search(b, VCE, LJ)).data.rides.find((x) => x.id === rideId);
  assert.equal(found.private_total, price(VCE, LJ) + 6000);
  assert.equal(found.private_surcharge, 6000);

  const book = (cl, pickup, dropoff, kind, seats = 1) => cl('/bookings', { method: 'POST', body: { ride_id: rideId, pickup, dropoff, seats, kind } });
  // A: deljeno Milano -> Verona (pred Benetkami).
  assert.equal((await book(a, MILANO, VERONA, 'shared')).status, 201);
  // B: zasebno Benetke -> Ljubljana, 2 osebi.
  r = await book(b, VCE, LJ, 'private', 2);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.total, price(VCE, LJ) * 2 + 6000);
  // C: deljeno Trst -> Ljubljana se prekriva z zasebnim -> ne gre; Milano -> Brescia gre.
  r = await book(c, TRST, LJ, 'shared');
  assert.equal(r.status, 409);
  assert.match(r.data.error, /zasebna/);
  assert.equal((await book(c, MILANO, BRESCIA, 'shared')).status, 201);
  // D: zasebno Milano -> Padova se prekriva z A in C -> ne gre.
  r = await book(d, MILANO, PADOVA, 'private');
  assert.equal(r.status, 409);
  assert.match(r.data.error, /drugi potniki/);

  // Iskanje Trst -> Ljubljana te vožnje ne ponudi več, Milano -> Brescia še (deljeno).
  assert.ok(!(await search(d, TRST, LJ)).data.rides.some((x) => x.id === rideId));
  found = (await search(d, MILANO, BRESCIA)).data.rides.find((x) => x.id === rideId);
  assert.ok(found && found.shared_total !== null && found.private_total === null);

  ride = (await d(`/rides/${rideId}`)).data.ride;
  assert.ok(ride.busy.some((x) => x.kind === 'private' && ride.route[x.from] === VCE && ride.route[x.to] === LJ));

  assert.equal((await carrier(`/rides/${rideId}/cancel`, { method: 'POST', body: {} })).status, 200);
});
