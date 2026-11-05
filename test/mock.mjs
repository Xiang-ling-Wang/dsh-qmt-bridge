import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "qmt-bridge-test-"));
process.env.DSH_QMT_BRIDGE_DIR = dir;

const { apply } = await import("../index.js");

const registered = { tools: [], skills: [] };
const ctx = {
  tools: {
    register(tool) {
      registered.tools.push(tool);
      return () => {};
    },
  },
  skills: {
    register(skill) {
      registered.skills.push(skill);
      return () => {};
    },
  },
  on() {},
  logger: { info() {} },
};

apply(ctx);

assert.equal(registered.tools.length, 5, "should register five tools");
assert.equal(registered.skills.length, 1, "should register the qmt-file-bridge skill");
assert.equal(registered.skills[0].name, "qmt-file-bridge");

const byName = Object.fromEntries(registered.tools.map((t) => [t.name, t]));
for (const name of [
  "qmt_bridge_status",
  "qmt_bridge_emit",
  "qmt_bridge_halt",
  "qmt_bridge_doctor",
  "qmt_bridge_install",
]) {
  assert.ok(byName[name], `missing tool ${name}`);
}

const emit = byName.qmt_bridge_emit;
const draft = await emit.execute({
  symbol: "301297.SZ",
  side: "BUY",
  qty: 600,
  price: 31.1,
  dir,
});
assert.equal(draft.order.mode, "draft");
assert.ok(draft.path.includes("drafts"));
assert.equal(draft.order.approval_token, undefined);

const live = await emit.execute({
  symbol: "301297.SZ",
  side: "BUY",
  qty: 600,
  price: 31.1,
  approve: true,
  order_id: "ORD-TEST-0001",
  dir,
});
assert.equal(live.order.mode, "live");
assert.match(live.order.approval_token, /^[0-9a-f]{64}$/);
assert.ok(existsSync(join(dir, "outbox", "ORD-TEST-0001.json")));

const saved = JSON.parse(readFileSync(live.path, "utf8"));
assert.equal(saved.order_id, "ORD-TEST-0001");
assert.equal(saved.price, 31.1);

const status = await byName.qmt_bridge_status.execute({ dir });
assert.equal(status.outbox, 1);
assert.equal(status.drafts, 1);

const halt = byName.qmt_bridge_halt;
assert.equal((await halt.execute({ action: "set", dir })).halt, true);
assert.ok(existsSync(join(dir, "HALT")));
assert.equal((await halt.execute({ action: "clear", dir })).halt, false);
assert.equal(existsSync(join(dir, "HALT")), false);

const installed = await byName.qmt_bridge_install.execute({ dir });
assert.ok(existsSync(installed.target));
assert.ok(
  readFileSync(installed.target, "utf8").includes(`BASE = r"${dir}"`),
  "installed strategy should point at the plugin bridge dir",
);

const doctor = await byName.qmt_bridge_doctor.execute({ dir });
assert.ok(Array.isArray(doctor.findings));

await assert.rejects(() =>
  emit.execute({ symbol: "301297", side: "BUY", qty: 600, price: 31.1, dir }),
);
await assert.rejects(() =>
  emit.execute({ symbol: "301297.SZ", side: "BUY", qty: 650, price: 31.1, dir }),
);

console.log("ok: tools=", registered.tools.length, "skill=", registered.skills[0].name);
console.log("bridge dir:", dir);
