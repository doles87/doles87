// Call ride — mobilni spletni vmesnik (brez build koraka).

const app = document.getElementById('app');
const state = { me: null, carrier: null, places: [], config: { policy: {} } };

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

function placeOptions(selected, list = state.places) {
  return list.map((p) => html`<option ${p === selected ? raw('selected') : ''}>${p}</option>`);
}

function requireLogin() {
  if (state.me) return true;
  go(`#/prijava?next=${encodeURIComponent(location.hash)}`);
  return false;
}

// ---------- potnik: iskanje ----------

const KEY_CITIES = ['Benetke', 'Trst', 'Postojna', 'Ljubljana'];

function corridor(from, to) {
  const on = new Set([city(from || ''), city(to || '')]);
  return html`<div class="corridor" aria-hidden="true"><ol>${KEY_CITIES.map((c) => html`<li class="${on.has(c) ? 'on' : ''}"><i></i>${c}</li>`)}</ol></div>`;
}

function loadSearch() {
  try { return JSON.parse(sessionStorage.getItem('pv_search') || 'null'); } catch { return null; }
}

function viewHome() {
  if (state.me?.role === 'carrier') return go('#/prevoznik');
  const saved = loadSearch() || {};
  const today = isoDate(new Date());
  const s = {
    from: state.places[0], to: 'Ljubljana — avtobusna postaja', seats: '1', time_from: '00:00', time_to: '23:59', max_total: '',
    ...saved,
  };
  if (!s.date || s.date < today) s.date = today;

  render(html`${brandHeader()}
  <main>
    <div>
      <div class="muted small" style="font-weight:500">Potnik</div>
      <h1>Kam se peljete<br>nazaj?</h1>
    </div>
    <div id="corr">${corridor(s.from, s.to)}</div>
    <form id="search" class="stack" novalidate>
      <div class="card flush" style="position:relative">
        <label class="field"><span>Od</span><select name="from">${placeOptions(s.from)}</select></label>
        <div class="divider"></div>
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
    ${!state.me ? html`<div class="notice teal">${svg(I.van, { size: 18 })}<div><b>Ste prevoznik?</b> Objavite prazne povratne vožnje in jih zapolnite. <a href="#/registracija?vloga=prevoznik">Registracija prevoznika</a></div></div>` : ''}
  </main>`, { tab: '#/' });

  const form = app.querySelector('#search');
  const refresh = () => { app.querySelector('#corr').innerHTML = piece(corridor(form.from.value, form.to.value)); };
  form.from.addEventListener('change', refresh);
  form.to.addEventListener('change', refresh);
  app.querySelector('#swap').addEventListener('click', () => {
    [form.from.value, form.to.value] = [form.to.value, form.from.value];
    refresh();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(form);
    const err = form.querySelector('.err');
    if (d.from === d.to) { err.textContent = 'Začetek in cilj morata biti različna.'; err.hidden = false; return; }
    if (!d.date) { err.textContent = 'Izberi datum.'; err.hidden = false; return; }
    sessionStorage.setItem('pv_search', JSON.stringify(d));
    go(`#/iskanje?${new URLSearchParams(d)}`);
  });
}

async function viewResults({ query }) {
  const q = Object.fromEntries(query.entries());
  const seats = Number(q.seats || 1);
  const sub = `${persons(seats)} · ${fmtDay(q.date || '')}${q.max_total ? ` · do €${q.max_total}` : ''}`;
  const head = header({ title: `${city(q.from || '')} → ${city(q.to || '')}`, sub });
  render(html`${head}<main><p class="muted">Iščem prevoze …</p></main>`, { tab: '#/' });

  let rides;
  try {
    ({ rides } = await api(`/rides/search?${query}`));
  } catch (e) {
    render(html`${head}<main><div class="err">${e.message}</div></main>`, { tab: '#/' });
    return;
  }
  const link = (r, kind) => `#/voznja/${r.id}?${new URLSearchParams({ from: q.from, to: q.to, seats, kind })}`;
  const word = rides.length === 1 ? 'ujemanje' : rides.length === 2 ? 'ujemanji' : rides.length <= 4 ? 'ujemanja' : 'ujemanj';

  render(html`${head}<main>
    ${rides.length ? html`<h2>${rides.length} ${word} na tvoji poti</h2>` : html`<div class="card empty">
      <b>Za ta termin še ni prostih povratnih voženj.</b>
      <p class="small">Poskusi z daljšim časovnim oknom, drugim dnem ali bližnjo točko (npr. Trst namesto letališča). Prevozniki objavljajo vožnje sproti.</p>
      <a class="btn ghost sm" href="#/">Spremeni iskanje</a>
    </div>`}
    ${rides.map((r, i) => {
      const pts = [r.origin, ...r.stops, r.destination];
      const via = r.stops.map(city).filter((c) => c !== city(r.origin) && c !== city(r.destination));
      return html`<article class="ride ${i === 0 ? 'best' : ''}"><div class="in">
        <div class="between">
          <div>
            <div class="name">${r.company_name}</div>
            <div class="meta">${r.carrier_rating ? html`${star(true, 13)}<b style="color:var(--ink)">${String(r.carrier_rating).replace('.', ',')}</b> (${r.carrier_rating_count}) ·` : html`<span>nov prevoznik ·</span>`}
              <span>${r.seats_left} prostih ${r.seats_left === 1 ? 'sedež' : 'sedežev'}</span></div>
          </div>
          ${r.shared_total !== null
            ? html`<div><div class="price">${eur(r.shared_total)}</div><div class="small muted" style="text-align:right">${seats} × ${eur(r.price_per_seat)}</div></div>`
            : html`<div><div class="price">${eur(r.private_total)}</div><div class="small muted" style="text-align:right">zasebno</div></div>`}
        </div>
        <div class="timebar">${svg(I.clock, { size: 15, stroke: '#5A626C' })}<span>Odhod iz ${city(r.origin)} <b class="mono">${fmtTime(r.departure_at)}</b>${via.length ? ` · prek ${via.join(', ')}` : ''}</span></div>
        ${pts.indexOf(q.from) > 0 ? html`<p class="small muted" style="margin:8px 0 0">Pobere te na poti — točen čas prevzema potrdi prevoznik.</p>` : ''}
        ${r.shared_total !== null ? html`<a class="btn sm" style="margin-top:12px" href="${link(r, 'shared')}">Rezerviraj deljeno · ${eur(r.shared_total)}</a>` : ''}
        ${r.private_total !== null ? html`<a class="private-offer" href="${link(r, 'private')}"><span>Zasebno · cel kombi, brez drugih potnikov</span><b>${eur(r.private_total)}</b></a>` : ''}
      </div></article>`;
    })}
  </main>`, { tab: '#/' });
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
  const pts = [ride.origin, ...ride.stops, ride.destination];
  let pickup = pts.includes(query.get('from')) ? query.get('from') : pts[0];
  let dropoff = pts.includes(query.get('to')) && pts.indexOf(query.get('to')) > pts.indexOf(pickup) ? query.get('to') : pts[pts.length - 1];
  const seatsMax = Math.max(1, Math.min(ride.seats_left, 8));
  let seats = Math.min(Number(query.get('seats') || 1), ride.private_available ? ride.seats_total : seatsMax);
  let kind = query.get('kind') === 'private' && ride.private_available ? 'private' : 'shared';
  if (ride.seats_left < 1 && ride.private_available) kind = 'private';

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
        <div class="box"><label class="field" style="padding:9px 0"><span>Potniki</span><select name="seats">${Array.from({ length: ride.private_available ? Math.min(ride.seats_total, 8) : seatsMax }, (_, i) => i + 1).map((n) => html`<option value="${n}" ${n === seats ? raw('selected') : ''}>${persons(n)}</option>`)}</select></label></div>
      </div>
      ${ride.note ? html`<div class="notice teal">${svg(I.info, { size: 17 })}<div><b>Opomba prevoznika:</b> ${ride.note}</div></div>` : ''}
      <div class="notice" id="shared-note">${svg(I.alert, { size: 17, stroke: '#B9770E' })}<div><b>Deljena vožnja.</b> Prevoznik lahko na poti pobere še druge potnike, zato se prihod lahko podaljša${ride.max_detour_min ? ` (največ ~${ride.max_detour_min} min ovinka)` : ''}. Točen čas prevzema ti potrdi prevoznik.</div></div>
      ${ride.private_available ? html`<label class="check"><input type="checkbox" name="private" ${kind === 'private' ? raw('checked') : ''}><span><b>Raje zasebno</b> (${eur(ride.private_price)} za cel kombi) — direktno, brez pobiranja drugih potnikov.</span></label>` : ''}
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
    app.querySelector('#route').innerHTML = piece(pts.map((p, i) => html`<li class="${i === a || i === b ? 'mine' : ''}"><span class="dot"></span><span>${p}${i === 0 ? html` <span class="mono muted small">${fmtTime(ride.departure_at)}</span>` : ''}${i === a ? ' · prevzem' : i === b ? ' · izstop' : ''}</span></li>`));
    const total = kind === 'private' ? ride.private_price : ride.price_per_seat * seats;
    app.querySelector('#calc').textContent = kind === 'private' ? 'Zasebni najem · cel kombi' : `${seatsWord(seats)} × ${eur(ride.price_per_seat)}`;
    app.querySelector('#total').textContent = eur(total);
    app.querySelector('#shared-note').hidden = kind === 'private';
    const invalid = a >= b;
    const noSeats = kind === 'shared' && seats > ride.seats_left;
    const btn = app.querySelector('#book-btn');
    btn.disabled = invalid || noSeats;
    btn.textContent = invalid ? 'Izstop mora biti za prevzemom' : noSeats ? `Prostih je le ${seatsWord(ride.seats_left)}` : state.me ? `Rezerviraj · ${eur(total)}` : 'Prijavi se in rezerviraj';
  }
  form.addEventListener('change', update);
  update();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!state.me) {
      go(`#/prijava?next=${encodeURIComponent(`#/voznja/${ride.id}?${new URLSearchParams({ from: pickup, to: dropoff, seats, kind })}`)}`);
      return;
    }
    if (state.me.role === 'carrier') { toast('Kot prevoznik ne moreš rezervirati. Ustvari ločen potniški račun.'); return; }
    submitting(form, async () => {
      await api('/bookings', {
        method: 'POST',
        body: { ride_id: ride.id, pickup, dropoff, seats, kind, flight_number: form.flight_number.value, note: form.note.value },
      });
      toast('Rezervacija oddana! Prevoznik jo bo potrdil.');
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
  const { bookings } = await api('/bookings/mine');
  const upcoming = bookings.filter((b) => ['pending', 'confirmed'].includes(b.status) && isFuture(b.departure_at));
  const pending = upcoming.filter((b) => b.status === 'pending').length;

  render(html`${head}<main>
    ${pending ? html`<div class="notice dark">${svg(I.clock, { size: 18, stroke: '#F5A524' })}<div>${pending === 1 ? '1 rezervacija čaka' : `${pending} rezervacije čakajo`} na potrditev prevoznika. Ko jo potrdi, tukaj vidiš njegov telefon.</div></div>` : ''}
    ${bookings.length ? '' : html`<div class="card empty"><b>Še nimaš rezervacij.</b><p class="small">Poišči prazno povratno vožnjo na koridorju Benetke–Ljubljana.</p><a class="btn sm" href="#/">Poišči prevoz</a></div>`}
    ${bookings.map((b) => html`<article class="card" data-id="${b.id}">
      <div class="between">
        <div style="font-size:16px;font-weight:700">${city(b.pickup)} → ${city(b.dropoff)} ${b.kind === 'private' ? html`<span class="pill wait" style="vertical-align:middle">zasebno</span>` : ''}</div>
        ${pill(b.status)}
      </div>
      <div class="mono small muted" style="margin-top:5px">${fmtWhen(b.departure_at)} · ${b.company_name}</div>
      <div class="small muted" style="margin-top:4px">${b.pickup} → ${b.dropoff} · ${b.kind === 'private' ? 'cel kombi' : persons(b.seats)}</div>
      ${b.flight_number ? html`<div class="small muted">Let <b class="mono" style="color:var(--ink)">${b.flight_number}</b></div>` : ''}
      ${b.status === 'confirmed' && b.pickup_time ? html`<div class="small" style="margin-top:4px">Dogovorjen prevzem ob <b class="mono">${fmtTime(b.pickup_time)}</b>${b.pickup_time.slice(0, 10) !== b.departure_at.slice(0, 10) ? ` (${fmtDay(b.pickup_time)})` : ''}</div>` : ''}
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
      <p style="margin:6px 0 0" class="muted">Prevozniki, ki se vračajo prazni (npr. po prevozu na letališče v Benetkah), objavijo povratno vožnjo. Potniki na poti rezervirajo sedež ali cel kombi po nižji ceni. Prevoznik rezervacijo potrdi, plačilo pa se v testni fazi opravi neposredno pri njem.</p>
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
  const { rides, commission } = await api('/carrier/rides');
  const open = rides.filter((r) => r.status === 'open');
  const past = rides.filter((r) => r.status !== 'open');
  const pendingCount = open.reduce((n, r) => n + r.bookings.filter((b) => b.status === 'pending').length, 0);

  const rideCard = (r) => {
    const pts = [r.origin, ...r.stops, r.destination];
    const taken = r.seats_total - r.seats_left;
    const earned = r.bookings.filter((b) => ['confirmed', 'completed'].includes(b.status)).reduce((s, b) => s + b.total, 0);
    return html`<article class="card" data-ride="${r.id}">
      <div class="between">
        <div><div style="font-size:16px;font-weight:700">${city(r.origin)} → ${city(r.destination)}</div>
          <div class="mono small muted">${fmtWhen(r.departure_at)} · ${taken} / ${r.seats_total} sedežev</div></div>
        ${pill(r.status)}
      </div>
      ${r.stops.length ? html`<div class="small muted" style="margin-top:6px">Prek: ${r.stops.join(' · ')}</div>` : ''}
      <div class="small muted" style="margin-top:4px">${eur(r.price_per_seat)} / sedež${r.private_allowed ? ` · zasebno ${eur(r.private_price)}` : ''}</div>
      ${r.bookings.length ? '' : html`<p class="small muted" style="margin:10px 0 0">Še ni rezervacij.</p>`}
      ${r.bookings.map((b) => html`<div class="passenger">
        <div class="between">
          <div><b>${b.passenger_name}</b> · ${b.kind === 'private' ? 'zasebno' : persons(b.seats)} ${pill(b.status)}
            <div class="small muted">${city(b.pickup)} → ${city(b.dropoff)}${b.flight_number ? html` · let <b class="mono">${b.flight_number}</b>` : ''}</div>
            ${b.note ? html`<div class="small" style="margin-top:3px">„${b.note}“</div>` : ''}
            ${b.status === 'confirmed' && b.pickup_time ? html`<div class="small">Prevzem ob <b class="mono">${fmtTime(b.pickup_time)}</b>${b.picked_up_at ? html` · <span class="pill ok">pobran</span>` : ''}</div>` : ''}
            ${b.cancel_fee ? html`<div class="small" style="color:var(--red)">Pristojbina ${eur(b.cancel_fee)} · ${b.cancel_reason || ''}</div>` : ''}
            ${['confirmed', 'completed'].includes(b.status) && b.passenger_phone ? html`<a class="small" href="tel:${b.passenger_phone}">${b.passenger_phone}</a>` : ''}
            ${b.rating ? html`<div class="stars">${[1, 2, 3, 4, 5].map((n) => star(n <= b.rating, 13))}</div>` : ''}
          </div>
          <span class="mono" style="font-weight:700">${eur(b.total)}</span>
        </div>
        ${r.status === 'open' && b.status === 'pending' ? html`<div class="btns" style="margin-top:10px">
          <button class="btn sm" data-b="${b.id}" data-act="confirm">Potrdi</button>
          <button class="btn ghost sm" data-b="${b.id}" data-act="reject">Zavrni</button></div>` : ''}
        ${r.status === 'open' && b.status === 'confirmed' && r.started_at && !b.picked_up_at ? html`<div class="btns" style="margin-top:8px">
          <button class="btn teal sm" data-b="${b.id}" data-act="picked_up">Pobran</button>
          <button class="btn ghost sm" data-b="${b.id}" data-act="no_show">Ni prišel</button></div>` : ''}
      </div>`)}
      ${r.status === 'open' ? html`<div class="stack" style="margin-top:12px">
        ${r.started_at
          ? html`<a class="btn teal sm" href="#/prevoznik/v-zivo/${r.id}">${svg(I.nav, { size: 16 })} Vožnja v teku — deli lokacijo</a>`
          : html`<button class="btn teal sm" data-r="${r.id}" data-act="start">${svg(I.nav, { size: 16 })} Začni vožnjo in deli lokacijo</button>`}
        <a class="btn dark sm" href="${mapsLink(pts)}" target="_blank" rel="noopener">${svg(I.nav, { size: 16, stroke: '#F5A524' })} Navigiraj</a>
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
    ${past.length ? html`<h2>Pretekle in zaključene</h2>${past.map(rideCard)}` : ''}
  </main>`, { tab: '#/prevoznik' });

  bindCarrierActions(viewCarrier);
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

function bindCarrierActions(reload) {
  app.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', async () => {
    const act = btn.dataset.act;
    const body = {};
    if (act === 'confirm') {
      const t = prompt('Dogovorjen čas prevzema za tega potnika (HH:MM).\nPusti prazno, da ga predlaga sistem po oceni poti.', '');
      if (t === null) return;
      if (t.trim()) body.pickup_time = t.trim().replace('.', ':').padStart(5, '0');
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

async function viewNewRide() {
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
  render(html`${head}<main>
    <form id="ride" class="stack" novalidate>
      <div class="card flush">
        <label class="field"><span>Od</span><select name="origin">${placeOptions(state.places[0])}</select></label>
        <div class="divider"></div>
        <label class="field"><span>Do</span><select name="destination">${placeOptions('Ljubljana — avtobusna postaja')}</select></label>
      </div>
      <div class="row">
        <div class="box"><label class="field"><span>Datum</span><input type="date" name="date" value="${isoDate(now)}" min="${isoDate(new Date())}" required></label></div>
        <div class="box"><label class="field"><span>Odhod</span><input type="time" name="time" value="${pad(now.getHours())}:00" required class="mono"></label></div>
      </div>
      <div class="row">
        <div class="box"><label class="field"><span>Prosti sedeži</span><input type="number" name="seats_total" min="1" max="60" value="8" inputmode="numeric" required class="mono"></label></div>
        <div class="box"><label class="field"><span>Cena na sedež (€)</span><input type="number" name="price_per_seat" min="0" step="1" value="22" inputmode="decimal" required class="mono"></label></div>
      </div>
      <div class="box"><label class="field"><span>Največji ovinek za pobiranje (min)</span><input type="number" name="max_detour_min" min="0" max="180" value="20" inputmode="numeric" class="mono"></label></div>
      <div class="card stack">
        <label class="between" style="align-items:center;cursor:pointer"><span><b style="font-size:14px">Dovoli zasebni najem</b><br><span class="small muted">cel kombi za eno skupino · ceno določiš sam</span></span>
          <input type="checkbox" name="private_allowed" style="width:22px;height:22px;accent-color:var(--teal)"></label>
        <div class="box" id="private-price" hidden><label class="field"><span>Cena zasebnega najema (€)</span><input type="number" name="private_price" min="0" step="1" value="90" inputmode="decimal" class="mono"></label></div>
      </div>
      <div class="card">
        <div class="small muted" style="margin-bottom:9px">Vmesne točke, kjer lahko pobiram</div>
        <div id="stops" style="display:flex;flex-wrap:wrap;gap:8px"></div>
      </div>
      <div class="box"><label class="field"><span>Opomba za potnike (neobvezno)</span><textarea name="note" maxlength="500" placeholder="npr. prevzem pred izhodom B, prostor za večjo prtljago"></textarea></label></div>
      <div class="err" hidden></div>
      <div class="sticky-foot"><button class="btn teal" type="submit">Objavi vožnjo</button></div>
    </form>
  </main>`, { tab: '#/prevoznik/nova' });

  const form = app.querySelector('#ride');
  const selected = new Set();
  function drawStops() {
    const a = state.places.indexOf(form.origin.value);
    const b = state.places.indexOf(form.destination.value);
    const between = a < b ? state.places.slice(a + 1, b) : state.places.slice(b + 1, a).reverse();
    [...selected].forEach((s) => { if (!between.includes(s)) selected.delete(s); });
    const box = app.querySelector('#stops');
    box.innerHTML = between.length
      ? piece(between.map((p) => html`<button type="button" class="chip" data-stop="${p}" aria-pressed="${selected.has(p)}">${selected.has(p) ? '✓ ' : '+ '}${p}</button>`))
      : '<span class="small muted">Med izbranima točkama ni vmesnih postaj.</span>';
    box.querySelectorAll('[data-stop]').forEach((chip) => chip.addEventListener('click', () => {
      const p = chip.dataset.stop;
      if (selected.has(p)) selected.delete(p); else selected.add(p);
      drawStops();
    }));
    return between;
  }
  form.origin.addEventListener('change', drawStops);
  form.destination.addEventListener('change', drawStops);
  form.private_allowed.addEventListener('change', () => { app.querySelector('#private-price').hidden = !form.private_allowed.checked; });
  drawStops();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(form, async () => {
      const d = formData(form);
      if (d.origin === d.destination) throw new Error('Začetek in cilj morata biti različna.');
      const between = drawStops();
      await api('/rides', {
        method: 'POST',
        body: {
          origin: d.origin,
          destination: d.destination,
          stops: between.filter((p) => selected.has(p)),
          departure_at: `${d.date}T${d.time}`,
          seats_total: Number(d.seats_total),
          price_per_seat: Number(d.price_per_seat),
          max_detour_min: Number(d.max_detour_min || 0),
          private_allowed: !!d.private_allowed,
          private_price: d.private_allowed ? Number(d.private_price) : null,
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
  const pts = [r.origin, ...r.stops, r.destination];
  const riders = r.bookings.filter((b) => b.status === 'confirmed')
    .sort((a, b) => pts.indexOf(a.pickup) - pts.indexOf(b.pickup));
  const next = riders.find((b) => !b.picked_up_at);
  const rest = next ? [next.pickup, ...pts.slice(pts.indexOf(next.pickup) + 1)] : pts.slice(-1);

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
    ${data.rides.map((r) => html`<tr><td class="mono">${r.departure_at.replace('T', ' ')}</td><td>${city(r.origin)} → ${city(r.destination)}${r.stops.length ? html`<div class="small muted">prek ${r.stops.map(city).join(', ')}</div>` : ''}</td><td>${r.company_name}</td><td class="mono">${r.seats_total - r.seats_left}/${r.seats_total}</td><td class="mono">${eur(r.price_per_seat)}${r.private_allowed ? html`<div class="small muted">zas. ${eur(r.private_price)}</div>` : ''}</td><td>${pill(r.status)}</td><td>${r.status === 'open' ? html`<button class="btn danger sm" style="height:34px;padding:0 10px" data-ride-cancel="${r.id}">Odpovej</button>` : ''}</td></tr>`)}
  </tbody></table></div>`;

  const bookingsHtml = html`<div class="table-wrap"><table><thead><tr><th>Oddano</th><th>Odhod</th><th>Relacija</th><th>Potnik</th><th>Prevoznik</th><th>Tip</th><th>Znesek</th><th>Status</th><th>Pristojbina</th></tr></thead><tbody>
    ${data.bookings.map((b) => html`<tr><td class="small">${b.created_at}</td><td class="mono">${b.departure_at.replace('T', ' ')}</td><td>${city(b.pickup)} → ${city(b.dropoff)}</td><td>${b.passenger_name}</td><td>${b.company_name}</td><td>${b.kind === 'private' ? 'zasebna' : `deljena · ${b.seats}`}</td><td class="mono">${eur(b.total)}</td><td>${pill(b.status)}</td><td class="small">${b.cancel_fee ? html`<b class="mono">${eur(b.cancel_fee)}</b> · ${b.cancel_reason || ''}` : b.cancel_reason || ''}</td></tr>`)}
  </tbody></table></div>`;

  const usersHtml = html`<div class="table-wrap"><table><thead><tr><th>Ime</th><th>E-pošta</th><th>Telefon</th><th>Vloga</th><th>Registriran</th></tr></thead><tbody>
    ${data.users.map((u) => html`<tr><td>${u.name}</td><td>${u.email}</td><td>${u.phone || '—'}</td><td>${{ passenger: 'potnik', carrier: 'prevoznik', admin: 'admin' }[u.role]}</td><td class="small">${u.created_at}</td></tr>`)}
  </tbody></table></div>`;

  const feedbackHtml = html`<div class="stack">${data.feedback.length ? data.feedback.map((f) => html`<article class="card"><div class="between small muted"><span>${f.name || 'anonimno'}${f.email ? ` · ${f.email}` : ''}</span><span>${f.created_at} · ${f.page || ''}</span></div><p style="margin:6px 0 0;white-space:pre-wrap">${f.message}</p></article>`) : html`<div class="card empty">Še ni povratnih informacij.</div>`}</div>`;

  const panels = { carriers: carriersHtml, rides: ridesHtml, bookings: bookingsHtml, users: usersHtml, feedback: feedbackHtml };

  render(html`${head}<div class="admin-layout">
    <div><h1 style="font-size:24px">Pregled</h1><div class="muted small">Koridor Benetke ↔ Ljubljana · testna faza</div></div>
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
    state.config = config;
  } catch {
    app.innerHTML = '<main><div class="err">Strežnik trenutno ni dosegljiv. Poskusi znova čez minuto.</div></main>';
    return;
  }
  window.addEventListener('hashchange', route);
  route();
}

start();
