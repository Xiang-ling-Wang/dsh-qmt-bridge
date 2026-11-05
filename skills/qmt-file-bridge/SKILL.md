---
name: qmt-file-bridge
description: 没有 miniQMT 权限时，用 QMT 内置 Python + 文件桥连接 DSH 与 QMT：签名订单、模型交易执行、急停与状态核对。
whenToUse: QMT 极简模式未开通、只能登录完整版客户端，或需要把 DSH 的交易意图交给 QMT 执行时。
---

# QMT 文件桥（无 miniQMT）

## 适用场景

- 券商只开了 QMT 完整版，miniQMT/极简模式提示“请联系券商开通对应权限”；
- 不想让 DSH 直接持有交易权限；
- 能接受“文件落盘 + QMT 客户端轮询”的秒级延迟。

不适用：高频、日内多次报撤、要求毫秒级延迟。

## 架构

```
DSH / 人
  │ qmt_bridge_emit（approve=true 才签名）
  ▼
<桥目录>/outbox/*.json
  │ QMT 内置策略 run_time 每 3 秒扫描
  ▼
校验 HALT / HMAC / 价格笼子 / 数量 / 白名单
  │ passorder(quickTrade=2)
  ▼
<桥目录>/acks/*.json + fills/*.json
```

## 工具

| 工具 | 用途 |
|---|---|
| `qmt_bridge_status` | 看待处理、回执、成交、HALT |
| `qmt_bridge_emit` | 生成订单；默认 drafts，`approve: true` 才进 outbox |
| `qmt_bridge_halt` | set/clear/status 急停 |
| `qmt_bridge_doctor` | 检查目录、密钥、QMT 日志（权限/账号/策略加载） |
| `qmt_bridge_install` | 复制内置 QMT 策略模板到指定路径 |

桥目录默认 `~/.dsh/qmt-bridge`，可用环境变量 `DSH_QMT_BRIDGE_DIR` 或每个工具的 `dir` 参数覆盖。

## 安装步骤

1. `qmt_bridge_install` 复制 `strategy_bridge.py`；
2. 打开 QMT → **模型交易** → 新建 Python 策略 → 粘贴全文；
3. 在策略配置里选择**资金账号**，运行模式选“模拟交易”；
4. 保持策略里的 `MODE = "signal"`；
5. 启动后看 QMT 日志：`DSH bridge init, mode=signal, account=...`，`account` 不能为空；
6. 用 `qmt_bridge_emit` 发一张草稿，确认字段；
7. 再加 `approve: true` 发到 outbox；
8. `qmt_bridge_status` 应看到 `signal_only` 回执（因为 MODE=signal，不真实下单）；
9. 确认无误后，把 QMT 策略里的 `MODE` 改成 `"live"`，先用 100 股试单。

## 关键约束

- QMT 内置 Python 是 **3.6**，脚本首行必须是 `#coding:gbk`；
- 限价单超过最新价 **±2%** 会被交易所废单，策略里已先校验；
- 股票 **T+1**，当天买入不能卖；
- 买入数量必须是 **100 股整数倍**；
- `passorder` 的 `quickTrade=2` 才能在 `run_time` 回调里立即下单；
- 编辑器里运行 `passorder` 不会产生真实委托，必须在“模型交易”里运行。

## 安全

- 插件只写文件，不下单；真正下单的是 QMT 内置策略；
- 订单必须带 HMAC-SHA256 签名，密钥在 `<桥目录>/secret.txt`；
- 默认 5 分钟过期，单笔上限 1000 股，白名单在 QMT 策略里；
- 急停：`qmt_bridge_halt` set，或手动创建 `<桥目录>/HALT`；
- 永远不要把券商密码、交易密码写进对话或代码。

## 常见问题

### `account=` 为空

说明是在行情图点了“模拟”，那是模拟信号模式，不绑定账号。
必须去 **模型交易** 新建策略、选择资金账号、运行“模拟交易”。

### `status = 23, message = 请联系券商开通对应权限`

这是 miniQMT 权限未开通，不影响文件桥；文件桥走的是完整版“模型交易”。

### 账号“待校验登录”

QMT 需要券商端的**交易密码**，不是登录密码/银行卡密码。忘记只能去券商 APP 或营业部重置。

### 回执一直是 `signal_only`

正常：策略 `MODE` 还是 `signal`。确认要真实下单后再改 `live`。
