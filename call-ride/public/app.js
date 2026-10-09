// Call ride — mobilni spletni vmesnik (brez build koraka).

const app = document.getElementById('app');
const state = { me: null, carrier: null, places: [], coords: {}, config: { policy: {} } };

// Opravila, ki se počistijo ob menjavi strani (osveževanje, GPS, wake lock).
const cleanups = [];
const onLeave = (fn) => cleanups.push(fn);

// ---------- pomožne funkcije ----------

class Raw { constructor(s) { this.s = s; } }
const raw = (s) => new Raw(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function piece(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(piece).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
}
function html(strings, ...values) {
  return raw(strings.reduce((out, s, i) => out + s + (i < values.length ? piece(values[i]) : ''), ''));
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch { /* prazen odgovor */ }
  if (!res.ok) {
    const err = new Error(data.error || `Napaka (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function eur(cents) {
  if (cents === null || cents === undefined) return '—';
  return cents % 100 === 0 ? `€${cents / 100}` : `€${(cents / 100).toFixed(2).replace('.', ',')}`;
}

const DAYS = ['ned', 'pon', 'tor', 'sre', 'čet', 'pet', 'sob'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'];
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function fmtDay(dateStr) {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = isoDate(new Date());
  const tomorrow = isoDate(new Date(Date.now() + 86400000));
  if (dateStr.slice(0, 10) === today) return 'danes';
  if (dateStr.slice(0, 10) === tomorrow) return 'jutri';
  return `${DAYS[date.getDay()]}, ${d}. ${MONTHS[m - 1]}`;
}
const fmtTime = (dt) => dt.slice(11, 16);
const fmtWhen = (dt) => `${fmtDay(dt)} · ${fmtTime(dt)}`;
const city = (p) => p.split(' — ')[0];
const persons = (n) => `${n} ${n === 1 ? 'oseba' : n === 2 ? 'osebi' : n <= 4 ? 'osebe' : 'oseb'}`;
const seatsWord = (n) => `${n} ${n === 1 ? 'sedež' : n === 2 ? 'sedeža' : n <= 4 ? 'sedeži' : 'sedežev'}`;
const isFuture = (dt) => dt > `${isoDate(new Date())}T${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = h.split('?');
  return { path, query: new URLSearchParams(query) };
}
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

// Onemogoči gumb med zahtevo in prikaže napako v obrazcu.
async function submitting(form, fn) {
  const btn = form.querySelector('[type=submit]');
  const errEl = form.querySelector('.err');
  if (errEl) errEl.hidden = true;
  if (btn) btn.disabled = true;
  try {
    await fn();
  } catch (e) {
    if (errEl) { errEl.textContent = e.message; errEl.hidden = false; errEl.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    else toast(e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------- ikone ----------

const svg = (d, { size = 22, sw = 2, stroke = 'currentColor', fill = 'none' } = {}) =>
  raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`);
const I = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  ticket: '<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M13 6v12" stroke-dasharray="2 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  van: '<path d="M3 7h11l4 4h3v6h-2"/><path d="M3 7v10h2"/><circle cx="7.5" cy="17.5" r="2"/><circle cx="16.5" cy="17.5" r="2"/><path d="M9.5 17.5h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  swap: '<path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>',
  nav: '<path d="M3 11l18-8-8 18-2-8-8-2z"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
};
const star = (on, size = 14) => svg('<path d="M12 2l2.9 6.2 6.8.8-5 4.6 1.3 6.7L12 17.8 5.9 21l1.4-6.7-5-4.6 6.8-.8z"/>',
  { size, sw: on ? 0 : 2, fill: on ? '#F5A524' : 'none', stroke: on ? 'none' : '#D2D6CD' });

// ---------- okvir strani ----------

const STATUS = {
  pending: ['Čaka na potrditev', 'wait'],
  confirmed: ['Potrjeno', 'ok'],
  rejected: ['Zavrnjeno', 'bad'],
  cancelled: ['Odpovedano', 'gray'],
  completed: ['Zaključeno', 'done'],
  no_show: ['Ni prišel', 'bad'],
  open: ['Odprta', 'ok'],
  approved: ['Potrjen', 'ok'],
};
const pill = (status) => { const [t, c] = STATUS[status] || [status, 'gray']; return html`<span class="pill ${c}">${t}</span>`; };

const LICENSES = {
  avtotaksi: 'Avto-taksi prevozi',
  potniki_do_8: 'Prevoz potnikov (vozila do 8+1 sedežev)',
  avtobus: 'Prevoz potnikov z avtobusi (nad 8+1 sedežev)',
  skupnost: 'Licenca Skupnosti (mednarodni prevoz)',
};

function header({ title, sub, back = true, carrier = false, right = '' } = {}) {
  return html`<header class="top ${carrier ? 'carrier' : ''}">
    ${back ? html`<button class="icon-btn" data-back aria-label="Nazaj">${svg(I.back)}</button>` : ''}
    <div class="grow"><div class="title">${title}</div>${sub ? html`<div class="sub">${sub}</div>` : ''}</div>
    ${right}
  </header>`;
}

function brandHeader() {
  const u = state.me;
  return html`<header class="top">
    <a class="brand" href="#/"><b>Call ride</b><span class="badge-beta">beta</span></a>
    <div class="grow"></div>
    ${u ? html`<a class="top-link" href="#/profil">${u.name.split(' ')[0]}</a>` : html`<a class="top-link" href="#/prijava">Prijava</a>`}
  </header>`;
}

function tabbar(active) {
  const role = state.me?.role;
  const tabs = role === 'carrier'
    ? [['#/prevoznik', 'Moje vožnje', I.van], ['#/prevoznik/nova', 'Nova vožnja', I.plus], ['#/profil', 'Profil', I.user]]
    : [['#/', 'Iskanje', I.search], ['#/moje', 'Rezervacije', I.ticket],
      ...(role === 'admin' ? [['#/admin', 'Admin', I.shield]] : []),
      [state.me ? '#/profil' : '#/prijava', state.me ? 'Profil' : 'Prijava', I.user]];
  return html`<div class="tabbar"><nav aria-label="Glavni meni">${tabs.map(([href, label, icon]) => html`
    <a href="${href}" ${href === active ? raw('aria-current="page"') : ''}>${svg(icon, { size: 22, sw: 1.8 })}<span>${label}</span></a>`)}</nav></div>`;
}

function feedbackButton() {
  return html`<button class="fb-btn" data-feedback>${svg(I.chat, { size: 16 })} Mnenje</button>
  <dialog id="fb-dialog"><form method="dialog" id="fb-form">
    <div class="between"><b>Povratne informacije</b><button class="icon-btn" value="close" aria-label="Zapri" formnovalidate>✕</button></div>
    <p class="muted small" style="margin:0">Kaj ne deluje, kaj je nejasno, kaj pogrešaš? Sporočilo prejme ekipa Call ride.</p>
    <div class="box"><label class="field"><span>Sporočilo</span><textarea name="message" required maxlength="2000"></textarea></label></div>
    <div class="err" hidden></div>
    <button class="btn dark sm" type="submit" value="send">Pošlji</button>
  </form></dialog>`;
}

function render(content, { tab, wide = false, feedback = true } = {}) {
  app.className = wide ? 'wide' : '';
  app.innerHTML = piece(html`${content}${tab !== undefined ? tabbar(tab) : ''}${feedback ? feedbackButton() : ''}`);
  window.scrollTo(0, 0);
  app.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => (history.length > 1 ? history.back() : go('#/'))));
  const fbBtn = app.querySelector('[data-feedback]');
  if (fbBtn) {
    const dlg = app.querySelector('#fb-dialog');
    const form = app.querySelector('#fb-form');
    fbBtn.addEventListener('click', () => dlg.showModal());
    form.addEventListener('submit', (e) => {
      if (e.submitter?.value !== 'send') return;
      e.preventDefault();
      submitting(form, async () => {
        await api('/feedback', { method: 'POST', body: { message: form.message.value, page: location.hash || '#/' } });
        form.reset();
        dlg.close();
        toast('Hvala! Sporočilo je poslano.');
      });
    });
  }
}

function placeOptions(selected, list = null) {
  const opt = (p) => html`<option ${p === selected ? raw('selected') : ''}>${p}</option>`;
  if (list) return list.map(opt);
  // Vse postaje: po državah, znotraj države po abecedi.
  return Object.entries(state.countries || {}).map(([code, name]) => html`<optgroup label="${name}">${state.places
    .filter((p) => state.country?.[p] === code).sort((a, b) => a.localeCompare(b, 'sl')).map(opt)}</optgroup>`);
}

function requireLogin() {
  if (state.me) return true;
  go(`#/prijava?next=${encodeURIComponent(location.hash)}`);
  return false;
}


function loadSearch() {
  try { return JSON.parse(sessionStorage.getItem('pv_search') || 'null'); } catch { return null; }
}

// ---------- zemljevid (Leaflet + OpenStreetMap, naloži se šele, ko je potreben) ----------

let leafletLoading;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  leafletLoading ||= new Promise((resolve, reject) => {
    const base = 'https://unpkg.com/leaflet@1.9.4/dist/';
    const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `${base}leaflet.css` });
    const js = Object.assign(document.createElement('script'), { src: `${base}leaflet.js` });
    js.onload = () => resolve(window.L);
    js.onerror = () => { leafletLoading = null; reject(new Error('Zemljevida ni bilo mogoče naložiti. Preveri povezavo.')); };
    document.head.append(css, js);
  });
  return leafletLoading;
}

function distKm([lat1, lng1], [lat2, lng2]) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
const km = (n) => `${n < 10 ? n.toFixed(1).replace('.', ',') : Math.round(n)} km`;

// Postaje v radiu od izbrane lokacije, najbližja prva.
function placesWithin(point, radius) {
  return state.places.map((p) => ({ place: p, km: distKm(point, state.coords[p]) }))
    .filter((x) => x.km <= radius).sort((a, b) => a.km - b.km);
}

// Izbira točke in radija na zemljevidu. onChange({ lat, lng, radius }) ob vsaki spremembi.
async function mountPickMap(el, initial, onChange) {
  const L = await loadLeaflet();
  const map = L.map(el, { zoomControl: true, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const dots = state.places.map((p) => L.circleMarker(state.coords[p], { radius: 5, color: '#0F6E64', weight: 2, fillColor: '#fff', fillOpacity: 1 })
    .bindTooltip(p).addTo(map));
  map.fitBounds(L.latLngBounds(state.places.map((p) => state.coords[p])), { padding: [16, 16] });

  let point = initial.lat ? [Number(initial.lat), Number(initial.lng)] : null;
  let radius = Number(initial.radius) || 15;
  let marker = null;
  let circle = null;
  function draw() {
    if (!point) return;
    if (!marker) {
      marker = L.marker(point, { draggable: true }).addTo(map);
      marker.on('dragend', () => { const ll = marker.getLatLng(); point = [ll.lat, ll.lng]; draw(); });
      circle = L.circle(point, { radius: radius * 1000, color: '#F5A524', weight: 2, fillOpacity: 0.12 }).addTo(map);
    }
    marker.setLatLng(point);
    circle.setLatLng(point).setRadius(radius * 1000);
    const inside = new Set(placesWithin(point, radius).map((x) => x.place));
    state.places.forEach((p, i) => dots[i].setStyle({ fillColor: inside.has(p) ? '#0F6E64' : '#fff' }));
    onChange({ lat: point[0].toFixed(5), lng: point[1].toFixed(5), radius });
  }
  map.on('click', (e) => { point = [e.latlng.lat, e.latlng.lng]; draw(); });
  if (point) { draw(); map.fitBounds(circle.getBounds(), { padding: [16, 16] }); }
  return {
    setRadius(r) { radius = r; draw(); },
    setPoint(p) { point = p; draw(); map.fitBounds(circle.getBounds(), { padding: [16, 16] }); },
    remove() { map.remove(); },
  };
}

// ---------- potnik: iskanje ----------

function viewHome() {
  if (state.me?.role === 'carrier') return go('#/prevoznik');
  const saved = loadSearch() || {};
  const today = isoDate(new Date());
  const s = {
    mode: 'place', from: 'Benetke — letališče Marco Polo (VCE)', to: 'Ljubljana — avtobusna postaja', seats: '1', time_from: '00:00', time_to: '23:59', max_total: '',
    lat: '', lng: '', radius: '15',
    ...saved,
  };
  if (!s.date || s.date < today) s.date = today;
  let mode = s.mode === 'map' ? 'map' : 'place';

  render(html`${brandHeader()}
  <main>
    <div>
      <div class="muted small" style="font-weight:500">Potnik</div>
      <h1>Kam se peljete<br>nazaj?</h1>
    </div>
    <form id="search" class="stack" novalidate>
      <div class="seg" role="group" aria-label="Kje vstopiš">
        <button type="button" data-mode="place">Izberi kraj</button>
        <button type="button" data-mode="map">Na zemljevidu</button>
      </div>
      <div id="map-pick" class="stack" hidden>
        <div class="map-box"><div id="map"></div><p class="map-hint" id="map-hint">Tapni na zemljevid, kjer želiš vstopiti.</p></div>
        <div class="box"><label class="field"><span>Radij iskanja: <b id="radius-out" class="mono">${s.radius} km</b></span>
          <input type="range" name="radius" min="1" max="50" step="1" value="${s.radius}" class="range"></label></div>
        <button type="button" class="btn ghost sm" id="locate">${svg(I.nav, { size: 16 })} Uporabi mojo lokacijo</button>
        <div class="small muted" id="near"></div>
        <input type="hidden" name="lat" value="${s.lat}"><input type="hidden" name="lng" value="${s.lng}">
      </div>
      <div class="card flush" style="position:relative">
        <label class="field" id="from-field"><span>Od</span><select name="from">${placeOptions(s.from)}</select></label>
        <div class="divider" id="from-div"></div>
        <label class="field"><span>Do</span><select name="to">${placeOptions(s.to)}</select></label>
        <button type="button" class="icon-btn" id="swap" aria-label="Zamenjaj smer" style="position:absolute;right:30px;top:50%;transform:translateY(-50%);background:#F2F3F1">${svg(I.swap, { size: 18 })}</button>
      </div>
      <div class="row">
        <div class="box"><label class="field"><span>Datum</span><input type="date" name="date" value="${s.date}" min="${today}" required></label></div>
        <div class="box" style="flex:.7"><label class="field"><span>Potniki</span><select name="seats">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => html`<option value="${n}" ${String(n) === String(s.seats) ? raw('selected') : ''}>${persons(n)}</option>`)}</select></label></div>
      </div>
      <div class="row">
        <div class="box"><label class="field"><span>Časovno okno od</span><input type="time" name="time_from" value="${s.time_from}" class="mono"></label></div>
        <div class="box"><label class="field"><span>do</span><input type="time" name="time_to" value="${s.time_to}" class="mono"></label></div>
      </div>
      <div class="box"><label class="field"><span>Največ plačam skupaj (€, neobvezno)</span><input type="number" inputmode="decimal" min="0" step="1" name="max_total" value="${s.max_total}" placeholder="brez omejitve" class="mono"></label></div>
      <div class="err" hidden></div>
      <button class="btn" type="submit">Poišči prevoz</button>
      <p class="hint">Bolj ko je termin prožen, več ponudb dobiš — in nižjo ceno.</p>
    </form>
    <section id="upcoming"></section>
    ${!state.me ? html`<div class="notice teal">${svg(I.van, { size: 18 })}<div><b>Ste prevoznik?</b> Objavite prazne povratne vožnje in jih zapolnite. <a href="#/registracija?vloga=prevoznik">Registracija prevoznika</a></div></div>` : ''}
  </main>`, { tab: '#/' });

  const form = app.querySelector('#search');
  app.querySelector('#swap').addEventListener('click', () => {
    [form.from.value, form.to.value] = [form.to.value, form.from.value];
  });

  // Iskanje z zemljevida
  let picker = null;
  const showNear = () => {
    const box = app.querySelector('#near');
    if (!form.lat.value) { box.textContent = ''; return; }
    const near = placesWithin([Number(form.lat.value), Number(form.lng.value)], Number(form.radius.value));
    box.innerHTML = near.length
      ? piece(html`Postaje v radiu: ${near.map((x, i) => html`${i ? ', ' : ''}<b style="color:var(--ink)">${x.place}</b> (${km(x.km)})`)}`)
      : piece(html`<span style="color:var(--red)">V tem radiu ni nobene postaje — povečaj radij ali izberi drugo točko.</span>`);
    app.querySelector('#map-hint').hidden = true;
  };
  const onPick = ({ lat, lng }) => { form.lat.value = lat; form.lng.value = lng; showNear(); };
  async function setMode(m) {
    mode = m;
    form.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === m));
    app.querySelector('#map-pick').hidden = m !== 'map';
    app.querySelector('#from-field').hidden = m === 'map';
    app.querySelector('#from-div').hidden = m === 'map';
    app.querySelector('#swap').hidden = m === 'map';
    if (m === 'map' && !picker) {
      try {
        picker = await mountPickMap(app.querySelector('#map'), { lat: form.lat.value, lng: form.lng.value, radius: form.radius.value }, onPick);
        onLeave(() => picker.remove());
      } catch (e) { app.querySelector('#map-hint').textContent = e.message; }
    }
  }
  form.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  form.radius.addEventListener('input', () => {
    app.querySelector('#radius-out').textContent = `${form.radius.value} km`;
    picker?.setRadius(Number(form.radius.value));
    showNear();
  });
  app.querySelector('#locate').addEventListener('click', () => {
    if (!('geolocation' in navigator)) { toast('Ta brskalnik ne podpira lokacije.'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = [pos.coords.latitude, pos.coords.longitude];
        if (picker) picker.setPoint(p); else onPick({ lat: p[0].toFixed(5), lng: p[1].toFixed(5) });
      },
      (err) => toast(err.code === 1 ? 'Dovoli dostop do lokacije v nastavitvah brskalnika.' : 'Lokacije ni bilo mogoče določiti.'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });
  setMode(mode);
  showNear();

  // Prihajajoče vožnje: hiter pregled brez iskanja.
  api('/rides/upcoming').then(({ rides }) => {
    const box = app.querySelector('#upcoming');
    if (!box || !rides.length) return;
    box.innerHTML = piece(html`<h2>Prihajajoče vožnje</h2>
      <div class="stack">${rides.map((r) => {
        const via = r.route.slice(1, -1).map(city).filter((c, i, all) => all.indexOf(c) === i && c !== city(r.origin) && c !== city(r.destination));
        return html`<a class="card upcoming" href="#/voznja/${r.id}?${new URLSearchParams({ from: r.origin, to: r.destination, seats: 1 })}">
          <div class="between"><div style="font-weight:700">${city(r.origin)} → ${city(r.destination)}</div><div class="mono" style="font-weight:700">${eur(r.price_per_seat)}</div></div>
          <div class="mono small muted">${fmtWhen(r.departure_at)} · ${r.company_name}</div>
          ${via.length ? html`<div class="small muted">prek ${via.slice(0, 5).join(', ')}${via.length > 5 ? ' …' : ''}</div>` : ''}
          <div class="small" style="margin-top:3px">${r.seats_left} prostih${r.private_allowed ? html` · <span style="color:var(--teal)">zasebno +${eur(r.private_surcharge)}</span>` : ''}</div>
        </a>`;
      })}</div>
      <p class="hint small">Vstopiš lahko tudi na poti — izberi prevzem in izstop na strani vožnje. Cena velja za celo pot, za del poti je nižja.</p>`);
  }).catch(() => {});

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(form);
    const err = form.querySelector('.err');
    const fail = (msg) => { err.textContent = msg; err.hidden = false; };
    if (!d.date) return fail('Izberi datum.');
    if (mode === 'map') {
      if (!d.lat) return fail('Tapni na zemljevid, kjer želiš vstopiti.');
      if (!placesWithin([Number(d.lat), Number(d.lng)], Number(d.radius)).length) return fail('V izbranem radiu ni nobene postaje. Povečaj radij.');
    } else if (d.from === d.to) return fail('Začetek in cilj morata biti različna.');
    sessionStorage.setItem('pv_search', JSON.stringify({ ...d, mode }));
    const { from, lat, lng, radius, ...rest } = d;
    go(`#/iskanje?${new URLSearchParams(mode === 'map' ? { lat, lng, radius, ...rest } : { from, ...rest })}`);
  });
}

async function viewResults({ query }) {
  const q = Object.fromEntries(query.entries());
  const seats = Number(q.seats || 1);
  const byMap = !!q.lat;
  const sub = `${persons(seats)} · ${fmtDay(q.date || '')}${byMap ? ` · v radiu ${q.radius} km` : ''}${q.max_total ? ` · do €${q.max_total}` : ''}`;
  const head = header({ title: `${byMap ? 'Izbrana točka' : city(q.from || '')} → ${city(q.to || '')}`, sub });
  render(html`${head}<main><p class="muted">Iščem prevoze …</p></main>`, { tab: '#/' });

  let rides;
  let near;
  let offerRides = [];
  try {
    ({ rides, near, offer_rides: offerRides = [] } = await api(`/rides/search?${query}`));
  } catch (e) {
    render(html`${head}<main><div class="err">${e.message}</div></main>`, { tab: '#/' });
    return;
  }
  const link = (r, kind) => `#/voznja/${r.id}?${new URLSearchParams({ from: r.pickup, to: q.to, seats, kind })}`;
  const word = rides.length === 1 ? 'ujemanje' : rides.length === 2 ? 'ujemanji' : rides.length <= 4 ? 'ujemanja' : 'ujemanj';
  // Za iskanje potnika: pri iskanju z zemljevida je začetek najbližja postaja v radiu.
  const reqFrom = byMap ? near?.[0]?.place : q.from;

  render(html`${head}<main>
    ${byMap && near ? html`<div class="small muted">${near.length ? html`Postaje v radiu: ${near.map((x, i) => html`${i ? ', ' : ''}<b style="color:var(--ink)">${x.place}</b> (${km(x.km)})`)}` : 'V izbranem radiu ni nobene postaje.'}</div>` : ''}
    ${rides.length ? html`<h2>${rides.length} ${word} na tvoji poti</h2>` : offerRides.length ? '' : html`<div class="card empty">
      <b>Za ta termin še ni prostih voženj.</b>
      <p class="small">Poskusi z daljšim časovnim oknom, drugim dnem ali večjim radijem — ali spodaj obvesti prevoznike, da iščeš prevoz.</p>
      <a class="btn ghost sm" href="#/">Spremeni iskanje</a>
    </div>`}
    ${rides.map((r, i) => {
      const via = r.route.slice(1, -1).map(city).filter((c, j, all) => all.indexOf(c) === j && c !== city(r.origin) && c !== city(r.destination));
      const onWay = r.pickup !== r.origin;
      return html`<article class="ride ${i === 0 ? 'best' : ''}"><div class="in">
        <div class="between">
          <div>
            <div class="name">${r.company_name}</div>
            <div class="meta">${r.carrier_rating ? html`${star(true, 13)}<b style="color:var(--ink)">${String(r.carrier_rating).replace('.', ',')}</b> (${r.carrier_rating_count}) ·` : html`<span>nov prevoznik ·</span>`}
              <span>${r.seats_left} prostih ${r.seats_left === 1 ? 'sedež' : 'sedežev'}</span></div>
          </div>
          ${r.shared_total !== null
            ? html`<div><div class="price">${eur(r.shared_total)}</div><div class="small muted" style="text-align:right">${seats} × ${eur(r.seat_price)}</div></div>`
            : html`<div><div class="price">${eur(r.private_total)}</div><div class="small muted" style="text-align:right">zasebno</div></div>`}
        </div>
        <div class="timebar">${svg(I.clock, { size: 15, stroke: '#5A626C' })}<span>${onWay
          ? html`Prevzem ${city(r.pickup)} ~<b class="mono">${fmtTime(r.pickup_eta)}</b> · vožnja ${city(r.origin)} → ${city(r.destination)}`
          : html`Odhod iz ${city(r.origin)} <b class="mono">${fmtTime(r.departure_at)}</b>${via.length ? ` · prek ${via.slice(0, 4).join(', ')}${via.length > 4 ? ' …' : ''}` : ''}`}</span></div>
        ${byMap ? html`<p class="small muted" style="margin:8px 0 0">Prevzem: <b style="color:var(--ink)">${r.pickup}</b> · ${km(r.pickup_km)} od tvoje točke</p>` : ''}
        ${onWay ? html`<p class="small muted" style="margin:8px 0 0">Pobere te na poti — čas je ocena, točen prevzem potrdi prevoznik.</p>` : ''}
        ${r.shared_total !== null ? html`<a class="btn sm" style="margin-top:12px" href="${link(r, 'shared')}">Rezerviraj deljeno · ${eur(r.shared_total)}</a>` : ''}
        ${r.private_total !== null ? html`<a class="private-offer" href="${link(r, 'private')}"><span>Zasebno · od ${city(r.pickup)} do ${city(q.to)} brez drugih potnikov (+${eur(r.private_surcharge)})</span><b>${eur(r.private_total)}</b></a>` : ''}
      </div></article>`;
    })}
    ${offerRides.length ? html`<h2>Ponudi svojo ceno</h2>
      <p class="small muted" style="margin-top:-6px">Te vožnje so dražje od €${q.max_total}. Pošlji ponudbo — prevoznik jo lahko sprejme ali zavrne.</p>
      ${offerRides.map((r) => html`<article class="ride"><div class="in">
        <div class="between">
          <div><div class="name">${r.company_name}</div>
            <div class="meta"><span>${city(r.pickup)} ~<b class="mono">${fmtTime(r.pickup_eta)}</b> · ${r.seats_left} prostih</span></div></div>
          <div><div class="price" style="text-decoration:line-through;color:var(--faint);font-size:16px">${eur(r.offer_kind === 'private' ? r.private_total : r.shared_total)}</div>
            <div class="price">${eur(r.offer_total)}</div></div>
        </div>
        <a class="btn ghost sm" style="margin-top:12px" href="#/voznja/${r.id}?${new URLSearchParams({ from: r.pickup, to: q.to, seats, kind: r.offer_kind, offer: q.max_total })}">Ponudi €${q.max_total}</a>
      </div></article>`)}` : ''}
    ${reqFrom ? html`<form id="req" class="card stack">
      <div><b>Obvesti prevoznike, da iščeš prevoz</b>
        <p class="small muted" style="margin:4px 0 0">${city(reqFrom)} → ${city(q.to)} · ${fmtDay(q.date)} · ${q.time_from || '00:00'}–${q.time_to || '23:59'} · ${persons(seats)}. Prevozniki na tej liniji vidijo tvoje ime, telefon in ceno, ki si jo pripravljen plačati, ti pa v »Rezervacije« vidiš, ko se pojavi ustrezna vožnja.</p></div>
      <div class="row">
        <div class="box"><label class="field"><span>Največ plačam skupaj (€)</span><input type="number" name="max_total" min="1" step="1" inputmode="decimal" class="mono" value="${q.max_total || ''}" placeholder="neobvezno"></label></div>
      </div>
      <div class="box"><label class="field"><span>Opomba (neobvezno)</span><input name="note" maxlength="300" placeholder="npr. prtljaga, prožen termin"></label></div>
      <div class="err" hidden></div>
      <button class="btn ${rides.length ? 'ghost' : ''} sm" type="submit">Objavi iskanje</button>
    </form>` : ''}
  </main>`, { tab: '#/' });

  const reqForm = app.querySelector('#req');
  reqForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!requireLogin()) return;
    if (state.me.role === 'carrier') { toast('Iskanja objavljajo potniki.'); return; }
    submitting(reqForm, async () => {
      await api('/requests', {
        method: 'POST',
        body: { origin: reqFrom, destination: q.to, date: q.date, time_from: q.time_from, time_to: q.time_to, seats, note: reqForm.note.value, max_total: reqForm.max_total.value },
      });
      toast('Iskanje objavljeno. Prevozniki ga vidijo.');
      go('#/moje');
    });
  });
}

// ---------- potnik: rezervacija ----------

async function viewRide({ params, query }) {
  const head = header({ title: 'Rezervacija' });
  render(html`${head}<main><p class="muted">Nalagam …</p></main>`, { tab: '#/' });
  let ride;
  try {
    ({ ride } = await api(`/rides/${params.id}`));
  } catch (e) {
    render(html`${head}<main><div class="err">${e.message}</div></main>`, { tab: '#/' });
    return;
  }
  const pts = ride.route;
  let pickup = pts.includes(query.get('from')) ? query.get('from') : pts[0];
  let dropoff = pts.includes(query.get('to')) && pts.indexOf(query.get('to')) > pts.indexOf(pickup) ? query.get('to') : pts[pts.length - 1];
  const seatsMax = Math.max(1, Math.min(ride.seats_left, 8));
  let seats = Math.min(Number(query.get('seats') || 1), seatsMax);
  let kind = query.get('kind') === 'private' && ride.private_allowed ? 'private' : 'shared';
  // Ali se odsek prekriva z rezervacijo, ki to preprečuje (zasebni ne deli vozila, deljeni ne z zasebnim).
  const blocked = (a, b, k) => ride.busy.some((x) => a < x.to && x.from < b && (k === 'private' || x.kind === 'private'));

  render(html`${head}<main>
    <div class="between" style="align-items:center">
      <div style="font-size:17px;font-weight:700">${ride.company_name}</div>
      ${ride.carrier_rating ? html`<div class="meta small" style="display:flex;gap:4px;align-items:center">${star(true, 13)}<b>${String(ride.carrier_rating).replace('.', ',')}</b></div>` : html`<span class="small muted">nov prevoznik</span>`}
    </div>
    ${ride.vehicle ? html`<div class="small muted" style="margin-top:-8px">${ride.vehicle}</div>` : ''}

    <form id="book" class="stack" novalidate>
      <div class="card">
        <div class="small muted" style="margin-bottom:6px">Pot vožnje</div>
        <div class="route"><ol id="route"></ol></div>
      </div>
      <div class="card flush">
        <label class="field"><span>Prevzem</span><select name="pickup">${placeOptions(pickup, pts.slice(0, -1))}</select></label>
        <div class="divider"></div>
        <label class="field"><span>Izstop</span><select name="dropoff">${placeOptions(dropoff, pts.slice(1))}</select></label>
      </div>
      <div class="row">
        <div class="stat"><div class="k">Odhod iz ${city(ride.origin)}</div><div class="v">${fmtTime(ride.departure_at)}</div><div class="small muted">${fmtDay(ride.departure_at)}</div></div>
        <div class="box"><label class="field" style="padding:9px 0"><span>Potniki</span><select name="seats">${Array.from({ length: seatsMax }, (_, i) => i + 1).map((n) => html`<option value="${n}" ${n === seats ? raw('selected') : ''}>${persons(n)}</option>`)}</select></label></div>
      </div>
      ${ride.note ? html`<div class="notice teal">${svg(I.info, { size: 17 })}<div><b>Opomba prevoznika:</b> ${ride.note}</div></div>` : ''}
      <div class="notice" id="shared-note">${svg(I.alert, { size: 17, stroke: '#B9770E' })}<div><b>Deljena vožnja.</b> Prevoznik lahko na poti pobere še druge potnike, zato se prihod lahko podaljša${ride.max_detour_min ? ` (največ ~${ride.max_detour_min} min ovinka)` : ''}. Točen čas prevzema ti potrdi prevoznik.</div></div>
      ${ride.private_allowed ? html`<label class="check"><input type="checkbox" name="private" ${kind === 'private' ? raw('checked') : ''}><span><b>Zasebni prevoz</b> (doplačilo ${eur(ride.private_surcharge)}) — od tvojega prevzema do izstopa voznik ne pobira nikogar drugega in pelje direktno.</span></label>
        <div class="small muted" id="private-note" hidden></div>` : ''}
      <div class="card stack">
        <label class="check" style="margin:0"><input type="checkbox" name="offer_on" ${query.get('offer') ? raw('checked') : ''}><span><b>Ponudi svojo ceno</b> — prevoznik jo sprejme ali zavrne.</span></label>
        <div class="box" id="offer-box" hidden><label class="field"><span>Moja ponudba skupaj (€)</span><input type="number" name="offer_total" min="1" step="1" inputmode="decimal" class="mono" value="${query.get('offer') || ''}"></label></div>
        <div class="small muted" id="offer-hint" hidden></div>
      </div>
      <div class="box"><label class="field"><span>Številka leta (neobvezno — če prihajaš z letalom)</span><input name="flight_number" maxlength="12" placeholder="npr. FR1834" class="mono" autocapitalize="characters"></label></div>
      <div class="box"><label class="field"><span>Opomba za prevoznika (neobvezno)</span><textarea name="note" maxlength="500" placeholder="prtljaga, otroški sedež, točno mesto prevzema …"></textarea></label></div>
      <div class="err" hidden></div>
      <div class="sticky-foot">
        <div class="between" style="align-items:center;margin-bottom:10px"><span class="small muted" id="calc"></span><span class="mono" style="font-size:20px;font-weight:700" id="total"></span></div>
        <button class="btn" type="submit" id="book-btn"></button>
        <p class="hint small" style="margin-top:9px">V testni fazi plačaš prevozniku ob vožnji. ${policyText()}</p>
      </div>
    </form>
  </main>`, { tab: '#/' });

  const form = app.querySelector('#book');
  function update() {
    pickup = form.pickup.value;
    dropoff = form.dropoff.value;
    seats = Number(form.seats.value);
    kind = form.private?.checked ? 'private' : 'shared';
    const a = pts.indexOf(pickup);
    const b = pts.indexOf(dropoff);
    app.querySelector('#route').innerHTML = piece(pts.map((p, i) => html`<li class="${i === a || i === b ? 'mine' : ''}"><span class="dot"></span><span>${p}${i === 0 ? html` <span class="mono muted small">${fmtTime(ride.departure_at)}</span>` : ''}${i === a ? ' · prevzem' : i === b ? ' · izstop' : ''}</span></li>`)
      .filter((_, i) => i === 0 || i === pts.length - 1 || i === a || i === b || ride.stops.includes(pts[i]) || (i > a && i < b)));
    const seatPrice = ride.segment_prices[`${a}-${b}`] ?? ride.price_per_seat;
    const total = kind === 'private' ? seatPrice * seats + ride.private_surcharge : seatPrice * seats;
    app.querySelector('#calc').textContent = kind === 'private'
      ? `Zasebno · ${seatsWord(seats)} × ${eur(seatPrice)} + ${eur(ride.private_surcharge)}` : `${seatsWord(seats)} × ${eur(seatPrice)}`;
    const privNote = app.querySelector('#private-note');
    if (privNote) {
      privNote.hidden = !blocked(a, b, 'private');
      privNote.textContent = 'Na tem delu poti so že drugi potniki, zato zasebni prevoz tu ni mogoč.';
    }
    app.querySelector('#total').textContent = eur(total);
    app.querySelector('#shared-note').hidden = kind === 'private';
    const invalid = a >= b;
    const noSeats = seats > ride.seats_left;
    const segBlocked = a < b && blocked(a, b, kind);
    // Ponudba: med 50 % cene (na cel evro navzgor) in ceno po ceniku.
    const offerOn = form.offer_on.checked;
    const minOffer = Math.ceil((total * (state.config.offer_min_percent || 50)) / 10000) * 100;
    const offer = Math.round(Number(form.offer_total.value) * 100);
    app.querySelector('#offer-box').hidden = !offerOn;
    const hint = app.querySelector('#offer-hint');
    hint.hidden = !offerOn;
    hint.textContent = `Cena po ceniku ${eur(total)}. Ponudiš lahko od ${eur(minOffer)} naprej.`;
    const offerBad = offerOn && (!offer || offer < minOffer || offer >= total);
    if (offerOn && offer && offer < total) {
      app.querySelector('#total').innerHTML = piece(html`<s style="color:var(--faint);font-size:15px">${eur(total)}</s> ${eur(offer)}`);
      app.querySelector('#calc').textContent = 'Tvoja ponudba';
    }
    const btn = app.querySelector('#book-btn');
    btn.disabled = invalid || noSeats || offerBad || segBlocked;
    btn.textContent = invalid ? 'Izstop mora biti za prevzemom' : noSeats ? `Prostih je le ${seatsWord(ride.seats_left)}`
      : segBlocked ? (kind === 'private' ? 'Zasebno tu ni mogoče' : 'Ta del poti je rezerviran zasebno')
      : offerBad ? (offer >= total ? 'Ponudba mora biti nižja od cene' : `Ponudba najmanj ${eur(minOffer)}`)
        : !state.me ? 'Prijavi se in rezerviraj'
          : offerOn ? `Pošlji ponudbo · ${eur(offer)}` : `Rezerviraj · ${eur(total)}`;
  }
  form.addEventListener('change', update);
  form.offer_total.addEventListener('input', update);
  update();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!state.me) {
      go(`#/prijava?next=${encodeURIComponent(`#/voznja/${ride.id}?${new URLSearchParams({ from: pickup, to: dropoff, seats, kind, ...(form.offer_on.checked ? { offer: form.offer_total.value } : {}) })}`)}`);
      return;
    }
    if (state.me.role === 'carrier') { toast('Kot prevoznik ne moreš rezervirati. Ustvari ločen potniški račun.'); return; }
    submitting(form, async () => {
      await api('/bookings', {
        method: 'POST',
        body: {
          ride_id: ride.id, pickup, dropoff, seats, kind, flight_number: form.flight_number.value, note: form.note.value,
          offer_total: form.offer_on.checked ? form.offer_total.value : undefined,
        },
      });
      toast(form.offer_on.checked ? 'Ponudba poslana! Prevoznik jo bo sprejel ali zavrnil.' : 'Rezervacija oddana! Prevoznik jo bo potrdil.');
      go('#/moje');
    });
  });
}

// ---------- potnik: moje rezervacije ----------

function policyText() {
  const p = state.config.policy;
  if (!p.cancel_fee) return '';
  return `Odpoved je brezplačna do ${p.free_hours} h pred prevzemom in ${p.grace_min} min po rezervaciji, kasneje ali ob neprihodu je pristojbina ${eur(p.cancel_fee)}. Če voznik zamuja ${p.late_min} min ali več, odpoveš brezplačno.`;
}

function liveHtml(l) {
  if (l.picked_up) return html`<div class="notice teal">${svg(I.van, { size: 17 })}<div>Pobran si — srečno pot!</div></div>`;
  if (!l.driver || !l.eta_at) {
    return html`<div class="notice teal">${svg(I.van, { size: 17 })}<div><b>Voznik je začel vožnjo.</b> Čakam na njegovo lokacijo …</div></div>`;
  }
  const mins = l.eta_in_min;
  const late = l.delay_min >= l.late_threshold_min;
  const cls = late ? 'red' : l.delay_min > 0 ? '' : 'teal';
  const status = late ? html`<b>Voznik zamuja ${l.delay_min} min.</b> Rezervacijo lahko odpoveš brezplačno.`
    : l.delay_min > 0 ? html`Rahla zamuda ~${l.delay_min} min glede na dogovorjen prevzem ob ${fmtTime(l.pickup_time)}.`
      : html`Pravočasno — dogovorjen prevzem ob ${fmtTime(l.pickup_time)}.`;
  const [plat, plng] = l.pickup.coords;
  const key = state.config.maps_embed_key;
  const map = key
    ? html`<iframe title="Zemljevid: voznik in tvoj prevzem" loading="lazy" style="width:100%;height:220px;border:0;border-radius:12px;margin-top:10px" referrerpolicy="no-referrer-when-downgrade"
        src="https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(key)}&origin=${l.driver.lat},${l.driver.lng}&destination=${plat},${plng}&mode=driving"></iframe>`
    : html`<a class="btn ghost sm" style="margin-top:10px" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&origin=${l.driver.lat},${l.driver.lng}&destination=${plat},${plng}&travelmode=driving">${svg(I.nav, { size: 16 })} Poglej voznika na zemljevidu</a>`;
  return html`<div class="live">
    <div class="between" style="align-items:flex-end">
      <div><div class="small muted">Prihod voznika na prevzem</div><div class="mono" style="font-size:26px;font-weight:700">${fmtTime(l.eta_at)}</div></div>
      <div style="text-align:right"><div class="mono" style="font-size:18px;font-weight:700">čez ${mins} min</div>
        <div class="small muted">${l.eta_source === 'google' ? 'promet v živo · Google' : 'ocena brez prometa'}</div></div>
    </div>
    <div class="notice ${cls}" style="margin-top:10px">${svg(late ? I.alert : I.clock, { size: 17 })}<div>${status}</div></div>
    ${map}
    <div class="small muted" style="margin-top:6px">Lokacija voznika posodobljena pred ${l.driver.age_s < 60 ? `${l.driver.age_s} s` : `${Math.round(l.driver.age_s / 60)} min`} · osvežuje se samodejno.</div>
  </div>`;
}

async function viewMyBookings() {
  if (!requireLogin()) return;
  const head = html`<header class="top"><div class="grow"><div class="title" style="font-size:19px;font-weight:700">Moje rezervacije</div></div></header>`;
  render(html`${head}<main><p class="muted">Nalagam …</p></main>`, { tab: '#/moje' });
  const [{ bookings }, { requests }] = await Promise.all([api('/bookings/mine'), api('/requests/mine')]);
  const searchLink = (r) => `#/iskanje?${new URLSearchParams({ from: r.origin, to: r.destination, date: r.date, seats: r.seats, time_from: r.time_from, time_to: r.time_to, ...(r.max_total ? { max_total: r.max_total / 100 } : {}) })}`;
  const upcoming = bookings.filter((b) => ['pending', 'confirmed'].includes(b.status) && isFuture(b.departure_at));
  const pending = upcoming.filter((b) => b.status === 'pending').length;

  render(html`${head}<main>
    ${pending ? html`<div class="notice dark">${svg(I.clock, { size: 18, stroke: '#F5A524' })}<div>${pending === 1 ? '1 rezervacija čaka' : `${pending} rezervacije čakajo`} na potrditev prevoznika. Ko jo potrdi, tukaj vidiš njegov telefon.</div></div>` : ''}
    ${requests.length ? html`<h2>Moja iskanja</h2>${requests.map((r) => html`<article class="card">
      <div class="between"><div style="font-size:16px;font-weight:700">${city(r.origin)} → ${city(r.destination)}</div>
        ${r.matches ? html`<span class="pill ok">${r.matches} ${r.matches === 1 ? 'vožnja' : r.matches === 2 ? 'vožnji' : r.matches <= 4 ? 'vožnje' : 'voženj'}</span>` : html`<span class="pill wait">čakam</span>`}</div>
      <div class="mono small muted" style="margin-top:5px">${fmtDay(r.date)} · ${r.time_from}–${r.time_to} · ${persons(r.seats)}${r.max_total ? ` · do ${eur(r.max_total)}` : ''}</div>
      ${r.note ? html`<div class="small" style="margin-top:4px">„${r.note}“</div>` : ''}
      <p class="small muted" style="margin:6px 0 0">${r.matches ? 'Na tvoji liniji je prosta vožnja — rezerviraj jo.' : 'Prevozniki na tej liniji vidijo tvoje iskanje in te lahko pokličejo.'}</p>
      <div class="btns" style="margin-top:10px">
        ${r.matches ? html`<a class="btn sm" href="${searchLink(r)}">Poglej vožnje</a>` : ''}
        <button class="btn ghost sm" data-close-req="${r.id}">Zapri iskanje</button></div>
    </article>`)}${bookings.length ? html`<h2>Rezervacije</h2>` : ''}` : ''}
    ${bookings.length || requests.length ? '' : html`<div class="card empty"><b>Še nimaš rezervacij.</b><p class="small">Poišči prazno povratno vožnjo med več kot 130 postajami po Sloveniji in sosednjih državah.</p><a class="btn sm" href="#/">Poišči prevoz</a></div>`}
    ${bookings.map((b) => html`<article class="card" data-id="${b.id}">
      <div class="between">
        <div style="font-size:16px;font-weight:700">${city(b.pickup)} → ${city(b.dropoff)} ${b.kind === 'private' ? html`<span class="pill wait" style="vertical-align:middle">zasebno</span>` : ''}</div>
        ${pill(b.status)}
      </div>
      <div class="mono small muted" style="margin-top:5px">${fmtWhen(b.departure_at)} · ${b.company_name}</div>
      <div class="small muted" style="margin-top:4px">${b.pickup} → ${b.dropoff} · ${persons(b.seats)}${b.kind === 'private' ? ' · brez drugih potnikov' : ''}</div>
      ${b.flight_number ? html`<div class="small muted">Let <b class="mono" style="color:var(--ink)">${b.flight_number}</b></div>` : ''}
      ${b.status === 'confirmed' && b.pickup_time ? html`<div class="small" style="margin-top:4px">Dogovorjen prevzem ob <b class="mono">${fmtTime(b.pickup_time)}</b>${b.pickup_time.slice(0, 10) !== b.departure_at.slice(0, 10) ? ` (${fmtDay(b.pickup_time)})` : ''}</div>` : ''}
      ${b.list_total ? html`<div class="small" style="margin-top:4px">${b.status === 'pending' ? html`Tvoja ponudba <b class="mono">${eur(b.total)}</b> (cenik ${eur(b.list_total)}) — čaka, da jo prevoznik sprejme.`
        : ['confirmed', 'completed'].includes(b.status) ? html`<span style="color:var(--green)">Prevoznik je sprejel tvojo ceno ${eur(b.total)}</span> (cenik ${eur(b.list_total)}).`
          : b.status === 'rejected' ? html`Prevoznik ponudbe ${eur(b.total)} ni sprejel. <a href="#/voznja/${b.ride_id}?${new URLSearchParams({ from: b.pickup, to: b.dropoff, seats: b.seats, kind: b.kind })}">Rezerviraj po ceniku</a>` : ''}</div>` : ''}
      ${b.cancel_fee ? html`<div class="small" style="margin-top:4px;color:var(--red)">Pristojbina ${eur(b.cancel_fee)} · ${b.cancel_reason || ''}</div>` : b.cancel_reason && b.status === 'cancelled' ? html`<div class="small muted" style="margin-top:4px">${b.cancel_reason}</div>` : ''}
      ${b.status === 'confirmed' && b.started_at && b.ride_status === 'open' ? html`<div data-live="${b.id}" style="margin-top:10px"><p class="small muted">Nalagam sledenje …</p></div>` : ''}
      ${b.carrier_phone ? html`<a class="btn ghost sm" style="margin-top:10px" href="tel:${b.carrier_phone}">${svg(I.phone, { size: 16 })} Pokliči prevoznika · ${b.carrier_phone}</a>` : ''}
      <div class="between" style="align-items:center;margin-top:10px;padding-top:10px;border-top:1px solid var(--line-soft)">
        <span>${b.status === 'completed' ? (b.rating ? html`<span class="stars" aria-label="Ocena ${b.rating} od 5">${[1, 2, 3, 4, 5].map((n) => star(n <= b.rating, 16))}</span>` : html`<span class="small muted">Oceni vožnjo</span>`) : ''}</span>
        <span class="mono" style="font-size:16px;font-weight:700">${eur(b.total)}</span>
      </div>
      ${b.status === 'completed' && !b.rating ? html`<form class="rate stack" style="margin-top:6px">
        <div class="stars" role="radiogroup" aria-label="Ocena">${[1, 2, 3, 4, 5].map((n) => html`<button type="button" data-star="${n}" aria-label="${n} od 5">${star(false, 26)}</button>`)}</div>
        <input type="hidden" name="rating">
        <div class="box"><label class="field"><span>Komentar (neobvezno)</span><input name="comment" maxlength="500"></label></div>
        <div class="err" hidden></div>
        <button class="btn dark sm" type="submit">Oddaj oceno</button>
      </form>` : ''}
      ${['pending', 'confirmed'].includes(b.status) && !b.picked_up_at && b.ride_status === 'open' ? html`<button class="btn danger sm" style="margin-top:10px" data-cancel="${b.id}">Odpovej rezervacijo</button>` : ''}
    </article>`)}
  </main>`, { tab: '#/moje' });

  app.querySelectorAll('[data-close-req]').forEach((btn) => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await api(`/requests/${btn.dataset.closeReq}/close`, { method: 'POST', body: {} });
      toast('Iskanje zaprto.');
      viewMyBookings();
    } catch (e) { toast(e.message); btn.disabled = false; }
  }));
  app.querySelectorAll('[data-cancel]').forEach((btn) => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const { cancel } = await api(`/bookings/${btn.dataset.cancel}/live`);
      const msg = cancel.free
        ? `Odpoved je brezplačna (${cancel.reason})\n\nRes želiš odpovedati rezervacijo?`
        : `${cancel.reason} Pri odpovedi zdaj platforma zadrži pristojbino ${eur(cancel.fee)}, vrne se ${eur(cancel.refund)}.\n\nRes želiš odpovedati?`;
      if (!confirm(msg)) { btn.disabled = false; return; }
      const res = await api(`/bookings/${btn.dataset.cancel}/cancel`, { method: 'POST', body: {} });
      toast(res.fee ? `Rezervacija odpovedana. Pristojbina ${eur(res.fee)}.` : 'Rezervacija je brezplačno odpovedana.');
      viewMyBookings();
    } catch (e) { toast(e.message); btn.disabled = false; }
  }));

  // Sledenje vozniku: osveževanje vsakih 30 s, dokler je stran odprta.
  const liveEls = [...app.querySelectorAll('[data-live]')];
  async function refreshLive() {
    for (const el of liveEls) {
      try {
        const l = await api(`/bookings/${el.dataset.live}/live`);
        el.innerHTML = piece(liveHtml(l));
      } catch { /* naslednji poskus čez 30 s */ }
    }
  }
  if (liveEls.length) {
    refreshLive();
    const timer = setInterval(refreshLive, 30000);
    onLeave(() => clearInterval(timer));
  }
  app.querySelectorAll('form.rate').forEach((form) => {
    const id = form.closest('[data-id]').dataset.id;
    form.querySelectorAll('[data-star]').forEach((s) => s.addEventListener('click', () => {
      const n = Number(s.dataset.star);
      form.rating.value = n;
      form.querySelectorAll('[data-star]').forEach((x) => { x.innerHTML = piece(star(Number(x.dataset.star) <= n, 26)); x.setAttribute('aria-pressed', Number(x.dataset.star) === n); });
    }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submitting(form, async () => {
        if (!form.rating.value) throw new Error('Izberi število zvezdic.');
        await api(`/bookings/${id}/rate`, { method: 'POST', body: { rating: Number(form.rating.value), comment: form.comment.value } });
        toast('Hvala za oceno!');
        viewMyBookings();
      });
    });
  });
}

// ---------- prijava in registracija ----------

function afterLoginTarget(next) {
  if (next && next.startsWith('#/') && !next.startsWith('#/prijava') && !next.startsWith('#/registracija')) return next;
  return state.me?.role === 'carrier' ? '#/prevoznik' : state.me?.role === 'admin' ? '#/admin' : '#/';
}

function viewLogin({ query }) {
  if (state.me) return go(afterLoginTarget(query.get('next')));
  const next = query.get('next') || '';
  render(html`${header({ title: 'Prijava' })}<main>
    <h1>Dobrodošel nazaj</h1>
    <form id="login" class="stack">
      <div class="card flush">
        <label class="field"><span>E-pošta</span><input type="email" name="email" autocomplete="email" required></label>
        <div class="divider"></div>
        <label class="field"><span>Geslo</span><input type="password" name="password" autocomplete="current-password" required></label>
      </div>
      <div class="err" hidden></div>
      <button class="btn" type="submit">Prijava</button>
    </form>
    <p class="hint">Še nimaš računa? <a href="#/registracija?next=${encodeURIComponent(next)}">Registriraj se</a></p>
  </main>`, { tab: '#/prijava' });
  const form = app.querySelector('#login');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(form, async () => {
      await api('/auth/login', { method: 'POST', body: formData(form) });
      await loadMe();
      go(afterLoginTarget(next));
    });
  });
}

function carrierFieldsHtml(c = {}) {
  return html`
    <h2>Podjetje in licenca</h2>
    <div class="card flush">
      <label class="field"><span>Naziv podjetja ali s.p.</span><input name="company_name" required maxlength="200" value="${c.company_name || ''}" autocomplete="organization"></label>
      <div class="divider"></div>
      <label class="field"><span>Država sedeža</span><select name="country">${[['SI', 'Slovenija'], ['IT', 'Italija'], ['HR', 'Hrvaška'], ['AT', 'Avstrija']].map(([v, l]) => html`<option value="${v}" ${(c.country || 'SI') === v ? raw('selected') : ''}>${l}</option>`)}</select></label>
      <div class="divider"></div>
      <label class="field"><span>Matična številka</span><input name="registration_number" required maxlength="20" inputmode="numeric" value="${c.registration_number || ''}" class="mono"></label>
      <div class="divider"></div>
      <label class="field"><span>Davčna številka / ID za DDV</span><input name="tax_number" maxlength="20" value="${c.tax_number || ''}" class="mono"></label>
    </div>
    <div class="card flush">
      <label class="field"><span>Vrsta licence</span><select name="license_type" required>${Object.entries(LICENSES).map(([v, l]) => html`<option value="${v}" ${(c.license_type || 'potniki_do_8') === v ? raw('selected') : ''}>${l}</option>`)}</select></label>
      <div class="divider"></div>
      <label class="field"><span>Številka licence</span><input name="license_number" required maxlength="50" value="${c.license_number || ''}" class="mono"></label>
      <div class="divider"></div>
      <label class="field"><span>Številka licence Skupnosti (za vožnje čez mejo)</span><input name="community_license_number" maxlength="50" value="${c.community_license_number || ''}" class="mono"></label>
      <div class="divider"></div>
      <label class="field"><span>Licenca velja do</span><input type="date" name="license_valid_until" value="${c.license_valid_until || ''}"></label>
      <div class="divider"></div>
      <label class="field"><span>Vozilo (znamka, model, št. sedežev)</span><input name="vehicle" maxlength="120" value="${c.vehicle || ''}" placeholder="npr. Mercedes Vito, 8 sedežev"></label>
    </div>
    <div class="notice teal">${svg(I.shield, { size: 17 })}<div>Podatke ročno preverimo v uradnih registrih (AJPES in GZS register licenc). Vožnje lahko objaviš, ko je preverba končana — običajno v enem delovnem dnevu.</div></div>`;
}

function viewRegister({ query }) {
  if (state.me) return go(afterLoginTarget(query.get('next')));
  let role = query.get('vloga') === 'prevoznik' ? 'carrier' : 'passenger';
  const next = query.get('next') || '';

  render(html`${header({ title: 'Registracija', carrier: role === 'carrier' })}<main>
    <form id="reg" class="stack" novalidate>
      <div class="seg" role="group" aria-label="Vrsta računa">
        <button type="button" data-role="passenger" aria-pressed="${role === 'passenger'}">Potnik</button>
        <button type="button" data-role="carrier" aria-pressed="${role === 'carrier'}">Prevoznik</button>
      </div>
      <div class="card flush">
        <label class="field"><span>Ime in priimek</span><input name="name" required maxlength="80" autocomplete="name"></label>
        <div class="divider"></div>
        <label class="field"><span>E-pošta</span><input type="email" name="email" required autocomplete="email"></label>
        <div class="divider"></div>
        <label class="field"><span id="phone-label">Telefon</span><input type="tel" name="phone" maxlength="30" autocomplete="tel" placeholder="+386 …"></label>
        <div class="divider"></div>
        <label class="field"><span>Geslo (vsaj 8 znakov)</span><input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
      </div>
      <div id="carrier-fields"></div>
      <label class="check"><input type="checkbox" name="agree" required><span>Razumem, da je Call ride v <b>testni fazi</b> in da se plačilo opravi neposredno pri prevozniku.</span></label>
      <div class="err" hidden></div>
      <button class="btn" type="submit" id="reg-btn">Ustvari račun</button>
    </form>
    <p class="hint">Že imaš račun? <a href="#/prijava?next=${encodeURIComponent(next)}">Prijava</a></p>
  </main>`, { tab: '#/prijava' });

  const form = app.querySelector('#reg');
  function setRole(r) {
    role = r;
    form.querySelectorAll('[data-role]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.role === r));
    app.querySelector('#carrier-fields').innerHTML = r === 'carrier' ? piece(carrierFieldsHtml()) : '';
    app.querySelector('#phone-label').textContent = r === 'carrier' ? 'Telefon (vidijo ga potrjeni potniki)' : 'Telefon (neobvezno, za prevoznika)';
    app.querySelector('header.top').classList.toggle('carrier', r === 'carrier');
    const btn = app.querySelector('#reg-btn');
    btn.classList.toggle('teal', r === 'carrier');
    btn.textContent = r === 'carrier' ? 'Pošlji v preverbo' : 'Ustvari račun';
  }
  form.querySelectorAll('[data-role]').forEach((b) => b.addEventListener('click', () => setRole(b.dataset.role)));
  setRole(role);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(form, async () => {
      if (!form.reportValidity()) throw new Error('Izpolni vsa obvezna polja.');
      const d = formData(form);
      const body = { name: d.name, email: d.email, phone: d.phone, password: d.password, role };
      if (role === 'carrier') {
        body.carrier = Object.fromEntries(['company_name', 'country', 'registration_number', 'tax_number', 'license_type',
          'license_number', 'community_license_number', 'license_valid_until', 'vehicle'].map((k) => [k, d[k]]));
      }
      await api('/auth/register', { method: 'POST', body });
      await loadMe();
      toast(role === 'carrier' ? 'Račun ustvarjen. Podatke bomo preverili.' : 'Dobrodošel v aplikaciji Call ride!');
      go(afterLoginTarget(next));
    });
  });
}

// ---------- profil ----------

function viewProfile() {
  if (!requireLogin()) return;
  const u = state.me;
  const c = state.carrier;
  const roleLabel = { passenger: 'Potnik', carrier: 'Prevoznik', admin: 'Admin' }[u.role];
  render(html`${header({ title: 'Profil', back: false, carrier: u.role === 'carrier' })}<main>
    <div class="card">
      <div style="font-size:18px;font-weight:700">${u.name}</div>
      <div class="muted small">${u.email}${u.phone ? ` · ${u.phone}` : ''}</div>
      <div style="margin-top:8px"><span class="pill gray">${roleLabel}</span></div>
    </div>
    ${c ? html`<div class="card stack">
      <div class="between"><b>${c.company_name}</b>${pill(c.status)}</div>
      <dl class="kv"><dt>Matična</dt><dd class="mono">${c.registration_number}</dd><dt>Licenca</dt><dd>${LICENSES[c.license_type]}<br><span class="mono">${c.license_number}</span></dd>
      ${c.license_valid_until ? html`<dt>Velja do</dt><dd>${c.license_valid_until.split('-').reverse().join('. ')}</dd>` : ''}</dl>
      <a class="btn ghost sm" href="#/prevoznik/podatki">Uredi podatke podjetja</a>
    </div>` : ''}
    <div class="card small" style="line-height:1.5">
      <b>Kako deluje Call ride</b>
      <p style="margin:6px 0 0" class="muted">Prevozniki, ki se vračajo prazni (npr. po prevozu na letališče v Benetkah), objavijo povratno vožnjo. Potniki na poti rezervirajo sedež po nižji ceni ali z doplačilom zasebni prevoz brez drugih potnikov. Prevoznik rezervacijo potrdi, plačilo pa se v testni fazi opravi neposredno pri njem.</p>
    </div>
    <button class="btn ghost" id="logout">Odjava</button>
  </main>`, { tab: '#/profil' });
  app.querySelector('#logout').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST', body: {} });
    state.me = null;
    state.carrier = null;
    go('#/');
  });
}

// ---------- prevoznik ----------

function mapsLink(pts) {
  const q = (p) => encodeURIComponent(p.replace(' — ', ' '));
  const mid = pts.slice(1, -1);
  return `https://www.google.com/maps/dir/?api=1&origin=${q(pts[0])}&destination=${q(pts[pts.length - 1])}${mid.length ? `&waypoints=${mid.map(q).join('%7C')}` : ''}&travelmode=driving`;
}

// Navigacija od trenutne lokacije (brez origin) prek preostalih točk do cilja.
function navFromHere(pts) {
  const q = (p) => encodeURIComponent(p.replace(' — ', ' '));
  const mid = pts.slice(0, -1);
  return `https://www.google.com/maps/dir/?api=1&destination=${q(pts[pts.length - 1])}${mid.length ? `&waypoints=${mid.map(q).join('%7C')}` : ''}&travelmode=driving`;
}

// Točke za navigacijo: začetek, izrecne vmesne točke, prevzemi in izstopi potrjenih potnikov, cilj
// (kraji ob poti, kjer ni nikogar, se samo prevozijo).
function navPoints(r) {
  const used = new Set(r.bookings.filter((b) => ['pending', 'confirmed'].includes(b.status)).flatMap((b) => [b.pickup, b.dropoff]));
  return r.route.filter((p, i) => i === 0 || i === r.route.length - 1 || r.stops.includes(p) || used.has(p));
}

function carrierStatusNotice(c) {
  if (!c) return '';
  if (c.status === 'pending') return html`<div class="notice">${svg(I.clock, { size: 17, stroke: '#B9770E' })}<div><b>Licenca čaka na preverbo.</b> Podatke preverjamo v registrih AJPES in GZS. Ko jih potrdimo, lahko objavljaš vožnje.</div></div>`;
  if (c.status === 'rejected') return html`<div class="notice red">${svg(I.alert, { size: 17 })}<div><b>Preverba ni uspela.</b> ${c.review_note || 'Preveri podatke o licenci.'} <a href="#/prevoznik/podatki">Popravi podatke</a></div></div>`;
  return '';
}

async function viewCarrier() {
  if (!requireLogin()) return;
  if (state.me.role !== 'carrier') return go('#/');
  await loadMe();
  const c = state.carrier;
  const head = header({ title: c?.company_name || 'Prevoznik', sub: 'Prazen povratek = izgubljen prihodek', back: false, carrier: true });
  render(html`${head}<main><p class="muted">Nalagam …</p></main>`, { tab: '#/prevoznik' });
  const [{ rides, commission }, { requests }] = await Promise.all([api('/carrier/rides'), api('/carrier/requests')]);
  const open = rides.filter((r) => r.status === 'open');
  const past = rides.filter((r) => r.status !== 'open');
  const pendingCount = open.reduce((n, r) => n + r.bookings.filter((b) => b.status === 'pending').length, 0);

  const rideCard = (r) => {
    const pts = r.route;
    const taken = r.seats_total - r.seats_left;
    const earned = r.bookings.filter((b) => ['confirmed', 'completed'].includes(b.status)).reduce((s, b) => s + b.total, 0);
    return html`<article class="card" data-ride="${r.id}">
      <div class="between">
        <div><div style="font-size:16px;font-weight:700">${city(r.origin)} → ${city(r.destination)}</div>
          <div class="mono small muted">${fmtWhen(r.departure_at)} · ${taken} / ${r.seats_total} sedežev</div></div>
        ${pill(r.status)}
      </div>
      ${r.route.length > 2 ? html`<div class="small muted" style="margin-top:6px">Na poti: ${r.route.slice(1, -1).map(city).filter((c, i, all) => all.indexOf(c) === i).join(' · ')}</div>` : ''}
      <div class="small muted" style="margin-top:4px">${eur(r.price_per_seat)} / sedež${r.private_allowed ? ` · zasebno +${eur(r.private_surcharge)}` : ''}</div>
      ${(() => { const n = r.status === 'open' ? requests.filter((q) => q.rides.includes(r.id)).length : 0; return n ? html`<button type="button" class="notice teal small" style="margin-top:10px;width:100%;text-align:left;border:none" data-scroll="iskanja">${svg(I.user, { size: 16 })}<div><b>${n}</b> ${n === 1 ? 'potnik išče' : 'potnikov išče'} prevoz na tej vožnji — poglej spodaj.</div></button>` : ''; })()}
      ${r.bookings.length ? '' : html`<p class="small muted" style="margin:10px 0 0">Še ni rezervacij.</p>`}
      ${r.bookings.map((b) => html`<div class="passenger">
        <div class="between">
          <div><b>${b.passenger_name}</b> · ${persons(b.seats)}${b.kind === 'private' ? html` <span class="pill wait">zasebno ${city(b.pickup)}→${city(b.dropoff)}</span>` : ''} ${pill(b.status)}
            <div class="small muted">${city(b.pickup)} → ${city(b.dropoff)}${b.flight_number ? html` · let <b class="mono">${b.flight_number}</b>` : ''}</div>
            ${b.note ? html`<div class="small" style="margin-top:3px">„${b.note}“</div>` : ''}
            ${b.status === 'confirmed' && b.pickup_time ? html`<div class="small">Prevzem ob <b class="mono">${fmtTime(b.pickup_time)}</b>${b.picked_up_at ? html` · <span class="pill ok">pobran</span>` : ''}</div>` : ''}
            ${b.cancel_fee ? html`<div class="small" style="color:var(--red)">Pristojbina ${eur(b.cancel_fee)} · ${b.cancel_reason || ''}</div>` : ''}
            ${['confirmed', 'completed'].includes(b.status) && b.passenger_phone ? html`<a class="small" href="tel:${b.passenger_phone}">${b.passenger_phone}</a>` : ''}
            ${b.rating ? html`<div class="stars">${[1, 2, 3, 4, 5].map((n) => star(n <= b.rating, 13))}</div>` : ''}
          </div>
          <span style="text-align:right">${b.list_total ? html`<s class="mono small" style="color:var(--faint)">${eur(b.list_total)}</s><br>` : ''}<span class="mono" style="font-weight:700">${eur(b.total)}</span></span>
        </div>
        ${b.list_total && b.status === 'pending' ? html`<div class="notice small" style="margin-top:8px">${svg(I.info, { size: 16, stroke: '#B9770E' })}<div><b>Ponudba potnika: ${eur(b.total)}</b> namesto ${eur(b.list_total)}. S potrditvijo ceno sprejmeš.</div></div>` : ''}
        ${r.status === 'open' && b.status === 'pending' ? html`<div class="btns" style="margin-top:10px">
          <button class="btn sm" data-b="${b.id}" data-act="confirm" data-name="${b.passenger_name}" data-pickup="${b.pickup}" data-suggested="${b.suggested_pickup_time || ''}" data-departure="${r.departure_at}" data-offer="${b.list_total ? eur(b.total) : ''}">${b.list_total ? `Sprejmi ${eur(b.total)}` : 'Potrdi'}</button>
          <button class="btn ghost sm" data-b="${b.id}" data-act="reject">Zavrni</button></div>` : ''}
        ${r.status === 'open' && b.status === 'confirmed' && r.started_at && !b.picked_up_at ? html`<div class="btns" style="margin-top:8px">
          <button class="btn teal sm" data-b="${b.id}" data-act="picked_up">Pobran</button>
          <button class="btn ghost sm" data-b="${b.id}" data-act="no_show">Ni prišel</button></div>` : ''}
      </div>`)}
      ${r.status === 'open' ? html`<div class="stack" style="margin-top:12px">
        ${r.started_at
          ? html`<a class="btn teal sm" href="#/prevoznik/v-zivo/${r.id}">${svg(I.nav, { size: 16 })} Vožnja v teku — deli lokacijo</a>`
          : html`<button class="btn teal sm" data-r="${r.id}" data-act="start">${svg(I.nav, { size: 16 })} Začni vožnjo in deli lokacijo</button>`}
        <a class="btn dark sm" href="${mapsLink(navPoints(r))}" target="_blank" rel="noopener">${svg(I.nav, { size: 16, stroke: '#F5A524' })} Navigiraj</a>
        <div class="btns">
          <button class="btn teal sm" data-r="${r.id}" data-act="complete">Zaključi vožnjo</button>
          <button class="btn danger sm" data-r="${r.id}" data-act="cancel">Odpovej</button>
        </div>
      </div>` : ''}
      ${earned ? html`<div class="between small" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line-soft)"><span class="muted">Zaslužek po ${Math.round(commission * 100)} % proviziji</span><b class="mono" style="color:var(--green)">${eur(Math.round(earned * (1 - commission)))}</b></div>` : ''}
    </article>`;
  };

  render(html`${head}<main>
    ${carrierStatusNotice(c)}
    ${pendingCount ? html`<div class="notice dark">${svg(I.alert, { size: 17, stroke: '#F5A524' })}<div><b>${pendingCount}</b> ${pendingCount === 1 ? 'rezervacija čaka' : 'rezervacij čaka'} na tvojo potrditev.</div></div>` : ''}
    ${c?.status === 'approved' ? html`<a class="btn teal" href="#/prevoznik/nova">${svg(I.plus, { size: 18 })} Objavi povratno vožnjo</a>` : ''}
    <h2>Prihajajoče vožnje</h2>
    ${open.length ? open.map(rideCard) : html`<div class="card empty small">Ni objavljenih voženj.</div>`}
    ${c?.status === 'approved' ? html`<h2 id="iskanja">Potniki iščejo prevoz</h2>
      ${requests.length ? requests.slice(0, 30).map((q) => {
        const mine = open.filter((r) => q.rides.includes(r.id));
        return html`<article class="card">
          <div class="between"><div><b>${q.passenger_name}</b> · ${persons(q.seats)}
            <div style="font-size:15px;font-weight:700;margin-top:3px">${city(q.origin)} → ${city(q.destination)}</div>
            <div class="mono small muted">${fmtDay(q.date)} · ${q.time_from}–${q.time_to}</div>
            ${q.max_total ? html`<div class="small" style="margin-top:2px">Pripravljen plačati do <b class="mono">${eur(q.max_total)}</b> skupaj</div>` : ''}
            <div class="small muted">${q.origin} → ${q.destination}</div>
            ${q.note ? html`<div class="small" style="margin-top:3px">„${q.note}“</div>` : ''}</div>
            ${mine.length ? html`<span class="pill ok">na tvoji poti</span>` : ''}</div>
          ${mine.length ? html`<p class="small" style="margin:8px 0 0">Ustreza tvoji vožnji ${mine.map((r) => `${city(r.origin)} → ${city(r.destination)} ob ${fmtTime(r.departure_at)}`).join(', ')}. Pokliči potnika, da rezervira.</p>` : ''}
          <div class="btns" style="margin-top:10px">
            ${q.passenger_phone ? html`<a class="btn ghost sm" href="tel:${q.passenger_phone}">${svg(I.phone, { size: 15 })} Pokliči</a>` : ''}
            ${mine.length ? '' : html`<a class="btn teal sm" href="#/prevoznik/nova?${new URLSearchParams({ from: q.origin, to: q.destination, date: q.date })}">Objavi vožnjo</a>`}
          </div>
        </article>`;
      }) : html`<div class="card empty small">Trenutno nihče ne išče prevoza.</div>`}` : ''}
    ${past.length ? html`<h2>Pretekle in zaključene</h2>${past.map(rideCard)}` : ''}
  </main>`, { tab: '#/prevoznik' });

  bindCarrierActions(viewCarrier);
  app.querySelectorAll('[data-scroll]').forEach((b) => b.addEventListener('click', () => document.getElementById(b.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' })));
}

const CARRIER_CONFIRM = {
  complete: 'Zaključim vožnjo? Potrjene rezervacije bodo označene kot opravljene, nepotrjene pa zavrnjene.',
  cancel: 'Odpovem vožnjo? Vse rezervacije bodo odpovedane — obvesti potnike po telefonu.',
  reject: 'Zavrnem to rezervacijo?',
  no_show: 'Potnik ni prišel na prevzem? Potniku se zaračuna pristojbina za neprihod.',
  start: 'Začnem vožnjo? Potniki bodo videli tvojo lokacijo in čas prihoda, dokler je stran vožnje odprta.',
};
const CARRIER_DONE = {
  confirm: 'Rezervacija potrjena.', reject: 'Rezervacija zavrnjena.', complete: 'Vožnja zaključena.',
  cancel: 'Vožnja odpovedana.', no_show: 'Neprihod zabeležen.', picked_up: 'Potnik pobran.', start: 'Vožnja se je začela.',
};

// Obrazec ob potrditvi rezervacije: čas prevzema s predlogom sistema. Vrne "HH:MM" ali null ob preklicu.
function askPickupTime({ name, pickup, suggested, departure, offer }) {
  const value = suggested ? fmtTime(suggested) : fmtTime(departure);
  const dlg = document.createElement('dialog');
  dlg.innerHTML = piece(html`<form method="dialog">
    <div class="between"><b>Potrdi rezervacijo</b><button class="icon-btn" value="close" aria-label="Zapri" formnovalidate>✕</button></div>
    <div><b>${name}</b><div class="small muted">Prevzem: ${pickup}</div>${offer ? html`<div class="small" style="margin-top:4px">Sprejmeš ponudbo <b>${offer}</b>.</div>` : ''}</div>
    <div class="box"><label class="field"><span>Dogovorjen čas prevzema</span><input type="time" name="time" value="${value}" required class="mono" style="font-size:20px"></label></div>
    <p class="small muted" style="margin:0">Odhod vožnje ob <b class="mono">${fmtTime(departure)}</b>${suggested ? html` · predlog po oceni poti: <button type="button" class="link-btn mono" data-reset>${fmtTime(suggested)}</button>` : ''}<br>
      Potnik vidi ta čas, po njem se računata zamuda in neprihod.</p>
    <div class="btns"><button class="btn ghost sm" value="close" formnovalidate>Prekliči</button><button class="btn sm" type="submit" value="ok">Potrdi</button></div>
  </form>`);
  document.body.append(dlg);
  const form = dlg.querySelector('form');
  dlg.querySelector('[data-reset]')?.addEventListener('click', () => { form.time.value = fmtTime(suggested); form.time.focus(); });
  return new Promise((resolve) => {
    let result = null;
    form.addEventListener('submit', (e) => {
      if (e.submitter?.value !== 'ok') return;
      if (!form.time.value) { e.preventDefault(); form.reportValidity(); return; }
      result = form.time.value;
    });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    dlg.showModal();
  });
}

function bindCarrierActions(reload) {
  app.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', async () => {
    const act = btn.dataset.act;
    const body = {};
    if (act === 'confirm') {
      const t = await askPickupTime(btn.dataset);
      if (t === null) return;
      body.pickup_time = t;
    } else if (CARRIER_CONFIRM[act] && !confirm(CARRIER_CONFIRM[act])) return;
    btn.disabled = true;
    try {
      if (btn.dataset.b) await api(`/bookings/${btn.dataset.b}/${act}`, { method: 'POST', body });
      else await api(`/rides/${btn.dataset.r}/${act}`, { method: 'POST', body });
      toast(CARRIER_DONE[act]);
      if (act === 'start') go(`#/prevoznik/v-zivo/${btn.dataset.r}`);
      else if (act === 'complete' && location.hash.startsWith('#/prevoznik/v-zivo')) go('#/prevoznik');
      else reload();
    } catch (e) { toast(e.message); btn.disabled = false; }
  }));
}

async function viewNewRide({ query }) {
  if (!requireLogin()) return;
  if (state.me.role !== 'carrier') return go('#/');
  await loadMe();
  const c = state.carrier;
  const head = header({ title: 'Nova povratna vožnja', sub: 'Prazen povratek = izgubljen prihodek', carrier: true });
  if (c?.status !== 'approved') {
    render(html`${head}<main>${carrierStatusNotice(c)}</main>`, { tab: '#/prevoznik/nova' });
    return;
  }
  const now = new Date(Date.now() + 3600000);
  const pre = { from: query.get('from'), to: query.get('to'), date: query.get('date') };
  const { requests } = await api('/carrier/requests');
  render(html`${head}<main>
    <form id="ride" class="stack" novalidate>
      <div class="card flush">
        <label class="field"><span>Od</span><select name="origin">${placeOptions(state.places.includes(pre.from) ? pre.from : 'Benetke — letališče Marco Polo (VCE)')}</select></label>
        <div class="divider"></div>
        <label class="field"><span>Do</span><select name="destination">${placeOptions(state.places.includes(pre.to) ? pre.to : 'Ljubljana — avtobusna postaja')}</select></label>
      </div>
      <div class="row">
        <div class="box"><label class="field"><span>Datum</span><input type="date" name="date" value="${pre.date && pre.date >= isoDate(new Date()) ? pre.date : isoDate(now)}" min="${isoDate(new Date())}" required></label></div>
        <div class="box"><label class="field"><span>Odhod</span><input type="time" name="time" value="${pad(now.getHours())}:00" required class="mono"></label></div>
      </div>
      <div class="row">
        <div class="box"><label class="field"><span>Prosti sedeži</span><input type="number" name="seats_total" min="1" max="60" value="8" inputmode="numeric" required class="mono"></label></div>
        <div class="box"><label class="field"><span>Cena na sedež (€)</span><input type="number" name="price_per_seat" min="0" step="1" value="22" inputmode="decimal" required class="mono"></label></div>
      </div>
      <div id="price-tip"></div>
      <div class="box"><label class="field"><span>Največji ovinek za pobiranje (min)</span><input type="number" name="max_detour_min" min="0" max="180" value="20" inputmode="numeric" class="mono"></label></div>
      <div class="card stack">
        <label class="between" style="align-items:center;cursor:pointer"><span><b style="font-size:14px">Dovoli zasebni prevoz</b><br><span class="small muted">potnik doplača, ti pa od njegovega prevzema do izstopa ne pobiraš nikogar</span></span>
          <input type="checkbox" name="private_allowed" style="width:22px;height:22px;accent-color:var(--teal)"></label>
        <div class="box" id="private-price" hidden><label class="field"><span>Doplačilo za zasebni prevoz (€)</span><input type="number" name="private_surcharge" min="0" step="5" value="50" inputmode="decimal" class="mono"></label></div>
        <div class="small muted" id="private-hint" hidden>Potnik plača ceno svojih sedežev + doplačilo. Doplačilo naj pokrije sedeže, ki jih na tem delu ne prodaš — npr. 50 € za krajši, 100 € za daljši odsek.</div>
      </div>
      <div class="card">
        <div class="small muted" style="margin-bottom:9px">Kraji na poti — potniki iz njih te najdejo samodejno. Ovinke (letališča, središča mest) dodaj, če lahko tam pobiraš.</div>
        <div id="stops" style="display:flex;flex-wrap:wrap;gap:8px"></div>
      </div>
      <div id="line-requests"></div>
      <div class="box"><label class="field"><span>Opomba za potnike (neobvezno)</span><textarea name="note" maxlength="500" placeholder="npr. prevzem pred izhodom B, prostor za večjo prtljago"></textarea></label></div>
      <div class="err" hidden></div>
      <div class="sticky-foot"><button class="btn teal" type="submit">Objavi vožnjo</button></div>
    </form>
  </main>`, { tab: '#/prevoznik/nova' });

  const form = app.querySelector('#ride');
  const selected = new Set();
  let route = [];
  // Pot in ovinke izračuna strežnik (cestno omrežje); osvežita se ob vsaki spremembi.
  function drawStops() {
    const box = app.querySelector('#stops');
    const mid = route.slice(1, -1);
    const chips = [
      ...mid.map((p) => (selected.has(p)
        ? html`<button type="button" class="chip" data-stop="${p}" aria-pressed="true">✓ ${p} <span class="muted" style="font-weight:500">ovinek</span></button>`
        : html`<span class="chip auto" title="Na poti — samodejno">✓ ${p}</span>`)),
      ...detours.map((d) => html`<button type="button" class="chip" data-stop="${d.place}" aria-pressed="false">+ ${d.place} <span class="muted" style="font-weight:500">+${d.km} km</span></button>`),
    ];
    box.innerHTML = chips.length ? piece(chips) : '<span class="small muted">Med izbranima točkama ni drugih postaj.</span>';
    box.querySelectorAll('[data-stop]').forEach((chip) => chip.addEventListener('click', () => {
      const p = chip.dataset.stop;
      if (selected.has(p)) selected.delete(p); else selected.add(p);
      drawPrice();
    }));
    drawRequests();
  }
  let detours = [];
  function routeChanged() {
    selected.clear();
    drawPrice();
  }
  // Predlog cene iz prodaje na podobnih poteh; osveži se ob spremembi poti.
  let priceTimer;
  let priceSeq = 0;
  function drawPrice() {
    clearTimeout(priceTimer);
    priceTimer = setTimeout(async () => {
      const seq = ++priceSeq;
      const params = new URLSearchParams({ origin: form.origin.value, destination: form.destination.value });
      selected.forEach((p) => params.append('stop', p));
      const box = app.querySelector('#price-tip');
      if (!box) return;
      let t;
      try { t = await api(`/carrier/price-suggestion?${params}`); } catch { box.innerHTML = ''; return; }
      if (seq !== priceSeq) return;
      route = t.route;
      detours = t.detours.slice(0, 30);
      drawStops();
      box.innerHTML = piece(html`<div class="card stack price-tip">
        <div class="between" style="align-items:center">
          <div><div class="small muted">Predlagana cena na sedež · ${t.km} km</div>
            <div class="mono" style="font-size:24px;font-weight:700">${eur(t.suggested * 100)}</div></div>
          <button type="button" class="btn teal sm" style="width:auto;padding:0 16px" data-use-price="${t.suggested}">Uporabi</button>
        </div>
        ${t.basis === 'data'
          ? html`<div class="small">Na podobnih poteh se je največ sedežev prodalo po <b>${eur(t.range[0] * 100)}–${eur(t.range[1] * 100)}</b> (${t.seats_sold} ${t.seats_sold === 1 ? 'sedež' : 'sedežev'} na ${t.rides_with_sales} ${t.rides_with_sales === 1 ? 'vožnji' : 'vožnjah'}).</div>`
          : html`<div class="small muted">Začetna ocena (${eur(Math.round(t.suggested / t.km * 100))}/km) — na tej liniji je prodanih še premalo sedežev. Predlog se bo izboljševal z vsako prodano vožnjo.</div>`}
        ${t.full_rides_price ? html`<div class="small">${svg(I.van, { size: 14 })} Vožnje, ki so se zapolnile vsaj 75 %, so stale povprečno <b>${eur(t.full_rides_price * 100)}</b>.</div>` : ''}
        ${t.unsold_rides_price ? html`<div class="small" style="color:var(--red)">Vožnje brez potnikov so stale povprečno ${eur(t.unsold_rides_price * 100)} — ta cena potnikov ni privabila.</div>` : ''}
        ${t.open_requests ? html`<div class="small">${svg(I.user, { size: 14 })} Na tej liniji trenutno išče prevoz <b>${t.open_requests}</b> ${t.open_requests === 1 ? 'potnik' : 'potnikov'} (${seatsWord(t.open_request_seats)}).</div>` : ''}
        <div class="small muted">Potniki na delu poti plačajo sorazmerni del cene.</div>
      </div>`);
      box.querySelector('[data-use-price]').addEventListener('click', () => {
        form.price_per_seat.value = t.suggested;
        toast(`Cena nastavljena na ${eur(t.suggested * 100)} na sedež.`);
      });
    }, 250);
  }
  // Iskanja potnikov, ki jih ta vožnja (po trenutni izbiri) lahko pelje na izbrani dan.
  function drawRequests() {
    const fits = requests.filter((q) => q.date === form.date.value
      && route.indexOf(q.origin) !== -1 && route.indexOf(q.origin) < route.indexOf(q.destination));
    app.querySelector('#line-requests').innerHTML = fits.length ? piece(html`<div class="notice teal">${svg(I.user, { size: 17 })}<div>
      <b>${fits.length} ${fits.length === 1 ? 'potnik išče' : 'potnikov išče'} prevoz na tej liniji ${fmtDay(form.date.value)}:</b>
      ${fits.map((q) => html`<div class="small" style="margin-top:4px">${q.passenger_name} · ${city(q.origin)} → ${city(q.destination)} · ${q.time_from}–${q.time_to} · ${persons(q.seats)}</div>`)}
      <div class="small muted" style="margin-top:4px">Ko objaviš vožnjo, jih lahko pokličeš s seznama »Potniki iščejo prevoz«.</div></div></div>`) : '';
  }
  form.origin.addEventListener('change', routeChanged);
  form.destination.addEventListener('change', routeChanged);
  form.date.addEventListener('change', drawRequests);
  form.private_allowed.addEventListener('change', () => {
    app.querySelector('#private-price').hidden = !form.private_allowed.checked;
    app.querySelector('#private-hint').hidden = !form.private_allowed.checked;
  });
  drawPrice();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(form, async () => {
      const d = formData(form);
      if (d.origin === d.destination) throw new Error('Začetek in cilj morata biti različna.');
      await api('/rides', {
        method: 'POST',
        body: {
          origin: d.origin,
          destination: d.destination,
          stops: [...selected],
          departure_at: `${d.date}T${d.time}`,
          seats_total: Number(d.seats_total),
          price_per_seat: Number(d.price_per_seat),
          max_detour_min: Number(d.max_detour_min || 0),
          private_allowed: !!d.private_allowed,
          private_surcharge: d.private_allowed ? Number(d.private_surcharge) : null,
          note: d.note,
        },
      });
      toast('Vožnja je objavljena.');
      go('#/prevoznik');
    });
  });
}

// Voznik med vožnjo: deli GPS lokacijo, vidi potnike po vrstnem redu prevzema.
async function viewDriverLive({ params }) {
  if (!requireLogin()) return;
  if (state.me.role !== 'carrier') return go('#/');
  const head = header({ title: 'Vožnja v teku', sub: 'Lokacija se deli s potniki', carrier: true });
  const { rides } = await api('/carrier/rides');
  const r = rides.find((x) => x.id === Number(params.id));
  if (!r || r.status !== 'open' || !r.started_at) return go('#/prevoznik');
  const pts = r.route;
  const riders = r.bookings.filter((b) => b.status === 'confirmed')
    .sort((a, b) => pts.indexOf(a.pickup) - pts.indexOf(b.pickup));
  const next = riders.find((b) => !b.picked_up_at);
  const nav = navPoints(r);
  const rest = next ? nav.slice(nav.indexOf(next.pickup)) : nav.slice(-1);

  render(html`${head}<main>
    <div class="card" id="gps"><b>GPS</b><div class="small muted">Zaganjam deljenje lokacije …</div></div>
    <div class="notice">${svg(I.info, { size: 17, stroke: '#B9770E' })}<div>Pusti to stran odprto med vožnjo (zaslon ostane prižgan). Za navigacijo odpri Google Maps — ko se vrneš sem, se deljenje nadaljuje.</div></div>
    <a class="btn dark" href="${navFromHere(rest)}" target="_blank" rel="noopener">${svg(I.nav, { size: 18, stroke: '#F5A524' })} Navigiraj${next ? ` do ${city(next.pickup)}` : ' do cilja'}</a>
    <h2>Potniki po vrstnem redu prevzema</h2>
    ${riders.length ? riders.map((b) => html`<article class="card">
      <div class="between"><div><b>${b.passenger_name}</b> · ${b.kind === 'private' ? 'zasebno' : persons(b.seats)}
        <div class="small muted">${b.pickup} → ${city(b.dropoff)}</div>
        ${b.pickup_time ? html`<div class="small">Prevzem ob <b class="mono">${fmtTime(b.pickup_time)}</b></div>` : ''}
        ${b.flight_number ? html`<div class="small muted">Let <b class="mono">${b.flight_number}</b></div>` : ''}
        ${b.note ? html`<div class="small">„${b.note}“</div>` : ''}</div>
        ${b.picked_up_at ? html`<span class="pill ok">pobran</span>` : html`<span class="pill wait">čaka</span>`}</div>
      ${b.picked_up_at ? '' : html`<div class="btns" style="margin-top:10px">
        ${b.passenger_phone ? html`<a class="btn ghost sm" href="tel:${b.passenger_phone}">${svg(I.phone, { size: 15 })} Kliči</a>` : ''}
        <button class="btn teal sm" data-b="${b.id}" data-act="picked_up">Pobran</button>
        <button class="btn ghost sm" data-b="${b.id}" data-act="no_show">Ni prišel</button></div>`}
    </article>`) : html`<div class="card empty small">Na tej vožnji ni potrjenih potnikov.</div>`}
    <button class="btn teal" data-r="${r.id}" data-act="complete">Zaključi vožnjo</button>
  </main>`, { tab: '#/prevoznik', feedback: false });
  bindCarrierActions(() => viewDriverLive({ params }));

  const gps = app.querySelector('#gps');
  const show = (title, text, ok = true) => { gps.innerHTML = piece(html`<b style="color:${ok ? 'var(--teal)' : 'var(--red)'}">${title}</b><div class="small muted">${text}</div>`); };
  if (!('geolocation' in navigator)) { show('GPS ni na voljo', 'Ta brskalnik ne podpira lokacije.', false); return; }

  let lastSent = 0;
  let lastFix = null;
  async function send(force = false) {
    if (!lastFix || (!force && Date.now() - lastSent < 15000)) return;
    lastSent = Date.now();
    try {
      await api(`/rides/${r.id}/location`, { method: 'POST', body: lastFix });
      show('Lokacija se deli', `Zadnja posodobitev ob ${new Date().toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · natančnost ~${Math.round(lastFix.accuracy || 0)} m`);
    } catch (e) { show('Pošiljanje ni uspelo', e.message, false); }
  }
  const watchId = navigator.geolocation.watchPosition(
    (pos) => { lastFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }; send(); },
    (err) => show('Lokacija ni dovoljena', err.code === 1 ? 'Dovoli dostop do lokacije v nastavitvah brskalnika in osveži stran.' : err.message, false),
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
  );
  const timer = setInterval(() => send(true), 30000);
  let lock = null;
  const keepAwake = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch { /* ni podprto */ } };
  const onVisible = () => { if (document.visibilityState === 'visible') { keepAwake(); send(true); } };
  keepAwake();
  document.addEventListener('visibilitychange', onVisible);
  onLeave(() => {
    navigator.geolocation.clearWatch(watchId);
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    lock?.release?.();
  });
}

function viewCarrierDetails() {
  if (!requireLogin()) return;
  if (state.me.role !== 'carrier') return go('#/');
  render(html`${header({ title: 'Podatki podjetja', carrier: true })}<main>
    <form id="cd" class="stack" novalidate>
      ${carrierFieldsHtml(state.carrier || {})}
      <div class="notice">${svg(I.alert, { size: 17, stroke: '#B9770E' })}<div>Po shranjevanju gre račun ponovno v preverbo. Do potrditve ne moreš objavljati novih voženj.</div></div>
      <div class="err" hidden></div>
      <button class="btn teal" type="submit">Shrani in pošlji v preverbo</button>
    </form>
  </main>`, { tab: '#/profil' });
  const form = app.querySelector('#cd');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(form, async () => {
      if (!form.reportValidity()) throw new Error('Izpolni vsa obvezna polja.');
      await api('/me/carrier', { method: 'PUT', body: formData(form) });
      await loadMe();
      toast('Podatki shranjeni.');
      go('#/prevoznik');
    });
  });
}

// ---------- admin ----------

let adminTab = 'carriers';

async function viewAdmin() {
  if (!requireLogin()) return;
  if (state.me.role !== 'admin') return go('#/');
  const head = html`<header class="top"><a class="brand" href="#/admin"><b>Call ride</b><span class="badge-beta">admin</span></a><div class="grow"></div><a class="top-link" href="#/">Potniški pogled</a></header>`;
  render(html`${head}<div class="admin-layout"><p class="muted">Nalagam …</p></div>`, { tab: '#/admin', wide: true, feedback: false });
  const data = await api('/admin/overview');
  const s = data.stats;
  const fill = s.seats_offered ? Math.round((s.seats_sold / s.seats_offered) * 100) : 0;
  const tabs = [
    ['carriers', `Prevozniki${s.carriers_pending ? ` (${s.carriers_pending})` : ''}`],
    ['rides', 'Vožnje'], ['bookings', 'Rezervacije'], ['users', 'Uporabniki'], ['feedback', `Mnenja (${data.feedback.length})`],
  ];
  const ajpes = 'https://www.ajpes.si/prs/';
  const gzs = (c) => `https://www.google.com/search?q=${encodeURIComponent(`GZS register licenc ${c.company_name}`)}`;

  const carriersHtml = html`<div class="admin-grid">${data.carriers.length ? data.carriers.map((c) => html`<article class="card stack">
      <div class="between"><div><b>${c.company_name}</b><div class="small muted">${c.name} · ${c.email}${c.phone ? ` · ${c.phone}` : ''}</div></div>${pill(c.status)}</div>
      <dl class="kv">
        <dt>Država</dt><dd>${c.country}</dd>
        <dt>Matična št.</dt><dd class="mono">${c.registration_number}</dd>
        <dt>Davčna št.</dt><dd class="mono">${c.tax_number || '—'}</dd>
        <dt>Vrsta licence</dt><dd>${LICENSES[c.license_type]}</dd>
        <dt>Št. licence</dt><dd class="mono">${c.license_number}</dd>
        <dt>Licenca Skupnosti</dt><dd class="mono">${c.community_license_number || '—'}</dd>
        <dt>Velja do</dt><dd>${c.license_valid_until || '—'}</dd>
        <dt>Vozilo</dt><dd>${c.vehicle || '—'}</dd>
        <dt>Oddano</dt><dd>${c.created_at}</dd>
        ${c.review_note ? html`<dt>Opomba</dt><dd>${c.review_note}</dd>` : ''}
      </dl>
      <div class="ext-links"><a href="${ajpes}" target="_blank" rel="noopener">AJPES poslovni register ↗</a><a href="${gzs(c)}" target="_blank" rel="noopener">GZS register licenc ↗</a></div>
      ${c.license_type !== 'skupnost' && !c.community_license_number ? html`<div class="notice small">${svg(I.alert, { size: 16, stroke: '#B9770E' })}<div>Brez licence Skupnosti — za vožnje čez mejo (IT ↔ SI) jo prevoznik potrebuje.</div></div>` : ''}
      <div class="btns">
        ${c.status !== 'approved' ? html`<button class="btn teal sm" data-carrier="${c.user_id}" data-act="approve">Potrdi</button>` : ''}
        ${c.status !== 'rejected' ? html`<button class="btn danger sm" data-carrier="${c.user_id}" data-act="reject">Zavrni</button>` : ''}
      </div>
    </article>`) : html`<div class="card empty">Ni prijavljenih prevoznikov.</div>`}</div>`;

  const ridesHtml = html`<div class="table-wrap"><table><thead><tr><th>Odhod</th><th>Relacija</th><th>Prevoznik</th><th>Sedeži</th><th>Cena</th><th>Status</th><th></th></tr></thead><tbody>
    ${data.rides.map((r) => html`<tr><td class="mono">${r.departure_at.replace('T', ' ')}</td><td>${city(r.origin)} → ${city(r.destination)}${r.stops.length ? html`<div class="small muted">prek ${r.stops.map(city).join(', ')}</div>` : ''}</td><td>${r.company_name}</td><td class="mono">${r.seats_total - r.seats_left}/${r.seats_total}</td><td class="mono">${eur(r.price_per_seat)}${r.private_allowed ? html`<div class="small muted">zas. +${eur(r.private_surcharge)}</div>` : ''}</td><td>${pill(r.status)}</td><td>${r.status === 'open' ? html`<button class="btn danger sm" style="height:34px;padding:0 10px" data-ride-cancel="${r.id}">Odpovej</button>` : ''}</td></tr>`)}
  </tbody></table></div>`;

  const bookingsHtml = html`<div class="table-wrap"><table><thead><tr><th>Oddano</th><th>Odhod</th><th>Relacija</th><th>Potnik</th><th>Prevoznik</th><th>Tip</th><th>Znesek</th><th>Status</th><th>Pristojbina</th></tr></thead><tbody>
    ${data.bookings.map((b) => html`<tr><td class="small">${b.created_at}</td><td class="mono">${b.departure_at.replace('T', ' ')}</td><td>${city(b.pickup)} → ${city(b.dropoff)}</td><td>${b.passenger_name}</td><td>${b.company_name}</td><td>${b.kind === 'private' ? `zasebna · ${b.seats}` : `deljena · ${b.seats}`}</td><td class="mono">${eur(b.total)}</td><td>${pill(b.status)}</td><td class="small">${b.cancel_fee ? html`<b class="mono">${eur(b.cancel_fee)}</b> · ${b.cancel_reason || ''}` : b.cancel_reason || ''}</td></tr>`)}
  </tbody></table></div>`;

  const usersHtml = html`<div class="table-wrap"><table><thead><tr><th>Ime</th><th>E-pošta</th><th>Telefon</th><th>Vloga</th><th>Registriran</th></tr></thead><tbody>
    ${data.users.map((u) => html`<tr><td>${u.name}</td><td>${u.email}</td><td>${u.phone || '—'}</td><td>${{ passenger: 'potnik', carrier: 'prevoznik', admin: 'admin' }[u.role]}</td><td class="small">${u.created_at}</td></tr>`)}
  </tbody></table></div>`;

  const feedbackHtml = html`<div class="stack">${data.feedback.length ? data.feedback.map((f) => html`<article class="card"><div class="between small muted"><span>${f.name || 'anonimno'}${f.email ? ` · ${f.email}` : ''}</span><span>${f.created_at} · ${f.page || ''}</span></div><p style="margin:6px 0 0;white-space:pre-wrap">${f.message}</p></article>`) : html`<div class="card empty">Še ni povratnih informacij.</div>`}</div>`;

  const panels = { carriers: carriersHtml, rides: ridesHtml, bookings: bookingsHtml, users: usersHtml, feedback: feedbackHtml };

  render(html`${head}<div class="admin-layout">
    <div><h1 style="font-size:24px">Pregled</h1><div class="muted small">Omrežje postaj SI · IT · HR · AT · DE · HU · SK · RS · testna faza</div></div>
    <div class="kpis">
      <div class="kpi"><div class="k">Provizija (${Math.round(data.commission * 100)} %)</div><div class="v">${eur(s.commission_completed)}</div><div class="s">od opravljenih ${eur(s.revenue_completed)}</div></div>
      <div class="kpi"><div class="k">Opravljene vožnje</div><div class="v">${s.rides_completed}</div><div class="s">${s.rides_upcoming} prihajajočih</div></div>
      <div class="kpi"><div class="k">Zasedenost sedežev</div><div class="v">${fill} %</div><div class="s">${s.seats_sold} / ${s.seats_offered}</div></div>
      <div class="kpi"><div class="k">Rezervacije</div><div class="v">${s.bookings}</div><div class="s">${s.passengers} potnikov</div></div>
      <div class="kpi"><div class="k">Pristojbine za odpoved</div><div class="v">${eur(s.cancel_fees)}</div><div class="s">${s.cancel_fee_count} odpovedi / neprihodov</div></div>
      <div class="kpi"><div class="k">Aktivni prevozniki</div><div class="v">${s.carriers_approved}</div><div class="s">${s.carriers_pending} čaka preverbo</div></div>
    </div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => html`<button role="tab" data-tab="${k}" aria-selected="${adminTab === k}">${l}</button>`)}</div>
    <section id="panel">${panels[adminTab]}</section>
  </div>`, { tab: '#/admin', wide: true, feedback: false });

  app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { adminTab = b.dataset.tab; viewAdmin(); }));
  app.querySelectorAll('[data-carrier]').forEach((btn) => btn.addEventListener('click', async () => {
    const act = btn.dataset.act;
    let note = '';
    if (act === 'reject') {
      note = prompt('Razlog zavrnitve (prevoznik ga vidi):', 'Licence nismo našli v GZS registru.');
      if (note === null) return;
    } else if (!confirm('Potrdim prevoznika? Preveril sem matično v AJPES in licenco v GZS registru.')) return;
    btn.disabled = true;
    try {
      await api(`/admin/carriers/${btn.dataset.carrier}/${act}`, { method: 'POST', body: { note } });
      toast(act === 'approve' ? 'Prevoznik potrjen.' : 'Prevoznik zavrnjen.');
      viewAdmin();
    } catch (e) { toast(e.message); btn.disabled = false; }
  }));
  app.querySelectorAll('[data-ride-cancel]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Odpovem vožnjo in vse njene rezervacije?')) return;
    try {
      await api(`/rides/${btn.dataset.rideCancel}/cancel`, { method: 'POST', body: {} });
      toast('Vožnja odpovedana.');
      viewAdmin();
    } catch (e) { toast(e.message); }
  }));
}

// ---------- usmerjevalnik ----------

const routes = [
  [/^\/$/, viewHome],
  [/^\/iskanje$/, viewResults],
  [/^\/voznja\/(?<id>\d+)$/, viewRide],
  [/^\/moje$/, viewMyBookings],
  [/^\/prijava$/, viewLogin],
  [/^\/registracija$/, viewRegister],
  [/^\/profil$/, viewProfile],
  [/^\/prevoznik$/, viewCarrier],
  [/^\/prevoznik\/nova$/, viewNewRide],
  [/^\/prevoznik\/v-zivo\/(?<id>\d+)$/, viewDriverLive],
  [/^\/prevoznik\/podatki$/, viewCarrierDetails],
  [/^\/admin$/, viewAdmin],
];

async function route() {
  while (cleanups.length) { try { cleanups.pop()(); } catch { /* ignoriraj */ } }
  const { path, query } = parseHash();
  for (const [re, view] of routes) {
    const m = path.match(re);
    if (m) {
      try {
        await view({ params: m.groups || {}, query });
      } catch (e) {
        if (e.status === 401) { state.me = null; go(`#/prijava?next=${encodeURIComponent(location.hash)}`); return; }
        render(html`${header({ title: 'Napaka' })}<main><div class="err">${e.message}</div><a class="btn ghost" href="#/">Na začetek</a></main>`, { tab: '' });
      }
      return;
    }
  }
  go('#/');
}

async function loadMe() {
  const data = await api('/me');
  state.me = data.user;
  state.carrier = data.carrier || null;
}

async function start() {
  try {
    const [, places, config] = await Promise.all([loadMe(), api('/places'), api('/config')]);
    state.places = places.places;
    state.coords = places.coords || {};
    state.country = places.country || {};
    state.countries = places.countries || {};
    state.config = config;
  } catch {
    app.innerHTML = '<main><div class="err">Strežnik trenutno ni dosegljiv. Poskusi znova čez minuto.</div></main>';
    return;
  }
  window.addEventListener('hashchange', route);
  route();
}

start();
