// Celoten tok prek API-ja. Zahteva zagnan strežnik: `npm run dev` (ADMIN_EMAILS="admin@test.si" v .dev.vars).
// Zagon: BASE_URL=http://localhost:8787 npm test
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

const tomorrow = new Date(Date.now() + 86400000);
const date = tomorrow.toISOString().slice(0, 10);
const VCE = 'Benetke — letališče Marco Polo (VCE)';
const TRST = 'Trst — avtobusna postaja';
const POSTOJNA = 'Postojna — avtobusna postaja';
const LJ = 'Ljubljana — avtobusna postaja';

test('celoten tok: registracija, preverba, objava, iskanje, rezervacija, zaključek, ocena', async () => {
  const admin = client();
  const carrier = client();
  const passenger = client();
  const other = client();

  // Admin (e-naslov iz ADMIN_EMAILS); ob ponovnem zagonu se samo prijavi.
  let r = await admin('/auth/register', { method: 'POST', body: { email: 'admin@test.si', password: 'adminadmin', name: 'Admin' } });
  if (r.status === 409) r = await admin('/auth/login', { method: 'POST', body: { email: 'admin@test.si', password: 'adminadmin' } });
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.data));
  assert.equal((await admin('/me')).data.user.role, 'admin');

  // Prevoznik brez obveznih podatkov o licenci ne gre skozi.
  r = await carrier('/auth/register', { method: 'POST', body: { email: `c${run}@test.si`, password: 'geslo1234', name: 'Janez', phone: '+38640111222', role: 'carrier', carrier: { company_name: 'Kras Shuttle' } } });
  assert.equal(r.status, 400);

  r = await carrier('/auth/register', {
    method: 'POST',
    body: {
      email: `c${run}@test.si`, password: 'geslo1234', name: 'Janez', phone: '+38640111222', role: 'carrier',
      carrier: { company_name: 'Kras Shuttle d.o.o.', country: 'SI', registration_number: '1234567000', license_type: 'skupnost', license_number: 'SI-PP-1042' },
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const me = (await carrier('/me')).data;
  assert.equal(me.carrier.status, 'pending');

  const ride = {
    origin: VCE, destination: LJ, stops: [TRST, POSTOJNA], departure_at: `${date}T18:00`,
    seats_total: 4, price_per_seat: 22, private_allowed: true, private_price: 90, max_detour_min: 20,
  };
  r = await carrier('/rides', { method: 'POST', body: ride });
  assert.equal(r.status, 403, 'nepotrjen prevoznik ne sme objaviti vožnje');

  // Potnik ne sme v admin.
  await passenger('/auth/register', { method: 'POST', body: { email: `p${run}@test.si`, password: 'geslo1234', name: 'Ana', phone: '+38641000000' } });
  assert.equal((await passenger('/admin/overview')).status, 403);
  assert.equal((await passenger(`/admin/carriers/${me.user.id}/approve`, { method: 'POST', body: {} })).status, 403);

  r = await admin(`/admin/carriers/${me.user.id}/approve`, { method: 'POST', body: {} });
  assert.equal(r.status, 200);

  r = await carrier('/rides', { method: 'POST', body: { ...ride, departure_at: '2020-01-01T10:00' } });
  assert.equal(r.status, 400, 'odhod v preteklosti');
  r = await carrier('/rides', { method: 'POST', body: ride });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const rideId = r.data.id;

  // Iskanje: Trst → Postojna je na poti, Postojna → Trst ni (napačna smer).
  r = await passenger(`/rides/search?${new URLSearchParams({ from: TRST, to: POSTOJNA, date, seats: 2 })}`);
  const found = r.data.rides.find((x) => x.id === rideId);
  assert.ok(found, 'vožnja se mora ujemati');
  // Odsek Trst → Postojna stane sorazmerno manj kot cela pot (22 € / sedež), a najmanj 5 €.
  assert.ok(found.seat_price >= 500 && found.seat_price < 2200, `cena odseka ${found.seat_price}`);
  assert.equal(found.shared_total, found.seat_price * 2);
  assert.equal(found.private_total, found.seat_price * 2 + 6800, "zasebno = sedeži × cena odseka + doplačilo (90 € − 22 €)");
  r = await passenger(`/rides/search?${new URLSearchParams({ from: VCE, to: LJ, date, seats: 2 })}`);
  assert.equal(r.data.rides.find((x) => x.id === rideId).shared_total, 4400, 'cela pot = polna cena');
  r = await passenger(`/rides/search?${new URLSearchParams({ from: POSTOJNA, to: TRST, date, seats: 2 })}`);
  assert.ok(!r.data.rides.some((x) => x.id === rideId), 'napačna smer se ne sme ujemati');
  r = await passenger(`/rides/search?${new URLSearchParams({ from: TRST, to: POSTOJNA, date, seats: 2, max_total: 9 })}`);
  assert.ok(!r.data.rides.some((x) => x.id === rideId), 'filter največje cene');

  // Rezervacija 3 sedežev, nato druga za 2 sedeža (preveč) mora pasti.
  r = await passenger('/bookings', { method: 'POST', body: { ride_id: rideId, pickup: TRST, dropoff: POSTOJNA, seats: 3, kind: 'shared', flight_number: 'FR1834' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.total, found.seat_price * 3, "3 sedeži po ceni odseka");
  const bookingId = r.data.id;

  await other('/auth/register', { method: 'POST', body: { email: `o${run}@test.si`, password: 'geslo1234', name: 'Marko' } });
  r = await other('/bookings', { method: 'POST', body: { ride_id: rideId, pickup: VCE, dropoff: LJ, seats: 2, kind: 'shared' } });
  assert.equal(r.status, 409, 'prezasedeno');
  r = await other('/bookings', { method: 'POST', body: { ride_id: rideId, pickup: VCE, dropoff: LJ, seats: 1, kind: 'private' } });
  assert.equal(r.status, 409, 'zasebno ni mogoče, ko že obstaja rezervacija');
  r = await other('/bookings', { method: 'POST', body: { ride_id: rideId, pickup: LJ, dropoff: VCE, seats: 1, kind: 'shared' } });
  assert.equal(r.status, 400, 'napačna smer pri rezervaciji');

  // Telefon prevoznika potnik vidi šele po potrditvi.
  let mine = (await passenger('/bookings/mine')).data.bookings;
  assert.equal(mine[0].carrier_phone, null);
  assert.equal((await other(`/bookings/${bookingId}/cancel`, { method: 'POST', body: {} })).status, 404, 'tuja rezervacija');
  assert.equal((await passenger(`/bookings/${bookingId}/confirm`, { method: 'POST', body: {} })).status, 403);

  r = await carrier(`/bookings/${bookingId}/confirm`, { method: 'POST', body: {} });
  assert.equal(r.status, 200);
  mine = (await passenger('/bookings/mine')).data.bookings;
  assert.equal(mine[0].status, 'confirmed');
  assert.equal(mine[0].carrier_phone, '+38640111222');

  const cr = (await carrier('/carrier/rides')).data.rides.find((x) => x.id === rideId);
  assert.equal(cr.bookings.length, 1);
  assert.equal(cr.seats_left, 1);

  assert.equal((await passenger(`/bookings/${bookingId}/rate`, { method: 'POST', body: { rating: 5 } })).status, 400, 'ocena pred zaključkom');
  assert.equal((await carrier(`/rides/${rideId}/complete`, { method: 'POST', body: {} })).status, 200);
  assert.equal((await passenger(`/bookings/${bookingId}/rate`, { method: 'POST', body: { rating: 5, comment: 'Odlično' } })).status, 200);

  const ov = (await admin('/admin/overview')).data;
  assert.ok(ov.stats.rides_completed >= 1);
  assert.ok(ov.stats.commission_completed >= Math.round(found.seat_price * 3 * 0.12));

  r = await other('/feedback', { method: 'POST', body: { message: 'Test povratnih informacij', page: '#/' } });
  assert.equal(r.status, 201);

  r = await passenger('/auth/logout', { method: 'POST', body: {} });
  assert.equal((await passenger('/me')).data.user, null);
});

test('napačno geslo in podvojen e-naslov', async () => {
  const c = client();
  const email = `x${run}@test.si`;
  assert.equal((await c('/auth/register', { method: 'POST', body: { email, password: 'kratko', name: 'X' } })).status, 400);
  assert.equal((await c('/auth/register', { method: 'POST', body: { email, password: 'geslo1234', name: 'X' } })).status, 201);
  assert.equal((await client()('/auth/register', { method: 'POST', body: { email, password: 'geslo1234', name: 'X' } })).status, 409);
  assert.equal((await client()('/auth/login', { method: 'POST', body: { email, password: 'napacno123' } })).status, 401);
  assert.equal((await client()('/auth/login', { method: 'POST', body: { email: email.toUpperCase(), password: 'geslo1234' } })).status, 200);
});
