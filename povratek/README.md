# Povratek

Platforma za prazne povratne vožnje prevoznikov na koridorju **Benetke ↔ Trst ↔ Postojna ↔ Ljubljana**.
Prevoznik, ki se vrača prazen, objavi vožnjo, potniki na poti pa rezervirajo sedež ali cel kombi.

Tehnologija: en Cloudflare Worker (API + statične datoteke), baza Cloudflare D1, vmesnik v čistem JavaScriptu brez build koraka.

## Kaj zna (testna različica)

**Potnik**
- iskanje po koridorju (od, do, datum, število oseb, časovno okno, največja cena), ujemanje tudi z vmesnimi točkami vožnje
- rezervacija deljene vožnje ali zasebnega najema celega kombija, številka leta, opomba
- moje rezervacije: status, dogovorjen čas prevzema, telefon prevoznika po potrditvi, ocena po vožnji
- **sledenje vozniku v živo**: ko voznik začne vožnjo, potnik vidi predviden prihod na svoj prevzem, zamudo glede na dogovorjen čas in zemljevid; osveževanje vsakih 30 s
- odpoved z jasnim prikazom, ali je brezplačna ali s pristojbino

**Prevoznik**
- registracija s podatki za preverbo (matična, davčna, vrsta in številka licence, licenca Skupnosti, veljavnost, vozilo)
- objava vožnje z vmesnimi točkami, cena na sedež, zasebni najem, največji ovinek
- potrjevanje/zavračanje rezervacij z dogovorjenim časom prevzema (predlog sistema ali ročno)
- **način vožnje v teku**: deli GPS lokacijo iz brskalnika, zaslon ostane prižgan, potniki po vrstnem redu prevzema, gumba Pobran / Ni prišel, navigacija z Google Maps
- zaključek vožnje, prikaz zaslužka po 12 % proviziji

**Admin**
- preverba prevoznikov (Potrdi/Zavrni z razlogom) s povezavami na AJPES in GZS register licenc
- pregled: provizija, vožnje, zasedenost, rezervacije, pristojbine za odpoved, uporabniki, povratne informacije testerjev

**Vsi**: gumb »Mnenje« za povratne informacije med testom.

## Pravila odpovedi

Zasnovano po vzoru Uber Reserve (vnaprej naročene vožnje): brezplačna odpoved do določenega časa pred prevzemom,
kasneje pristojbina; neprihod potnika se obravnava kot pozna odpoved; zamuda voznika omogoči brezplačno odpoved.

| Primer | Pristojbina |
|---|---|
| rezervacija še ni potrjena | brezplačno |
| v 10 min po oddaji rezervacije (če vožnja še ni začeta) | brezplačno |
| več kot 2 h pred dogovorjenim prevzemom (če vožnja še ni začeta) | brezplačno |
| voznik po izračunu v živo zamuja 15 min ali več | brezplačno |
| prevoznik odpove vožnjo | brezplačno |
| manj kot 2 h pred prevzemom ali ko je voznik že na poti | **€4** (največ znesek rezervacije) |
| potnik ni prišel (voznik lahko označi šele 5 min po dogovorjenem prevzemu) | **€4** |

Pristojbina ostane platformi. Vse vrednosti se nastavijo v `wrangler.toml` (`[vars]`) brez spreminjanja kode.

**Pomembno:** v testni fazi se plačuje prevozniku ob vožnji, zato se pristojbina samo *zabeleži* (vidna v adminu)
in se ne bremeni kartice. Za dejansko zaračunavanje je naslednji korak Stripe: ob rezervaciji zadržanje sredstev,
ob zaključku zajem, ob pozni odpovedi zajem pristojbine.

## Sledenje in Google Maps

- Voznik v načinu »Vožnja v teku« pošilja lokacijo vsakih 15–30 s (dokler je stran odprta).
- Strežnik za vsakega potnika izračuna prihod od voznikove lokacije prek prevzemov drugih potnikov pred njim do njegove točke (+3 min za vsak vmesni postanek). Izračun se osveži največ enkrat na minuto na rezervacijo.
- Z ključem `GOOGLE_MAPS_API_KEY` se uporabi **Google Routes API s prometom v živo** (`TRAFFIC_AWARE`). Brez ključa aplikacija uporabi oceno (zračna razdalja × 1,3 pri 75 km/h) in to tudi označi.
- Z ključem `GOOGLE_MAPS_EMBED_KEY` potnik vidi vgrajen zemljevid poti voznik → prevzem, sicer gumb za odpiranje v Google Maps.

Omejitev spletne aplikacije: brskalnik pošilja lokacijo le, ko je stran odprta. Za zanesljivo sledenje v ozadju bo kasneje potrebna mobilna aplikacija za voznike.

### Google ključi (Google Cloud Console)

1. Ustvari projekt in vklopi plačevanje (Google ima mesečni brezplačni obseg).
2. Vklopi **Routes API** in **Maps Embed API**.
3. Ključ 1 (strežnik): omeji na *Routes API* → `npx wrangler secret put GOOGLE_MAPS_API_KEY`
4. Ključ 2 (brskalnik): omeji na *Maps Embed API* in na domeno aplikacije (HTTP referrer) → `npx wrangler secret put GOOGLE_MAPS_EMBED_KEY`

## Postavitev na Cloudflare

```bash
cd povratek
npm install
npx wrangler login
npx wrangler d1 create povratek          # izpisani database_id prilepi v wrangler.toml
npm run db:migrate:remote
npx wrangler secret put ADMIN_EMAILS     # npr. ime@domena.si (ta e-naslov ob registraciji dobi vlogo admin)
npm run deploy
```

Nato se z admin e-naslovom registriraj v aplikaciji in potrjuj prevoznike v zavihku **Admin**.

## Lokalni razvoj in testi

```bash
cd povratek
npm install
printf 'ADMIN_EMAILS="admin@test.si"\nFREE_CANCEL_GRACE_MIN="0"\n' > .dev.vars
npm run db:migrate:local
npm run dev                # http://localhost:8787
npm test                   # v drugem terminalu: celoten tok prek API-ja
```

`FREE_CANCEL_GRACE_MIN="0"` v `.dev.vars` izklopi 10-minutno brezplačno okno, da testi lahko preverijo pristojbino.

## Struktura

```
src/worker.js         API in usmerjanje
src/live.js           sledenje, izračun prihoda (Google Routes API), pravila odpovedi
src/places.js         točke koridorja s koordinatami
migrations/           shema baze D1
public/               vmesnik (index.html, app.js, styles.css)
test/                 testi celotnega toka
```
