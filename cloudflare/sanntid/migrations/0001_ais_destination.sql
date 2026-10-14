-- AIS-destinasjonen per fartøy (t.d. «VALDEROY-STORE KALVO»), berre til «På veg til X» i appen.
-- Dei eldre tabellane (SCHEMA i src/index.js) vart oppretta manuelt før migreringane; dette er den fyrste.
ALTER TABLE ais_latest ADD COLUMN destination TEXT;
