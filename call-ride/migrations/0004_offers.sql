-- Ponudba cene: potnik ponudi nižjo ceno, prevoznik jo s potrditvijo sprejme.
ALTER TABLE bookings ADD COLUMN list_total INTEGER;      -- cena po ceniku, ko je potnik ponudil nižjo (total = ponudba)
ALTER TABLE ride_requests ADD COLUMN max_total INTEGER;  -- največ, kar je potnik pripravljen plačati skupaj (v centih)
