# dsh-qmt-bridge

**没有 miniQMT 权限，也能让 DeepSeek Harness 把交易意图交给 QMT 执行。**

DSH 负责“想”，QMT 负责“做”，人负责“把关”。这个插件把三者之间的连接做成一条**文件桥**：
DSH 只写签名订单文件，QMT 完整版里的 Python 策略读取、校验、调用 `passorder`，再把回执和成交写回来。

> 插件本身**不持有交易权限、不直接下单**。真正下单的只有 QMT 客户端里的那段策略。

## 为什么需要它

QMT 的外部 `xtquant` 接口需要 **极简模式（miniQMT）** 权限，很多账户只开了完整版，登录极简模式会提示：

```
status = 23, message = 请联系券商开通对应权限
```

但完整版的“模型交易”仍然可以运行 Python 3.6 策略并调用 `passorder`。
这个插件就是为这条路准备的：不申请 miniQMT，也不换券商。

## 功能

| 工具 | 作用 |
|---|---|
| `qmt_bridge_status` | 查看 outbox / drafts / acks / fills、HALT、密钥、最新回执与成交 |
| `qmt_bridge_emit` | 生成订单；默认写 drafts，`approve: true` 才签名进 outbox |
| `qmt_bridge_halt` | `set` / `clear` / `status` 急停开关 |
| `qmt_bridge_doctor` | 检查桥目录、密钥、QMT 安装目录与最近日志（权限/账号/策略加载） |
| `qmt_bridge_install` | 复制内置 QMT Python 策略模板到指定路径 |

同时注册技能 `qmt-file-bridge`，包含安装、测试、对账、排错步骤。

## 安装

```bash
dsh plugin --profile web add dsh-qmt-bridge
```

安装后在“设置 → 插件市场”里启用，或按 DSH 的插件管理流程重启 `dsh web`。

## 快速开始

1. 让插件把策略模板复制出来：

```
qmt_bridge_install
```

2. 打开 QMT → **模型交易** → 新建 Python 策略 → 粘贴模板全文；
3. 在策略配置里选择**资金账号**，运行模式选“模拟交易”；
4. 保持 `MODE = "signal"`，启动策略；
5. 看 QMT 日志：`DSH bridge init, mode=signal, account=...`，`account` 不能为空；
6. 发一张草稿：

```
qmt_bridge_emit(symbol="301297.SZ", side="BUY", qty=600, price=31.10)
```

7. 确认后加 `approve=true`：

```
qmt_bridge_emit(symbol="301297.SZ", side="BUY", qty=600, price=31.10, approve=true)
```

8. `qmt_bridge_status` 应出现 `signal_only` 回执（因为 `MODE=signal`，不真实下单）；
9. 确认无误后，把 QMT 策略里的 `MODE` 改成 `"live"`，先用 100 股试单。

## 安全设计

- **插件不下单**：只写文件；执行发生在 QMT 内部；
- **签名**：订单必须带 HMAC-SHA256，密钥在 `<桥目录>/secret.txt`；
- **过期**：默认 5 分钟，过期订单被 QMT 策略拒绝；
- **价格笼子**：QMT 策略先校验最新价 ±2%，避免废单；
- **数量/白名单**：默认单笔 ≤1000 股，白名单在策略里；
- **急停**：`qmt_bridge_halt set` 创建 `HALT`，策略拒绝一切新单；
- **默认草稿**：不传 `approve=true` 只写 drafts，QMT 不会扫描。

## 配置

桥目录默认 `~/.dsh/qmt-bridge`：

```
outbox/   已签名订单（QMT 扫描）
drafts/   草稿（QMT 不扫描）
acks/     回执
fills/    成交
secret.txt
HALT
```

可用环境变量 `DSH_QMT_BRIDGE_DIR` 覆盖，或在每个工具里传 `dir`。

## 兼容性

- DSH / DeepSeek Harness：需要支持 `tools.register` 与 `skills.register` 的版本；
- QMT：完整版客户端，能运行“模型交易 → Python 策略”；
- QMT 内置 Python 3.6；模板首行 `#coding:gbk`，纯 ASCII；
- 不依赖 miniQMT、不依赖外部 `xtquant`。

## 限制

- 文件轮询有秒级延迟，不适合高频/日内多次报撤；
- 场外基金只有每日净值，不能套用这套日内执行；
- 回执/成交依赖 QMT 写文件，客户端退出时不会执行；
- 插件不提供行情、选股、策略 alpha，只提供执行连接。

## 开发

```bash
npm test
```

测试用 mock ctx 验证工具注册、发单签名、急停、状态与模板复制，不需要安装 QMT。

## 发布到插件市场

仓库地址：<https://github.com/Xiang-ling-Wang/dsh-qmt-bridge>

1. 在 GitHub 创建 `Xiang-ling-Wang/dsh-qmt-bridge`，推送 `main`；
2. 添加 `dsh-plugin` topic；
3. `npm login` 后 `npm publish --access public`；
4. 在 <https://dsh-plugin.org/zh/submit> 提交；
5. 用户安装：`dsh plugin --profile web add dsh-qmt-bridge`。

如果 `dsh-qmt-bridge` 已被占用，改成 `@xiang-ling-wang/dsh-qmt-bridge`，并同步改 `name` 与安装命令。

## License

MIT
