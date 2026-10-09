import assert from "node:assert/strict";
import test from "node:test";
import { HEALTHY_AFTER_MS, PING_EVERY_MS, PONG_TIMEOUT_MS, createStream } from "../src/stream.js";

/** Falsk klokke og timarar. */
function fakeTime() {
  const t = { now: Date.parse("2026-10-09T08:00:00Z"), timers: [] };
  t.set = (fn, ms) => {
    const timer = { at: t.now + ms, fn };
    t.timers.push(timer);
    return timer;
  };
  t.clear = (timer) => {
    t.timers = t.timers.filter((x) => x !== timer);
  };
  t.advance = (ms) => {
    const end = t.now + ms;
    for (;;) {
      t.timers.sort((a, b) => a.at - b.at);
      const next = t.timers[0];
      if (!next || next.at > end) break;
      t.timers.shift();
      t.now = next.at;
      next.fn();
    }
    t.now = end;
  };
  return t;
}

function fakeSocketClass() {
  const sockets = [];
  class FakeSocket {
    constructor(url, opts) {
      this.url = url;
      this.opts = opts;
      this.sent = [];
      sockets.push(this);
    }
    send(text) {
      this.sent.push(JSON.parse(text));
    }
    close() {
      this.closed = true;
    }
    serverSends(msg) {
      this.onmessage?.({ data: JSON.stringify(msg) });
    }
  }
  return { FakeSocket, sockets };
}

test("init med ET-Client-Name, éin subscribe per linje, pong på ping, posisjonar ut", () => {
  const time = fakeTime();
  const { FakeSocket, sockets } = fakeSocketClass();
  const got = [];
  const stream = createStream({
    lines: ["1136", "1135"],
    onVehicle: (live) => got.push(live),
    WebSocketImpl: FakeSocket,
    now: () => time.now,
    setTimer: time.set,
    clearTimer: time.clear,
  });
  stream.start();
  const ws = sockets[0];
  assert.deepEqual(ws.opts.protocols, ["graphql-transport-ws"]);
  assert.equal(ws.opts.headers["ET-Client-Name"], "teitrand-fergeruter-innsamlar");
  ws.onopen();
  assert.equal(ws.sent[0].payload["ET-Client-Name"], "teitrand-fergeruter-innsamlar");
  ws.sent.length = 0;
  ws.onopen();
  assert.equal(ws.sent[0].type, "connection_init");
  ws.serverSends({ type: "connection_ack" });
  assert.equal(stream.state.connected, true);
  assert.deepEqual(ws.sent.filter((m) => m.type === "subscribe").map((m) => m.id), ["1136", "1135"]);
  ws.serverSends({ type: "ping" });
  assert.equal(ws.sent.at(-1).type, "pong");
  ws.serverSends({
    id: "1136",
    type: "next",
    payload: { data: { vehicles: [{ lastUpdated: "2026-10-09T08:00:00Z", expiration: "2026-10-09T08:02:00Z", line: { publicCode: "1136" }, location: { latitude: 62.2, longitude: 6.5 } }] } },
  });
  assert.equal(got.length, 1);
  assert.equal(got[0].line, "1136");
  assert.equal(stream.state.vehicles, 1);
  stream.stop();
});

test("brot gjev ny tilkopling etter 15 s, så 30 s, og aldri tettare enn grensa", () => {
  const time = fakeTime();
  const { FakeSocket, sockets } = fakeSocketClass();
  const stream = createStream({
    lines: ["1136"],
    onVehicle: () => {},
    WebSocketImpl: FakeSocket,
    now: () => time.now,
    setTimer: time.set,
    clearTimer: time.clear,
  });
  stream.start();
  const opened = [time.now];
  for (let i = 0; i < 6; i++) {
    const ws = sockets.at(-1);
    ws.onclose({ code: 1006, reason: "" });
    const before = sockets.length;
    while (sockets.length === before) time.advance(1000);
    opened.push(time.now);
  }
  const gaps = opened.slice(1).map((t, i) => (t - opened[i]) / 1000);
  assert.deepEqual(gaps, [15, 30, 60, 120, 240, 480]);
  stream.stop();
});

test("ingen ack på 15 s, eller ingen pong, lukkar og prøver att", () => {
  const time = fakeTime();
  const { FakeSocket, sockets } = fakeSocketClass();
  const stream = createStream({
    lines: ["1136"],
    onVehicle: () => {},
    WebSocketImpl: FakeSocket,
    now: () => time.now,
    setTimer: time.set,
    clearTimer: time.clear,
  });
  stream.start();
  time.advance(15000);
  assert.equal(sockets[0].closed, true);
  assert.equal(stream.state.lastError, "ingen connection_ack");
  time.advance(15000);
  assert.equal(sockets.length, 2);
  sockets[1].onopen();
  sockets[1].serverSends({ type: "connection_ack" });
  time.advance(PING_EVERY_MS);
  assert.equal(sockets[1].sent.at(-1).type, "ping");
  time.advance(PONG_TIMEOUT_MS);
  assert.equal(sockets[1].closed, true);
  assert.equal(stream.state.connected, false);
  stream.stop();
});

test("Reviewer: backoff blir ikkje nullstilt av ei gammal, sunn tilkopling; berre ei ny som lever ≥ 2 min", () => {
  const time = fakeTime();
  const { FakeSocket, sockets } = fakeSocketClass();
  const stream = createStream({
    lines: ["1136"],
    onVehicle: () => {},
    WebSocketImpl: FakeSocket,
    now: () => time.now,
    setTimer: time.set,
    clearTimer: time.clear,
  });
  const ackAndLive = (ms) => {
    const ws = sockets.at(-1);
    ws.onopen();
    ws.serverSends({ type: "connection_ack" });
    // Svar på kvar ping innan eitt sekund, så sambandet lever.
    const until = time.now + ms;
    let seen = ws.sent.length;
    while (time.now < until) {
      time.advance(Math.min(1000, until - time.now));
      if (ws.sent.slice(seen).some((m) => m.type === "ping")) ws.serverSends({ type: "pong" });
      seen = ws.sent.length;
    }
  };
  const nextGap = () => {
    const before = sockets.length;
    const at = time.now;
    sockets.at(-1).onclose({ code: 1006, reason: "" });
    while (sockets.length === before) time.advance(1000);
    return (time.now - at) / 1000;
  };
  stream.start();
  ackAndLive(5 * 60000); // éi sunn tilkopling i 5 min
  const gaps = [];
  for (let i = 0; i < 8; i++) gaps.push(nextGap()); // så mange som døyr før ack
  assert.deepEqual(gaps, [15, 30, 60, 120, 240, 480, 900, 900]);
  // Ei ny tilkopling som lever 1 min, nullstiller ikkje …
  ackAndLive(60000);
  assert.equal(nextGap(), 900);
  // … men ei som lever ≥ HEALTHY_AFTER_MS, gjer det.
  ackAndLive(2 * 60000);
  assert.equal(nextGap(), 15);
  stream.stop();
});

test("tomgangsgrensa hos Entur (~60 s utan trafikk gjev 1006): ping kvart 25. s held sambandet oppe i 15 min", () => {
  const time = fakeTime();
  const { FakeSocket, sockets } = fakeSocketClass();
  const stream = createStream({
    lines: ["1136", "1135"],
    onVehicle: () => {},
    WebSocketImpl: FakeSocket,
    now: () => time.now,
    setTimer: time.set,
    clearTimer: time.clear,
  });
  assert.ok(PING_EVERY_MS + PONG_TIMEOUT_MS < 60000, "ping og pong-frist må vere under tomgangsgrensa");
  stream.start();
  const ws = sockets[0];
  ws.onopen();
  ws.serverSends({ type: "connection_ack" });
  // Tenaren: svarar pong på ping, og lukkar med 1006 når klienten har vore stille i 60 s.
  let lastClient = time.now;
  const gaps = [];
  for (let s = 0; s < 15 * 60; s++) {
    const before = ws.sent.length;
    time.advance(1000);
    if (ws.sent.length > before) {
      gaps.push(time.now - lastClient);
      lastClient = time.now;
      if (ws.sent.at(-1).type === "ping") ws.serverSends({ type: "pong" });
    }
    if (time.now - lastClient >= 60000 && !ws.closed) ws.onclose({ code: 1006, reason: "" });
  }
  assert.equal(sockets.length, 1, "inga ny tilkopling");
  assert.equal(stream.state.connected, true);
  assert.equal(stream.state.connects, 1);
  assert.ok(Math.max(...gaps) <= PING_EVERY_MS, `lengste stille tid ${Math.max(...gaps)} ms`);
  // Lever lenger enn HEALTHY_AFTER_MS, så eit brot no gjev 15 s, ikkje lengre backoff.
  assert.ok(15 * 60000 >= HEALTHY_AFTER_MS);
  ws.onclose({ code: 1006, reason: "" });
  assert.equal(stream.state.reconnectDelayMs, 15000);
  time.advance(15000);
  assert.equal(sockets.length, 2);
  stream.stop();
});

test("med ping kvart minutt (gammal oppførsel) ville tomgangsgrensa ha drepe sambandet før det var sunt", () => {
  // Vern mot at nokon set intervallet tilbake: 60 s ping + nettverk > tomgangsgrensa.
  assert.ok(PING_EVERY_MS <= 30000);
  assert.ok(HEALTHY_AFTER_MS > 116000, "brot etter ~116 s skal framleis ikkje nullstille backoff");
});
