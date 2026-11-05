# Validation log — dsh-qmt-bridge 0.1.0

日期：2026-11-05

## npm

```text
npm view dsh-qmt-bridge version
0.1.0

npm view dsh-qmt-bridge dist-tags
{ "latest": "0.1.0" }

dist.fileCount: 7
dist.unpackedSize: 32313
```

Tarball 内容：

```text
package/LICENSE
package/index.js
package/package.json
package/README.md
package/skills/qmt-file-bridge/SKILL.md
package/assets/strategy_bridge.py
package/cordis.patch.yml
```

干净目录安装：

```text
npm install dsh-qmt-bridge@0.1.0
added 1 package, and audited 2 packages in 3s
found 0 vulnerabilities
```

## 插件加载

用 mock ctx 调用 `apply(ctx)`，注册结果：

```text
tools = qmt_bridge_status, qmt_bridge_emit, qmt_bridge_halt, qmt_bridge_doctor, qmt_bridge_install
skills = qmt-file-bridge
```

`apply(ctx)` 不依赖 QMT 在线；默认桥目录不可写时只记录警告，不抛错。

## 签名

Node 生成的 HMAC-SHA256 订单，用 QMT 内置 Python 策略的 `_token_ok()` 校验：

```text
token_ok True
canonical ORD-XLANG-001|301297.SZ|BUY|600|31.10|2026-11-05T18:49:31
```

## 安全边界

- 插件只写签名订单文件，不调用 `passorder`；
- 默认写 `drafts`，不进入 QMT 扫描的 `outbox`；
- 订单 5 分钟过期、价格 ±2% 校验、单笔 ≤1000 股、白名单在 QMT 策略里；
- `HALT` 文件可拒绝一切新单；
- 默认 `MODE="signal"`，QMT 只写回执，不真实下单。

## 尚未验证

- QMT 真实 `passorder` 联调（需要 QMT 完整版“模型交易”里加载策略并绑定资金账号）；
- 真实券商账户的委托/成交回执；
- 不同券商 QMT 版本的字段差异。

这些不影响插件在 DSH 中的加载与工具调用，但首次实盘前必须完成。
