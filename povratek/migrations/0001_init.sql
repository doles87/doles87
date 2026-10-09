-- Povratek: začetna shema (Cloudflare D1 / SQLite)

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  name          TEXT NOT NULL,
  phone         TEXT,
  role          TEXT NOT NULL CHECK (role IN ('passenger', 'carrier', 'admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Podatki prevoznika za preverbo licence (ročna preverba v GZS registru licenc + AJPES).
CREATE TABLE carriers (
  user_id                  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company_name             TEXT NOT NULL,
  country                  TEXT NOT NULL DEFAULT 'SI',
  registration_number      TEXT NOT NULL,          -- matična številka
  tax_number               TEXT,                   -- davčna številka / ID za DDV
  license_type             TEXT NOT NULL CHECK (license_type IN ('avtotaksi', 'potniki_do_8', 'avtobus', 'skupnost')),
  license_number           TEXT NOT NULL,
  community_license_number TEXT,                   -- licenca Skupnosti (čezmejni prevozi)
  license_valid_until      TEXT,                   -- YYYY-MM-DD
  vehicle                  TEXT,                   -- npr. "Mercedes Vito, 8 sedežev"
  status                   TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note              TEXT,
  reviewed_at              TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rides (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  carrier_id          INTEGER NOT NULL REFERENCES carriers(user_id),
  origin              TEXT NOT NULL,
  destination         TEXT NOT NULL,
  stops               TEXT NOT NULL DEFAULT '[]', -- JSON seznam vmesnih točk po vrstnem redu
  departure_at        TEXT NOT NULL,              -- lokalni čas, "YYYY-MM-DDTHH:MM"
  seats_total         INTEGER NOT NULL CHECK (seats_total BETWEEN 1 AND 60),
  price_per_seat      INTEGER NOT NULL CHECK (price_per_seat >= 0), -- v centih
  private_allowed     INTEGER NOT NULL DEFAULT 0,
  private_price       INTEGER,                                        -- v centih
  max_detour_min      INTEGER NOT NULL DEFAULT 0,
  note                TEXT,
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_rides_departure ON rides(status, departure_at);
CREATE INDEX idx_rides_carrier ON rides(carrier_id);

CREATE TABLE bookings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id        INTEGER NOT NULL REFERENCES rides(id),
  passenger_id   INTEGER NOT NULL REFERENCES users(id),
  pickup         TEXT NOT NULL,
  dropoff        TEXT NOT NULL,
  seats          INTEGER NOT NULL CHECK (seats >= 1),
  kind           TEXT NOT NULL CHECK (kind IN ('shared', 'private')),
  total          INTEGER NOT NULL, -- v centih
  flight_number  TEXT,
  note           TEXT,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected', 'cancelled', 'completed', 'no_show')),
  rating         INTEGER CHECK (rating BETWEEN 1 AND 5),
  rating_comment TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_bookings_ride ON bookings(ride_id);
CREATE INDEX idx_bookings_passenger ON bookings(passenger_id);

-- Povratne informacije testerjev.
CREATE TABLE feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id),
  page       TEXT,
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
