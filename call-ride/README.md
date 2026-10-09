# Call ride

Platforma za prazne povratne vožnje prevoznikov po omrežju **138 postaj** (letališča in mesta) v Sloveniji, severni Italiji, na Hrvaškem, v Avstriji, južni Nemčiji, na Madžarskem, Slovaškem in v Srbiji — po vzoru omrežja skupnih prevozov, kot ga ima GoOpti.
Prevoznik, ki se vrača prazen, objavi vožnjo, potniki na poti pa rezervirajo sedež ali cel kombi.

Tehnologija: en Cloudflare Worker (API + statične datoteke), baza Cloudflare D1, vmesnik v čistem JavaScriptu brez build koraka.

## Kaj zna (testna različica)

**Potnik**
- iskanje po koridorju (od, do, datum, število oseb, časovno okno, največja cena), ujemanje tudi z vmesnimi točkami vožnje
- **iskanje na zemljevidu**: tapni točko (ali »Uporabi mojo lokacijo«), izberi radij 1–50 km — najde vožnje, ki ustavijo na kateri od postaj v radiu
- časovno okno se primerja z **ocenjenim časom prevzema na potnikovi točki** (vožnja iz Milana ob 7:00 je v Trstu okoli 12:00)
- **cena odseka**: potnik plača sorazmerni del cene glede na dolžino svojega odseka (zaokroženo na cel evro, najmanj 5 €)
- **objava iskanja**: če ni ustrezne vožnje, potnik objavi, da išče prevoz (lahko tudi z največjo ceno); v »Rezervacije« vidi, ko se pojavi ustrezna vožnja
- **ponudba cene**: potnik pri rezervaciji ponudi nižjo ceno (najmanj 50 % cene po ceniku); pri iskanju z »Največ plačam« so dražje vožnje prikazane v razdelku »Ponudi svojo ceno«. Prevoznik ponudbo sprejme s potrditvijo ali jo zavrne
- rezervacija deljene vožnje ali **zasebnega prevoza**: potnik plača svoje sedeže + doplačilo, ki ga določi prevoznik, in od njegovega prevzema do izstopa voznik ne pobira nikogar (npr. vožnja iz Milana, zasebno od Benetk do Ljubljane; pred Benetkami lahko voznik pelje druge potnike)
- seznam **prihajajočih voženj** (14 dni) na začetni strani, številka leta, opomba
- moje rezervacije: status, dogovorjen čas prevzema, telefon prevoznika po potrditvi, ocena po vožnji
- **sledenje vozniku v živo**: ko voznik začne vožnjo, potnik vidi predviden prihod na svoj prevzem, zamudo glede na dogovorjen čas in zemljevid; osveževanje vsakih 30 s
- odpoved z jasnim prikazom, ali je brezplačna ali s pristojbino

**Prevoznik**
- registracija s podatki za preverbo (matična, davčna, vrsta in številka licence, licenca Skupnosti, veljavnost, vozilo)
- objava vožnje: pot se izračuna po cestnem omrežju; mesta na njej (npr. Milano → Ljubljana: Bergamo, Brescia, Verona, Vicenza, Padova, Mestre, Benetke, Palmanova, Trst, Sežana, Postojna …) so na poti **samodejno**; ovinke (letališča, turistični kraji, mesta izven poti, npr. Koper) aplikacija ponudi z dolžino ovinka in jih prevoznik doda z enim klikom
- **potniki iščejo prevoz**: seznam iskanj na koridorju z oznako »na tvoji poti«, telefon potnika, gumb »Objavi vožnjo« s predizpolnjenim obrazcem; obrazec za novo vožnjo sproti pokaže potnike na izbrani liniji in dan
- potrditev rezervacije z obrazcem: dogovorjen čas prevzema, vnaprej izpolnjen s predlogom po oceni poti; pri ponudbi potnika gumb »Sprejmi €X«
- **predlog cene** pri objavi vožnje: cena na km, po kateri se je na podobnih poteh prodalo največ sedežev (utežena mediana, razpon 25.–75. percentil), povprečje voženj z ≥ 75 % zasedenostjo, opozorilo na ceno voženj brez potnikov in število potnikov, ki iščejo prevoz na liniji. Dokler na podobnih poteh nista prodana vsaj 3 sedeži, je predlog začetna ocena `PRICE_BASELINE_EUR_PER_KM` (0,10 €/km)
- cena na sedež velja za celo pot, zasebni najem, največji ovinek
- potrjevanje/zavračanje rezervacij
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

## Postaje in poti

- `src/places.js`: postaje s koordinatami, državo in vrsto (`city`/`stop` — lahko so samodejno na poti; `airport`/`resort` — le kot začetek, cilj ali izrecni ovinek). Imena so ključ v bazi, zato obstoječih ne spreminjaj; nove dodaš kar v seznam.
- `src/route.js`: cestno omrežje (verige postaj po glavnih cestah z faktorjem za počasnejše regionalne ceste, letališča in turistični kraji kot priključki). Pot vožnje je najkrajša pot skozi izrecne vmesne točke; na poti so še mesta, oddaljena največ 4 km. Nova postaja mora biti povezana v omrežje (`graphCheck()` vrne nepovezane).
- Seznam je sestavljen iz javno dostopnih podatkov o omrežju; koordinate so približne (središče mesta, avtobusna postaja ali letališče).

## Sledenje in Google Maps

- Voznik v načinu »Vožnja v teku« pošilja lokacijo vsakih 15–30 s (dokler je stran odprta).
- Strežnik za vsakega potnika izračuna prihod od voznikove lokacije prek prevzemov drugih potnikov pred njim do njegove točke (+3 min za vsak vmesni postanek). Izračun se osveži največ enkrat na minuto na rezervacijo.
- Z ključem `GOOGLE_MAPS_API_KEY` se uporabi **Google Routes API s prometom v živo** (`TRAFFIC_AWARE`). Brez ključa aplikacija uporabi oceno (zračna razdalja med točkami poti × 1,2 pri 90 km/h) in to tudi označi.
- Z ključem `GOOGLE_MAPS_EMBED_KEY` potnik vidi vgrajen zemljevid poti voznik → prevzem, sicer gumb za odpiranje v Google Maps.

Zemljevid za iskanje je Leaflet z OpenStreetMap (brez ključa); naloži se šele, ko potnik izbere »Na zemljevidu«.

Omejitev spletne aplikacije: brskalnik pošilja lokacijo le, ko je stran odprta. Za zanesljivo sledenje v ozadju bo kasneje potrebna mobilna aplikacija za voznike.

### Google ključi (Google Cloud Console)

1. Ustvari projekt in vklopi plačevanje (Google ima mesečni brezplačni obseg).
2. Vklopi **Routes API** in **Maps Embed API**.
3. Ključ 1 (strežnik): omeji na *Routes API* → `npx wrangler secret put GOOGLE_MAPS_API_KEY`
4. Ključ 2 (brskalnik): omeji na *Maps Embed API* in na domeno aplikacije (HTTP referrer) → `npx wrangler secret put GOOGLE_MAPS_EMBED_KEY`

## Postavitev na Cloudflare

```bash
cd call-ride
npm install
npx wrangler login
npx wrangler d1 create call-ride          # izpisani database_id prilepi v wrangler.toml
npm run db:migrate:remote
npx wrangler secret put ADMIN_EMAILS     # npr. ime@domena.si (ta e-naslov ob registraciji dobi vlogo admin)
npm run deploy
```

Nato se z admin e-naslovom registriraj v aplikaciji in potrjuj prevoznike v zavihku **Admin**.

## Lokalni razvoj in testi

```bash
cd call-ride
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
src/places.js         postaje s koordinatami, državo in vrsto
src/route.js          cestno omrežje, pot vožnje, ponujeni ovinki
migrations/           shema baze D1
public/               vmesnik (index.html, app.js, styles.css)
test/                 testi celotnega toka
```
