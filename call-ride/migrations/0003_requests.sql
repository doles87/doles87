-- Iskanja potnikov: potnik objavi, da išče prevoz; prevozniki jih vidijo na svoji liniji.
CREATE TABLE ride_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  passenger_id INTEGER NOT NULL REFERENCES users(id),
  origin       TEXT NOT NULL,
  destination  TEXT NOT NULL,
  date         TEXT NOT NULL,                -- "YYYY-MM-DD"
  time_from    TEXT NOT NULL DEFAULT '00:00',
  time_to      TEXT NOT NULL DEFAULT '23:59',
  seats        INTEGER NOT NULL DEFAULT 1 CHECK (seats >= 1),
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_requests_open ON ride_requests(status, date);
CREATE INDEX idx_requests_passenger ON ride_requests(passenger_id);
