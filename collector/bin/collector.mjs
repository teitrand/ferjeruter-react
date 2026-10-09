#!/usr/bin/env node
import { loadConfig } from "../src/config.js";
import { log, run } from "../src/main.js";

run(loadConfig()).catch((error) => {
  log("krasj", { error: String(error?.stack || error) });
  process.exit(1);
});
