# Changelog

## 0.1.1 — 2026-11-05

- 修复：默认桥目录不可写时，插件加载不再抛错，只记录警告；工具调用时再报具体错误。

## 0.1.0 — 2026-11-05

- 首个版本：无 miniQMT 的 QMT 文件桥。
- 5 个工具：status / emit / halt / doctor / install。
- 1 个技能：`qmt-file-bridge`。
- HMAC-SHA256 签名、5 分钟过期、价格笼子、白名单、HALT 急停。
- QMT 内置 Python 3.6 策略模板，默认 `MODE=signal`。
- 本地 mock 测试与跨语言签名校验通过。

