// Ponudba cene: potnik ponudi nižjo ceno, prevoznik jo sprejme ali zavrne. Zahteva zagnan strežnik (glej README).
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

const date = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
const FROM = 'Vicenza';
const TO = 'Padova';

test('potnik ponudi svojo ceno, prevoznik sprejme ali zavrne', async () => {
  const admin = client();
  const carrier = client();
  const ana = client();
  const bor = client();
  let r = await admin('/auth/login', { method: 'POST', body: { email: 'admin@test.si', password: 'adminadmin' } });
  if (r.status !== 200) await admin('/auth/register', { method: 'POST', body: { email: 'admin@test.si', password: 'adminadmin', name: 'Admin' } });
  await carrier('/auth/register', {
    method: 'POST',
    body: {
      email: `oc${run}@test.si`, password: 'geslo1234', name: 'Voznik', phone: '+38640000222', role: 'carrier',
      carrier: { company_name: `Ponudbe ${run}`, registration_number: '4444444000', license_type: 'skupnost', license_number: 'SI-4' },
    },
  });
  await admin(`/admin/carriers/${(await carrier('/me')).data.user.id}/approve`, { method: 'POST', body: {} });
  await ana('/auth/register', { method: 'POST', body: { email: `oa${run}@test.si`, password: 'geslo1234', name: 'Ana' } });
  await bor('/auth/register', { method: 'POST', body: { email: `ob${run}@test.si`, password: 'geslo1234', name: 'Bor' } });
  assert.equal((await ana('/config')).data.offer_min_percent, 50);

  r = await carrier('/rides', { method: 'POST', body: { origin: FROM, destination: TO, stops: [], departure_at: `${date}T10:00`, seats_total: 4, price_per_seat: 30 } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const rideId = r.data.id;
  const search = (max) => ana(`/rides/search?${new URLSearchParams({ from: FROM, to: TO, date, seats: 1, max_total: max })}`);

  // Do 20 €: vožnja za 30 € ni med zadetki, je pa med vožnjami za ponudbo.
  r = await search(20);
  assert.ok(!r.data.rides.some((x) => x.id === rideId));
  const offerRide = r.data.offer_rides.find((x) => x.id === rideId);
  assert.ok(offerRide, 'vožnja nad ceno se ponudi za ponudbo');
  assert.equal(offerRide.offer_total, 2000);
  // Do 10 € je manj kot 50 % cene -> ni ponudbe.
  assert.ok(!(await search(10)).data.offer_rides.some((x) => x.id === rideId));
  assert.ok((await search(30)).data.rides.some((x) => x.id === rideId));

  const book = (c, offer) => c('/bookings', { method: 'POST', body: { ride_id: rideId, pickup: FROM, dropoff: TO, seats: 1, kind: 'shared', offer_total: offer } });
  r = await book(ana, 10);
  assert.equal(r.status, 400, 'prenizka ponudba');
  assert.match(r.data.error, /najmanj 15 €/);
  r = await book(ana, 20);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.total, 2000);
  assert.equal(r.data.list_total, 3000);
  const anaId = r.data.id;
  r = await book(bor, 35);
  assert.equal(r.data.total, 3000, 'ponudba nad ceno = cena po ceniku');
  assert.equal(r.data.list_total, null);
  const borId = r.data.id;

  const mine = (await carrier('/carrier/rides')).data.rides.find((x) => x.id === rideId).bookings;
  assert.equal(mine.find((b) => b.id === anaId).list_total, 3000, 'prevoznik vidi ponudbo');
  assert.equal((await carrier(`/bookings/${anaId}/confirm`, { method: 'POST', body: {} })).status, 200);
  const anaB = (await ana('/bookings/mine')).data.bookings.find((b) => b.id === anaId);
  assert.equal(anaB.status, 'confirmed');
  assert.equal(anaB.total, 2000, 'sprejeta ponudba');

  r = await book(bor, 16);
  assert.equal(r.status, 201);
  assert.equal((await carrier(`/bookings/${r.data.id}/reject`, { method: 'POST', body: {} })).status, 200);
  assert.equal((await bor('/bookings/mine')).data.bookings.find((b) => b.id === r.data.id).status, 'rejected');

  // Iskanje z največjo ceno: prevoznik vidi, koliko je potnik pripravljen plačati.
  r = await bor('/requests', { method: 'POST', body: { origin: FROM, destination: TO, date, seats: 1, max_total: 18 } });
  assert.equal(r.status, 201);
  const seen = (await carrier('/carrier/requests')).data.requests.find((x) => x.id === r.data.id);
  assert.equal(seen.max_total, 1800);
  assert.equal((await bor('/requests/mine')).data.requests.find((x) => x.id === r.data.id).max_total, 1800);

  await bor(`/bookings/${borId}/cancel`, { method: 'POST', body: {} });
  assert.equal((await carrier(`/rides/${rideId}/cancel`, { method: 'POST', body: {} })).status, 200);
});
