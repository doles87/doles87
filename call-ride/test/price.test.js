// Predlog cene za prevoznika iz prodaje na podobnih poteh. Zahteva zagnan strežnik (glej README).
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

const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
const BRESCIA = 'Brescia';
const PADOVA = 'Padova';
const suggest = (c, origin, destination) => c(`/carrier/price-suggestion?${new URLSearchParams({ origin, destination })}`);

test('predlog cene: začetna ocena brez podatkov, nato cena, ki se je prodajala', async () => {
  const admin = client();
  const carrier = client();
  const pax = client();
  let r = await admin('/auth/login', { method: 'POST', body: { email: 'admin@test.si', password: 'adminadmin' } });
  if (r.status !== 200) await admin('/auth/register', { method: 'POST', body: { email: 'admin@test.si', password: 'adminadmin', name: 'Admin' } });
  await carrier('/auth/register', {
    method: 'POST',
    body: {
      email: `pc${run}@test.si`, password: 'geslo1234', name: 'Voznik', phone: '+38640000111', role: 'carrier',
      carrier: { company_name: `Cene ${run}`, registration_number: '3333333000', license_type: 'skupnost', license_number: 'SI-3' },
    },
  });
  await admin(`/admin/carriers/${(await carrier('/me')).data.user.id}/approve`, { method: 'POST', body: {} });
  await pax('/auth/register', { method: 'POST', body: { email: `pp${run}@test.si`, password: 'geslo1234', name: 'Potnik' } });

  assert.equal((await pax('/carrier/price-suggestion?origin=Brescia&destination=Padova')).status, 403);
  assert.equal((await suggest(carrier, BRESCIA, BRESCIA)).status, 400);

  // Malpensa → Bergamo: na podobnih poteh ni prodaje -> začetna ocena 0,10 €/km.
  r = await suggest(carrier, 'Milano — letališče Malpensa (MXP)', 'Bergamo — letališče Orio al Serio (BGY)');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.basis, 'baseline');
  assert.equal(r.data.suggested, Math.max(5, Math.round(r.data.km * 0.1)));
  assert.equal(r.data.range, null);

  // Brescia → Padova po 30 €, prodanih 6 od 8 sedežev (75 %) -> predlog 30 €.
  r = await carrier('/rides', { method: 'POST', body: { origin: BRESCIA, destination: PADOVA, stops: [], departure_at: `${date}T09:00`, seats_total: 8, price_per_seat: 30 } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const rideId = r.data.id;
  r = await pax('/bookings', { method: 'POST', body: { ride_id: rideId, pickup: BRESCIA, dropoff: PADOVA, seats: 6, kind: 'shared' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await pax('/requests', { method: 'POST', body: { origin: 'Verona — Porta Nuova', destination: PADOVA, date, seats: 3 } });

  r = await suggest(carrier, BRESCIA, PADOVA);
  assert.equal(r.data.basis, 'data');
  assert.equal(r.data.suggested, 30);
  assert.deepEqual(r.data.range, [30, 30]);
  assert.ok(r.data.full_rides >= 1);
  assert.equal(r.data.full_rides_price, 30);
  assert.ok(r.data.open_requests >= 1 && r.data.open_request_seats >= 3, 'iskanje Verona → Padova je na poti');

  // Daljša pot z istimi cenami na km -> sorazmerno višja cena.
  r = await suggest(carrier, BRESCIA, 'Mestre — železniška postaja');
  assert.equal(r.data.basis, 'data');
  assert.ok(r.data.suggested > 30, `daljša pot: ${r.data.suggested}`);

  assert.equal((await carrier(`/rides/${rideId}/cancel`, { method: 'POST', body: {} })).status, 200);
});
