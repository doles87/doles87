-- Zasebni prevoz na delu poti: potnik doplača znesek, od njegovega prevzema do izstopa voznik ne pobira nikogar.
ALTER TABLE rides ADD COLUMN private_surcharge INTEGER; -- doplačilo v centih (cena = sedeži × cena odseka + doplačilo)
UPDATE rides SET private_surcharge = MAX(COALESCE(private_price, 0) - price_per_seat, 0) WHERE private_allowed = 1;
