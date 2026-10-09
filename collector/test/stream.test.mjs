import assert from "node:assert/strict";
import test from "node:test";
import { createStream } from "../src/stream.js";

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
  assert.equal(ws.opts.headers["ET-Client-Name"], "teitrand-fergeruter");
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
  time.advance(60000);
  assert.equal(sockets[1].sent.at(-1).type, "ping");
  time.advance(20000);
  assert.equal(sockets[1].closed, true);
  assert.equal(stream.state.connected, false);
  stream.stop();
});
