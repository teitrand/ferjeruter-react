-- Siste Fjord1-trafikkmeldingar (éi rad): frå innsamlaren (POST /v1/trafikkmeldinger) eller workeren sin eigen reserve.
-- 0003 fordi 0002_vm_latest ligg i PR #50.
CREATE TABLE IF NOT EXISTS trafikkmeldinger (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fetched_at TEXT NOT NULL,
  fetched_ms INTEGER NOT NULL,
  origin TEXT NOT NULL,
  body TEXT NOT NULL,
  received_at TEXT NOT NULL
);
