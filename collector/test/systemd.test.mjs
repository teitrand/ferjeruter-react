import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const unit = (name) => readFileSync(new URL(`../systemd/${name}`, import.meta.url), "utf8");
const values = (text, key) => [...text.matchAll(new RegExp(`^${key}=(.*)$`, "gm"))].map((m) => m[1]);

for (const name of ["fergeruter-collector.service", "fergeruter-compare.service"]) {
  test(`${name}: eigen brukar, oppsett, stiar og herding`, () => {
    const text = unit(name);
    assert.deepEqual(values(text, "User"), ["fergeruter"]);
    assert.deepEqual(values(text, "EnvironmentFile"), ["/etc/fergeruter/collector.env"]);
    assert.deepEqual(values(text, "WorkingDirectory"), ["/opt/fergeruter/app/collector"]);
    assert.deepEqual(values(text, "ReadWritePaths"), ["/var/lib/fergeruter"]);
    for (const [key, want] of Object.entries({
      NoNewPrivileges: "yes",
      CapabilityBoundingSet: "",
      ProtectSystem: "strict",
      ProtectHome: "yes",
      PrivateTmp: "yes",
      PrivateDevices: "yes",
      RestrictAddressFamilies: "AF_INET AF_INET6 AF_UNIX",
      LockPersonality: "yes",
      RestrictSUIDSGID: "yes",
    })) {
      assert.deepEqual(values(text, key), [want], key);
    }
    assert.ok(values(text, "SystemCallFilter").includes("@system-service"));
    assert.ok(values(text, "MemoryMax").length === 1);
  });
}

test("innsamlaren startar alltid på nytt, men aldri tettare enn 15 s (Entur sin grense)", () => {
  const text = unit("fergeruter-collector.service");
  assert.deepEqual(values(text, "Restart"), ["always"]);
  assert.ok(Number(values(text, "RestartSec")[0]) >= 15);
});

test("timaren køyrer samanlikninga om natta, og avsendaren er av i eksempeloppsettet", () => {
  assert.match(unit("fergeruter-compare.timer"), /^OnCalendar=.*03:20/m);
  assert.match(unit("collector.env.example"), /^FERGERUTER_SENDER_ENABLED=0$/m);
  assert.doesNotMatch(unit("collector.env.example"), /^FERGERUTER_SENDER_(URL|KEY)=\S/m);
});

test("signaltur-sjekken: oneshot som eigen brukar, same herding, timer kvart 10. minutt, installert av install.sh", () => {
  const text = unit("fergeruter-signaltur.service");
  assert.deepEqual(values(text, "Type"), ["oneshot"]);
  assert.deepEqual(values(text, "User"), ["fergeruter"]);
  assert.deepEqual(values(text, "EnvironmentFile"), ["/etc/fergeruter/collector.env"]);
  assert.deepEqual(values(text, "WorkingDirectory"), ["/opt/fergeruter/app"]);
  assert.deepEqual(values(text, "ExecStart"), ["/usr/bin/python3 scripts/signaltur_server.py"]);
  assert.deepEqual(values(text, "ReadWritePaths"), ["/var/lib/fergeruter"]);
  for (const [key, want] of Object.entries({ NoNewPrivileges: "yes", ProtectSystem: "strict", ProtectHome: "yes", PrivateTmp: "yes", RestrictAddressFamilies: "AF_INET AF_INET6 AF_UNIX" })) {
    assert.deepEqual(values(text, key), [want], key);
  }
  assert.doesNotMatch(text, /SENDER_KEY\s*=\s*\S/, "nøkkelen står aldri i eininga");
  assert.match(unit("fergeruter-signaltur.timer"), /^OnCalendar=\*:0\/10$/m);
  assert.match(unit("fergeruter-signaltur.timer"), /^Persistent=true$/m);
  const install = readFileSync(new URL("../deploy/install.sh", import.meta.url), "utf8");
  assert.match(install, /fergeruter-signaltur\.service fergeruter-signaltur\.timer/);
  assert.match(install, /systemctl enable [^\n]*fergeruter-signaltur\.timer/);
});
