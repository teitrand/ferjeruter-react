-- Siste VM-svar (Entur sanntid) per linje, henta av cron i workeren. Appen les /v1/vm, aldri Entur direkte.
CREATE TABLE IF NOT EXISTS vm_latest (line TEXT PRIMARY KEY, body TEXT NOT NULL, fetched_at TEXT NOT NULL);
