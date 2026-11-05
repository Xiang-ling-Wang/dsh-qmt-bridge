/**
 * dsh-qmt-bridge — DSH ↔ QMT file bridge (no miniQMT required).
 *
 * The plugin never places orders. It writes HMAC-signed order files into an
 * outbox; a QMT built-in Python strategy (assets/strategy_bridge.py) reads
 * them, validates them again, calls passorder, and writes acks/fills.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "dsh-qmt-bridge";
export const inject = ["tools", "skills"];

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const ASSET_STRATEGY = join(MODULE_DIR, "assets", "strategy_bridge.py");
const SKILL_DIR = join(MODULE_DIR, "skills", "qmt-file-bridge");
const DEFAULT_DIR =
  process.env.DSH_QMT_BRIDGE_DIR || join(homedir(), ".dsh", "qmt-bridge");

const QMT_CANDIDATES = [
  process.env.QMT_HOME,
  "D:\\东莞证券QMT实盘交易端",
  "C:\\东莞证券QMT实盘交易端",
  "D:\\国金QMT交易端",
  "C:\\国金QMT交易端",
  "D:\\迅投极速交易终端",
].filter(Boolean);

function rootDir(arg) {
  return resolve(arg || DEFAULT_DIR);
}

function paths(dir) {
  const root = rootDir(dir);
  return {
    root,
    outbox: join(root, "outbox"),
    drafts: join(root, "drafts"),
    acks: join(root, "acks"),
    fills: join(root, "fills"),
    halt: join(root, "HALT"),
    secret: join(root, "secret.txt"),
  };
}

function ensureDirs(dir) {
  const p = paths(dir);
  for (const d of [p.root, p.outbox, p.drafts, p.acks, p.fills]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
  return p;
}

function secretOf(p) {
  if (!existsSync(p.secret)) {
    writeFileSync(p.secret, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return readFileSync(p.secret, "utf8").trim();
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function localStamp(date = new Date()) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function canonical(o) {
  return [
    o.order_id,
    o.symbol,
    o.side,
    String(Number(o.qty)),
    Number(o.price).toFixed(2),
    o.expires_at,
  ].join("|");
}

function sign(order, secret) {
  return createHmac("sha256", secret).update(canonical(order), "utf8").digest("hex");
}

function jsonFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const file = join(dir, f);
      let stat;
      try {
        stat = statSync(file);
      } catch {
        return null;
      }
      return { name: f, file, mtime: stat.mtimeMs, size: stat.size };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function text(value) {
  return [{ type: "text", text: value }];
}

function assertSymbol(symbol) {
  if (!/^\d{6}\.(SH|SZ|BJ)$/.test(symbol || "")) {
    throw new Error("symbol 必须是 6 位代码 + .SH/.SZ/.BJ，例如 301297.SZ");
  }
}

function assertQty(qty) {
  if (!Number.isInteger(qty) || qty <= 0 || qty % 100 !== 0) {
    throw new Error("qty 必须是 100 的正整数倍");
  }
}

function assertPrice(price) {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("price 必须是正数");
  }
}

function status(args = {}) {
  const p = ensureDirs(args.dir);
  const outbox = jsonFiles(p.outbox);
  const drafts = jsonFiles(p.drafts);
  const acks = jsonFiles(p.acks);
  const fills = jsonFiles(p.fills);
  return {
    root: p.root,
    halt: existsSync(p.halt),
    secret: existsSync(p.secret),
    strategyAsset: existsSync(ASSET_STRATEGY),
    outbox: outbox.length,
    drafts: drafts.length,
    acks: acks.length,
    fills: fills.length,
    latestAck: acks[0] ? readJson(acks[0].file) : null,
    latestFill: fills[0] ? readJson(fills[0].file) : null,
    pending: outbox.slice(0, 5).map((f) => f.name),
  };
}

async function emit(args = {}) {
  const p = ensureDirs(args.dir);
  const symbol = String(args.symbol || "").toUpperCase();
  const side = String(args.side || "").toUpperCase();
  const qty = Number(args.qty);
  const price = Number(args.price);
  const ttl = Number(args.ttl_minutes || 5);
  const approve = args.approve === true;

  assertSymbol(symbol);
  if (!["BUY", "SELL"].includes(side)) throw new Error("side 必须是 BUY 或 SELL");
  assertQty(qty);
  assertPrice(price);
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 120) {
    throw new Error("ttl_minutes 必须在 1–120 之间");
  }

  const created = new Date();
  const expires = new Date(created.getTime() + ttl * 60_000);
  const orderId =
    args.order_id ||
    `ORD-${created.getFullYear()}${pad(created.getMonth() + 1)}${pad(created.getDate())}-` +
      `${pad(created.getHours())}${pad(created.getMinutes())}${pad(created.getSeconds())}-` +
      randomBytes(2).toString("hex");

  if (!/^[A-Za-z0-9_-]{6,64}$/.test(orderId)) {
    throw new Error("order_id 只能包含字母、数字、下划线和短横线，长度 6–64");
  }

  const order = {
    order_id: orderId,
    created_at: localStamp(created),
    expires_at: localStamp(expires),
    symbol,
    side,
    qty,
    price: Number(price.toFixed(2)),
    pr_type: 11,
    mode: approve ? "live" : "draft",
  };
  if (approve) order.approval_token = sign(order, secretOf(p));

  const dest = approve ? p.outbox : p.drafts;
  const file = join(dest, `${orderId}.json`);
  if (existsSync(file)) throw new Error(`订单已存在：${orderId}`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(order, null, 2), "utf8");
  renameSync(tmp, file);

  return {
    order,
    path: file,
    approve,
    note: approve
      ? "已签名并写入 outbox；QMT 策略 MODE=live 时才会真正下单"
      : "草稿；不会进入 outbox，不会被 QMT 扫描",
  };
}

function halt(args = {}) {
  const p = ensureDirs(args.dir);
  const action = String(args.action || "status").toLowerCase();
  if (action === "set") {
    writeFileSync(p.halt, "halted by dsh-qmt-bridge\n", "utf8");
    return { action, halt: true, path: p.halt };
  }
  if (action === "clear") {
    rmSync(p.halt, { force: true });
    return { action, halt: false, path: p.halt };
  }
  if (action !== "status") throw new Error("action 必须是 set / clear / status");
  return { action, halt: existsSync(p.halt), path: p.halt };
}

function readTail(file, maxBytes = 200_000) {
  const buf = readFileSync(file);
  const start = Math.max(0, buf.length - maxBytes);
  return buf.subarray(start).toString("utf8");
}

function doctor(args = {}) {
  const p = ensureDirs(args.dir);
  const findings = [];
  if (!existsSync(ASSET_STRATEGY)) findings.push("缺失 assets/strategy_bridge.py");
  if (!existsSync(p.secret)) findings.push("secret.txt 不存在；首次发单会自动生成");

  const qmt = args.qmt_path || QMT_CANDIDATES.find((d) => existsSync(d));
  if (!qmt) {
    findings.push("未找到 QMT 安装目录；可用 qmt_path 指定");
  } else {
    const miniLog = join(qmt, "userdata_mini", "log");
    const fullLog = join(qmt, "userdata", "log");
    const logDir = existsSync(miniLog) ? miniLog : fullLog;
    if (existsSync(logDir)) {
      const logs = readdirSync(logDir)
        .filter((f) => f.endsWith(".log"))
        .map((f) => join(logDir, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      const latest = logs[0];
      if (latest) {
        const tail = readTail(latest);
        if (tail.includes("请联系券商开通对应权限")) {
          findings.push("QMT 日志出现“请联系券商开通对应权限”：miniQMT 未开通，走内置 Python 路线");
        }
        if (/account=\s*$/m.test(tail)) {
          findings.push("QMT 日志出现 account= 为空：模型交易未绑定资金账号");
        }
        if (tail.includes("DSH bridge init")) {
          findings.push("QMT 日志出现 DSH bridge init：策略已加载");
        }
      }
    } else {
      findings.push("QMT 日志目录不存在：客户端可能没运行过");
    }
  }

  return {
    root: p.root,
    qmt: qmt || null,
    ok: findings.length === 0,
    findings,
    strategyAsset: ASSET_STRATEGY,
  };
}

function install(args = {}) {
  const p = ensureDirs(args.dir);
  const target = resolve(args.target || join(p.root, "strategy_bridge.py"));
  if (existsSync(target) && args.force !== true) {
    throw new Error(`目标已存在：${target}；需要覆盖请传 force: true`);
  }
  let source = readFileSync(ASSET_STRATEGY, "utf8");
  source = source.replace(/^BASE = .*$/m, `BASE = r"${p.root.replace(/"/g, '\\"')}"`);
  writeFileSync(target, source, "utf8");
  return {
    target,
    note: "把该文件全文粘贴到 QMT → 模型交易 → Python 策略；先保持 MODE=signal",
    mode: "signal",
  };
}

const tools = [
  {
    name: "qmt_bridge_status",
    description:
      "查看 QMT 文件桥状态：outbox/drafts/acks/fills 数量、HALT、密钥、最新回执与成交。",
    parameters: {
      type: "object",
      properties: { dir: { type: "string", description: "桥目录，默认 ~/.dsh/qmt-bridge" } },
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render(_args, v) {
        const lines = [
          `桥目录：${v.root}`,
          `HALT：${v.halt ? "已开启（拒绝新单）" : "关闭"}`,
          `密钥：${v.secret ? "已生成" : "未生成"}　策略模板：${v.strategyAsset ? "存在" : "缺失"}`,
          `待处理 ${v.outbox}　草稿 ${v.drafts}　回执 ${v.acks}　成交 ${v.fills}`,
        ];
        if (v.pending.length) lines.push(`待处理订单：${v.pending.join(", ")}`);
        if (v.latestAck) lines.push(`最新回执：${JSON.stringify(v.latestAck)}`);
        if (v.latestFill) lines.push(`最新成交：${JSON.stringify(v.latestFill)}`);
        return text(lines.join("\n"));
      },
    },
    async execute(args) {
      return status(args);
    },
  },
  {
    name: "qmt_bridge_emit",
    description:
      "生成一张 QMT 订单文件。默认写 drafts（不发）；approve=true 才签名写入 outbox。插件本身不下单。",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "如 301297.SZ" },
        side: { type: "string", enum: ["BUY", "SELL"] },
        qty: { type: "integer", description: "100 的整数倍" },
        price: { type: "number", description: "限价" },
        ttl_minutes: { type: "integer", description: "有效期，默认 5 分钟" },
        approve: { type: "boolean", description: "true=签名并进入 outbox" },
        order_id: { type: "string" },
        dir: { type: "string" },
      },
      required: ["symbol", "side", "qty", "price"],
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render(_args, v) {
        return text(
          [
            `${v.approve ? "已签名" : "草稿"}：${v.order.order_id}`,
            `${v.order.side} ${v.order.symbol} ${v.order.qty} @ ${v.order.price}`,
            `有效期至：${v.order.expires_at}`,
            `文件：${v.path}`,
            v.note,
          ].join("\n"),
        );
      },
    },
    async execute(args) {
      return emit(args);
    },
  },
  {
    name: "qmt_bridge_halt",
    description: "急停开关：set 创建 HALT 拒绝新单，clear 解除，status 查看。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["set", "clear", "status"] },
        dir: { type: "string" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render(_args, v) {
        return text(`HALT：${v.halt ? "开启" : "关闭"}（${v.path}）`);
      },
    },
    async execute(args) {
      return halt(args);
    },
  },
  {
    name: "qmt_bridge_doctor",
    description:
      "体检：桥目录、密钥、策略模板、QMT 安装目录与最近日志（miniQMT 权限/账号绑定/策略加载）。",
    parameters: {
      type: "object",
      properties: { dir: { type: "string" }, qmt_path: { type: "string" } },
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render(_args, v) {
        const lines = [`桥目录：${v.root}`, `QMT：${v.qmt || "未找到"}`, v.ok ? "体检通过" : "发现问题："];
        for (const f of v.findings) lines.push(`- ${f}`);
        return text(lines.join("\n"));
      },
    },
    async execute(args) {
      return doctor(args);
    },
  },
  {
    name: "qmt_bridge_install",
    description: "把内置 QMT Python 策略模板复制到指定路径，并返回安装说明。",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "目标文件，默认 <桥目录>/strategy_bridge.py" },
        force: { type: "boolean" },
        dir: { type: "string" },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render(_args, v) {
        return text([`已写入：${v.target}`, v.note].join("\n"));
      },
    },
    async execute(args) {
      return install(args);
    },
  },
];

function registerSkill(ctx) {
  const file = join(SKILL_DIR, "SKILL.md");
  if (!existsSync(file)) return;
  const raw = readFileSync(file, "utf8");
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return;
  const fm = m[1];
  const pick = (key) => {
    const hit = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(fm);
    return hit ? hit[1].trim().replace(/^['"]|['"]$/g, "") : "";
  };
  const skillName = pick("name");
  const description = pick("description");
  if (!skillName || !description) return;
  const remove = ctx.skills.register({
    name: skillName,
    description,
    content: raw.slice(m[0].length).trimStart(),
    resourceBase: { kind: "directory", path: SKILL_DIR },
    source: "runtime",
  });
  if (typeof remove === "function") ctx.on?.("dispose", remove);
}

export function apply(ctx) {
  ensureDirs();
  registerSkill(ctx);
  for (const tool of tools) {
    const dispose = ctx.tools.register(tool);
    if (typeof dispose === "function") ctx.on?.("dispose", dispose);
  }
  ctx.logger?.info?.("[dsh-qmt-bridge] ready");
}
