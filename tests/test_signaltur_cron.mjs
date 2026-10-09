import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import worker, {
  FIRST_CHECK_MS,
  RUNNER_GIVE_UP_MS,
  classifyRun,
  dispatchWorkflow,
  recoverUnacquiredRun,
  runSignalturCron,
} from "../cloudflare/signaltur-cron/src/index.js";

const DISPATCH_URL =
  "https://api.github.com/repos/teitrand/fergeruter/actions/workflows/log-signalturar.yml/dispatches";

test("prøver om att og godtek 204", async () => {
  const calls = [];
  let n = 0;
  const logs = [];
  const ok = await dispatchWorkflow({
    token: "ghp_test",
    fetchImpl: async (url, init) => {
      n += 1;
      calls.push({ url, init });
      if (n < 3) return { status: 500, text: async () => "nei" };
      return { status: 204, text: async () => "" };
    },
    log: (line) => logs.push(line),
    sleep: async () => {},
  });
  assert.equal(ok, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, DISPATCH_URL);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer ghp_test");
  assert.equal(calls[0].init.headers["User-Agent"], "fergeruter-signaltur-cron");
  assert.deepEqual(JSON.parse(calls[0].init.body), { ref: "main" });
  assert.equal(logs.join("\n").includes("ghp_test"), false);
});

test("manglande token hentar ikkje", async () => {
  let called = false;
  const logs = [];
  const ok = await dispatchWorkflow({
    token: "",
    fetchImpl: async () => {
      called = true;
      return { status: 204, text: async () => "" };
    },
    log: (line) => logs.push(line),
    sleep: async () => {},
  });
  assert.equal(ok, false);
  assert.equal(called, false);
  assert.match(logs.join("\n"), /npx wrangler secret put GITHUB_TOKEN/);
});

test("gir opp etter tre forsøk når nettet feilar", async () => {
  let n = 0;
  const ok = await dispatchWorkflow({
    token: "tok",
    fetchImpl: async () => {
      n += 1;
      throw new Error("nett");
    },
    log: () => {},
    sleep: async () => {},
  });
  assert.equal(ok, false);
  assert.equal(n, 3);
});

test("scheduled kastar når dispatch feilar", async () => {
  await assert.rejects(() => worker.scheduled({ cron: "7 4 * * *" }, {}, {}), /log-signalturar/);
});

test("12 minutt er etter treg kø og før GitHub sin 15-minuttsgrense", () => {
  assert.equal(RUNNER_GIVE_UP_MS, 12 * 60 * 1000);
  assert.ok(RUNNER_GIVE_UP_MS > 10.5 * 60 * 1000);
  assert.ok(RUNNER_GIVE_UP_MS < 15 * 60 * 1000);
  assert.ok(RUNNER_GIVE_UP_MS + FIRST_CHECK_MS < 14 * 60 * 1000);
});

test("klassifiserer runner, ekte feil og forgifta køyring", () => {
  assert.equal(classifyRun({ status: "queued" }, [{ runner_id: 0, steps: [] }]), "waiting");
  assert.equal(classifyRun({ status: "in_progress" }, [{ runner_id: 7, steps: [] }]), "acquired");
  assert.equal(
    classifyRun({ status: "in_progress" }, [{ runner_id: 0, steps: [{ name: "Logg" }] }]),
    "acquired",
  );
  assert.equal(
    classifyRun({ status: "completed", conclusion: "success" }, [{ runner_id: 7, steps: [{}] }]),
    "success",
  );
  assert.equal(
    classifyRun({ status: "completed", conclusion: "failure" }, [{ runner_id: 7, steps: [{}] }]),
    "failed",
  );
  assert.equal(
    classifyRun({ status: "completed", conclusion: "failure" }, [{ runner_id: 0, steps: [] }]),
    "poisoned",
  );
});

function jsonResponse(status, body) {
  return {
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function clock() {
  let t = 1_700_000_000_000;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
}

test("ferdig køyring med runner blir ikkje avbroten", async () => {
  const time = clock();
  const calls = [];
  const logs = [];
  const ok = await runSignalturCron({
    token: "ghp_test",
    now: time.now,
    sleep: time.sleep,
    firstCheckMs: 0,
    giveUpMs: 0,
    log: (line) => logs.push(line),
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method });
      if (init.method === "POST" && url.endsWith("/dispatches")) return jsonResponse(204, {});
      if (url.includes("/runs?") || url.endsWith("/runs?per_page=5")) {
        return jsonResponse(200, {
          workflow_runs: [
            {
              id: 10,
              event: "workflow_dispatch",
              status: "completed",
              conclusion: "success",
              created_at: new Date(time.now()).toISOString(),
            },
          ],
        });
      }
      if (url.endsWith("/jobs")) {
        return jsonResponse(200, { jobs: [{ runner_id: 4, steps: [{ name: "Logg" }] }] });
      }
      throw new Error(url);
    },
  });
  assert.equal(ok, true);
  assert.equal(calls.some((call) => call.url.endsWith("/cancel")), false);
  assert.equal(calls.filter((call) => call.url.endsWith("/dispatches")).length, 1);
  assert.equal(logs.join("\n").includes("ghp_test"), false);
});

test("køyring utan runner blir avbroten og starta på nytt", async () => {
  const time = clock();
  const started = time.now();
  const calls = [];
  const logs = [];
  let jobs = 0;
  const ok = await recoverUnacquiredRun({
    token: "ghp_test",
    now: time.now,
    sleep: time.sleep,
    startedAtMs: started,
    firstCheckMs: 0,
    giveUpMs: 0,
    log: (line) => logs.push(line),
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method });
      if (init.method === "POST" && url.endsWith("/cancel")) return jsonResponse(202, {});
      if (init.method === "POST" && url.endsWith("/rerun")) return jsonResponse(201, {});
      if (url.includes("/runs?")) {
        return jsonResponse(200, {
          workflow_runs: [
            {
              id: 10,
              event: "workflow_dispatch",
              status: "queued",
              conclusion: null,
              created_at: new Date(started).toISOString(),
            },
          ],
        });
      }
      if (url.endsWith("/jobs")) {
        jobs += 1;
        const acquired = jobs >= 3;
        return jsonResponse(200, {
          jobs: [{ runner_id: acquired ? 9 : 0, steps: acquired ? [{ name: "Logg" }] : [] }],
        });
      }
      throw new Error(`${init.method} ${url}`);
    },
  });
  assert.equal(ok, true);
  assert.equal(calls.filter((call) => call.url.endsWith("/cancel")).length, 1);
  assert.equal(calls.filter((call) => call.url.endsWith("/rerun")).length, 1);
  assert.equal(calls.filter((call) => call.url.endsWith("/dispatches")).length, 0);
  assert.match(logs.join("\n"), /Avbryt køyring 10/);
  assert.match(logs.join("\n"), /Starta køyring 10 på nytt/);
  assert.equal(logs.join("\n").includes("ghp_test"), false);
});

test("rerun prøver om att når GitHub enno ikkje tek imot avbrotet", async () => {
  const time = clock();
  const started = time.now();
  let reruns = 0;
  const ok = await recoverUnacquiredRun({
    token: "tok",
    now: time.now,
    sleep: time.sleep,
    startedAtMs: started,
    firstCheckMs: 0,
    giveUpMs: 0,
    log: () => {},
    fetchImpl: async (url, init) => {
      if (init.method === "POST" && url.endsWith("/cancel")) return jsonResponse(202, {});
      if (init.method === "POST" && url.endsWith("/rerun")) {
        reruns += 1;
        return jsonResponse(reruns < 2 ? 409 : 201, {});
      }
      if (url.includes("/runs?")) {
        return jsonResponse(200, {
          workflow_runs: [
            {
              id: 10,
              event: "workflow_dispatch",
              status: "in_progress",
              conclusion: null,
              created_at: new Date(started).toISOString(),
            },
          ],
        });
      }
      if (url.endsWith("/jobs")) {
        const acquired = reruns >= 2;
        return jsonResponse(200, {
          jobs: [{ runner_id: acquired ? 8 : 0, steps: acquired ? [{ name: "Logg" }] : [] }],
        });
      }
      throw new Error(`${init.method} ${url}`);
    },
  });
  assert.equal(ok, true);
  assert.equal(reruns, 2);
});

test("ekte feil i stega blir ikkje starta på nytt", async () => {
  const time = clock();
  const calls = [];
  const ok = await recoverUnacquiredRun({
    token: "tok",
    now: time.now,
    sleep: time.sleep,
    startedAtMs: time.now(),
    firstCheckMs: 0,
    giveUpMs: 0,
    log: () => {},
    fetchImpl: async (url, init) => {
      calls.push(url);
      if (url.includes("/runs?")) {
        return jsonResponse(200, {
          workflow_runs: [
            {
              id: 10,
              event: "workflow_dispatch",
              status: "completed",
              conclusion: "failure",
              created_at: new Date(time.now()).toISOString(),
            },
          ],
        });
      }
      if (url.endsWith("/jobs")) {
        return jsonResponse(200, { jobs: [{ runner_id: 3, steps: [{ name: "Logg", conclusion: "failure" }] }] });
      }
      throw new Error(url);
    },
  });
  assert.equal(ok, false);
  assert.equal(calls.some((url) => url.endsWith("/cancel")), false);
  assert.equal(calls.some((url) => url.endsWith("/dispatches")), false);
});

function cronFields(expr) {
  return expr.trim().split(/\s+/);
}

function expandField(field) {
  const values = [];
  for (const part of field.split(",")) {
    if (part.includes("-")) {
      const [from, to] = part.split("-").map(Number);
      for (let value = from; value <= to; value += 1) values.push(value);
    } else {
      values.push(Number(part));
    }
  }
  return values;
}

function cronsFromToml(toml) {
  const block = toml.match(/crons\s*=\s*\[([^\]]*)\]/);
  assert.ok(block, toml);
  return [...block[1].matchAll(/"([^"]+)"/g)].map((hit) => hit[1]);
}

function cronMatches(expr, date) {
  const [minuteField, hourField, day, month, weekday] = cronFields(expr);
  if (day !== "*" || month !== "*" || weekday !== "*") return false;
  return (
    expandField(minuteField).includes(date.getUTCMinutes()) &&
    expandField(hourField).includes(date.getUTCHours())
  );
}

function osloClock(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type).value;
  return {
    date: `${pick("year")}-${pick("month")}-${pick("day")}`,
    hour: Number(pick("hour")),
    minute: Number(pick("minute")),
  };
}

function nextCronAfter(crons, instant) {
  const start = instant.getTime();
  for (let step = 60 * 1000; step <= 6 * 60 * 60 * 1000; step += 60 * 1000) {
    const candidate = new Date(start + step);
    candidate.setUTCSeconds(0, 0);
    if (candidate.getTime() <= start) continue;
    if (crons.some((expr) => cronMatches(expr, candidate))) return candidate;
  }
  return null;
}

test("wrangler har kveldskøyring som ikkje blir midnatt i Oslo", () => {
  const toml = readFileSync(new URL("../cloudflare/signaltur-cron/wrangler.toml", import.meta.url), "utf8");
  const crons = cronsFromToml(toml);
  assert.deepEqual(crons, ["7,37 4-21 * * *"]);
  assert.equal(toml.includes("7 22"), false);
  // Arbeidsflyten for signalturar ligg berre i det gamle fergeruter-repoet.
  const workflowUrl = new URL("../.github/workflows/log-signalturar.yml", import.meta.url);
  if (existsSync(workflowUrl)) {
    const workflow = readFileSync(workflowUrl, "utf8");
    assert.match(workflow, /cron: "7,37 4-21 \* \* \*"/);
    assert.equal(workflow.includes('cron: "7 22 * * *"'), false);
  }

  const summerArrival = new Date("2026-07-15T20:35:00+02:00");
  const winterArrival = new Date("2026-01-14T20:35:00+01:00");
  for (const arrival of [summerArrival, winterArrival]) {
    const next = nextCronAfter(crons, arrival);
    assert.ok(next, arrival.toISOString());
    assert.ok(next.getTime() - arrival.getTime() <= 30 * 60 * 1000, next.toISOString());
    assert.equal(osloClock(next).date, osloClock(arrival).date);
  }

  const summerLast = new Date(Date.UTC(2026, 6, 15, 21, 37));
  const winterLast = new Date(Date.UTC(2026, 0, 14, 21, 37));
  assert.equal(crons.some((expr) => cronMatches(expr, summerLast)), true);
  assert.equal(crons.some((expr) => cronMatches(expr, winterLast)), true);
  assert.equal(osloClock(summerLast).hour, 23);
  assert.equal(osloClock(summerLast).date, "2026-07-15");
  assert.equal(osloClock(winterLast).hour, 22);
  assert.equal(osloClock(winterLast).date, "2026-01-14");
  const summerMidnight = new Date(Date.UTC(2026, 6, 15, 22, 7));
  assert.equal(osloClock(summerMidnight).date, "2026-07-16");
  assert.equal(crons.some((expr) => cronMatches(expr, summerMidnight)), false);
});
