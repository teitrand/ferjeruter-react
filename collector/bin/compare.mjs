#!/usr/bin/env node
/** npm run compare [-- --date ÅÅÅÅ-MM-DD]. Standard: i går (Oslo). */
import { existsSync } from "node:fs";
import { compareDay, writeReport } from "../src/compare.js";
import { loadConfig } from "../src/config.js";
import { loadData } from "../src/data.js";
import { openDb } from "../src/db.js";
import { osloDate } from "../src/time.js";

const cfg = loadConfig();
const i = process.argv.indexOf("--date");
const date = i > 0 ? process.argv[i + 1] : osloDate(Date.now() - 86400000);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
  console.error("Bruk: npm run compare -- --date ÅÅÅÅ-MM-DD");
  process.exit(2);
}
if (!existsSync(cfg.dbPath)) {
  console.error(`Fann ikkje databasen ${cfg.dbPath}`);
  process.exit(1);
}
const db = openDb(cfg.dbPath, { retentionDays: cfg.retentionDays });
const data = await loadData(cfg, { log: (msg, extra) => console.error(msg, JSON.stringify(extra)) });
const report = compareDay({ data, db, date, lines: cfg.lines });
const files = writeReport(report, cfg.reportDir);
db.close();
console.log(JSON.stringify({ msg: "samanlikning", date, ...report.totals, files }));
