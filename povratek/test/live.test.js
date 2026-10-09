// Sledenje v živo in pravila odpovedi. Zahteva `npm run dev` z .dev.vars:
// ADMIN_EMAILS="admin@test.si", FREE_CANCEL_GRACE_MIN="0" (brez 10-min okna, da je pristojbino mogoče preveriti).
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

// Lokalni čas v Sloveniji čez `min` minut, "YYYY-MM-DDTHH:MM".
function localIn(min) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Ljubljana', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + min * 60000)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const VCE = 'Benetke — letališče Marco Polo (VCE)';
const TRST = 'Trst — avtobusna postaja';
const LJ = 'Ljubljana — avtobusna postaja';

test('sledenje vozniku, zamuda in pristojbine za odpoved', async () => {
  const admin = client();
  const carrier = client();
  const ana = client();
  const bor = client();
  const cene = client();

  let r = await admin('/auth/login', { method: 'POST', body: { email: 'admin@test.si', password: 'adminadmin' } });
  if (r.status !== 200) await admin('/auth/register', { method: 'POST', body: { email: 'admin@test.si', password: 'adminadmin', name: 'Admin' } });
  await carrier('/auth/register', {
    method: 'POST',
    body: {
      email: `lc${run}@test.si`, password: 'geslo1234', name: 'Voznik', phone: '+38640999888', role: 'carrier',
      carrier: { company_name: `Live Shuttle ${run}`, registration_number: '1111111000', license_type: 'skupnost', license_number: 'SI-1' },
    },
  });
  const carrierId = (await carrier('/me')).data.user.id;
  await admin(`/admin/carriers/${carrierId}/approve`, { method: 'POST', body: {} });

  const cfg = (await ana('/config')).data;
  assert.equal(cfg.policy.cancel_fee, 400);

  // Vožnja odpelje čez 60 min iz Benetk (manj kot 2 h -> pozna odpoved se zaračuna).
  r = await carrier('/rides', { method: 'POST', body: { origin: VCE, destination: LJ, stops: [TRST], departure_at: localIn(60), seats_total: 8, price_per_seat: 22 } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const rideId = r.data.id;

  for (const [c, n] of [[ana, 'a'], [bor, 'b'], [cene, 'c']]) {
    await c('/auth/register', { method: 'POST', body: { email: `lp${n}${run}@test.si`, password: 'geslo1234', name: n } });
  }
  const book = async (c) => (await c('/bookings', { method: 'POST', body: { ride_id: rideId, pickup: TRST, dropoff: LJ, seats: 1, kind: 'shared' } })).data.id;
  const anaId = await book(ana);
  const borId = await book(bor);
  const ceneId = await book(cene);

  // Nepotrjeno rezervacijo je vedno mogoče odpovedati brezplačno.
  r = await cene(`/bookings/${ceneId}/cancel`, { method: 'POST', body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.data.fee, 0);

  // Potrditev: Ana s predlaganim časom prevzema, Bor ob odhodu (prevoznik je obljubil prezgodaj, zato bo zamujal).
  r = await carrier(`/bookings/${anaId}/confirm`, { method: 'POST', body: {} });
  assert.equal(r.status, 200);
  assert.ok(r.data.pickup_time > localIn(150), `predlagan prevzem v Trstu (~2 h od Benetk): ${r.data.pickup_time}`);
  // Predlog je več kot 2 h vnaprej, zato bi bila odpoved še brezplačna.
  assert.equal((await ana(`/bookings/${anaId}/live`)).data.cancel.free, true);
  assert.equal((await carrier(`/bookings/${borId}/confirm`, { method: 'POST', body: { pickup_time: localIn(5).slice(11) } })).status, 400, 'prevzem pred odhodom');
  r = await carrier(`/bookings/${borId}/confirm`, { method: 'POST', body: { pickup_time: localIn(61).slice(11) } });
  assert.equal(r.status, 200);

  // Cene je rezerviral znova, prevzem čez 90 min: manj kot 2 h pred prevzemom je pristojbina 4 €.
  const cene2 = await book(cene);
  await carrier(`/bookings/${cene2}/confirm`, { method: 'POST', body: { pickup_time: localIn(90).slice(11) } });
  r = await cene(`/bookings/${cene2}/live`);
  assert.equal(r.data.cancel.free, false);
  assert.equal(r.data.cancel.fee, 400);
  r = await ana(`/bookings/${anaId}/live`);
  assert.equal(r.data.driver, null, 'pred začetkom vožnje ni lokacije');

  // Lokacija pred začetkom vožnje ni dovoljena; tuj prevoznik ne more začeti vožnje.
  assert.equal((await carrier(`/rides/${rideId}/location`, { method: 'POST', body: { lat: 45.5, lng: 12.35 } })).status, 400);
  assert.equal((await ana(`/rides/${rideId}/start`, { method: 'POST', body: {} })).status, 403);

  assert.equal((await carrier(`/rides/${rideId}/start`, { method: 'POST', body: {} })).status, 200);
  assert.equal((await carrier(`/rides/${rideId}/location`, { method: 'POST', body: { lat: 45.5053, lng: 12.3519 } })).status, 200);

  // Voznik je še v Benetkah (~2 h do Trsta), Bor ga čaka v Trstu čez ~1 h -> velika zamuda, odpoved brezplačna.
  r = await bor(`/bookings/${borId}/live`);
  assert.equal(r.status, 200);
  assert.ok(r.data.driver, 'potnik vidi lokacijo voznika');
  assert.ok(r.data.eta_at);
  assert.equal(r.data.eta_source, 'ocena');
  assert.ok(r.data.delay_min >= 15, `zamuda ${r.data.delay_min}`);
  assert.equal(r.data.cancel.free, true);
  assert.equal((await ana(`/bookings/${borId}/live`)).status, 404, 'tuja rezervacija');

  r = await bor(`/bookings/${borId}/cancel`, { method: 'POST', body: {} });
  assert.equal(r.data.fee, 0, 'zamuda voznika -> brez pristojbine');

  // Neprihoda ni mogoče označiti pred časom prevzema + 5 min.
  assert.equal((await carrier(`/bookings/${anaId}/no_show`, { method: 'POST', body: {} })).status, 400);

  // Ko je voznik na poti, ni več brezplačne odpovedi zaradi časa — Ana plača pristojbino, čeprav je prevzem čez ~2 h.
  r = await ana(`/bookings/${anaId}/live`);
  assert.equal(r.data.cancel.free, false, JSON.stringify(r.data));
  assert.equal(r.data.cancel.reason, 'Voznik je že na poti.');
  r = await ana(`/bookings/${anaId}/cancel`, { method: 'POST', body: {} });
  assert.equal(r.data.fee, 400);
  assert.equal(r.data.refund, 1800);

  const ov = (await admin('/admin/overview')).data;
  assert.ok(ov.stats.cancel_fees >= 400);
  assert.equal((await carrier(`/rides/${rideId}/complete`, { method: 'POST', body: {} })).status, 200);
});
