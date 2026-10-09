-- Sledenje vozniku v živo in pravila odpovedi.

ALTER TABLE rides ADD COLUMN started_at TEXT;        -- lokalni čas začetka vožnje
ALTER TABLE rides ADD COLUMN driver_lat REAL;
ALTER TABLE rides ADD COLUMN driver_lng REAL;
ALTER TABLE rides ADD COLUMN driver_pos_ms INTEGER;  -- čas zadnje lokacije (Unix ms)

ALTER TABLE bookings ADD COLUMN confirmed_at TEXT;   -- lokalni čas potrditve
ALTER TABLE bookings ADD COLUMN pickup_time TEXT;    -- dogovorjen čas prevzema, "YYYY-MM-DDTHH:MM"
ALTER TABLE bookings ADD COLUMN picked_up_at TEXT;
ALTER TABLE bookings ADD COLUMN eta_at TEXT;         -- zadnji izračunan prihod voznika na prevzem
ALTER TABLE bookings ADD COLUMN eta_source TEXT;     -- 'google' ali 'ocena'
ALTER TABLE bookings ADD COLUMN eta_computed_ms INTEGER;
ALTER TABLE bookings ADD COLUMN cancelled_at TEXT;
ALTER TABLE bookings ADD COLUMN cancel_fee INTEGER;  -- v centih, ostane platformi
ALTER TABLE bookings ADD COLUMN cancel_reason TEXT;
