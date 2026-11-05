# 发布清单（dsh-qmt-bridge 0.1.0）

## 1. 本地打包

```powershell
cd D:\dsh\qmt-bridge-plugin
npm test
npm pack
```

产物：`dsh-qmt-bridge-0.1.0.tgz`。

## 2. 创建 GitHub 仓库并推送

仓库地址：<https://github.com/Xiang-ling-Wang/dsh-qmt-bridge>

先在 GitHub 网页创建空仓库（不要初始化 README），然后：

```powershell
cd D:\dsh\qmt-bridge-plugin
git init -b main
git config user.name "Xiang-ling-Wang"
git config user.email "Xiang-ling-Wang@users.noreply.github.com"
git add .
git commit -m "feat: dsh-qmt-bridge v0.1.0"
git remote add origin https://github.com/Xiang-ling-Wang/dsh-qmt-bridge.git
git push -u origin main
```

推送需要 GitHub 凭据（PAT 或 Git Credential Manager），这一步无法由 DSH 代填。

如果 `git push` 报：

```
schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS
```

先执行：

```powershell
git config http.sslBackend openssl
```

再推送。本仓库已经设置好该项。

### 如果提示 `Couldn't check availability`

通常不是重名，而是 GitHub 对新账号的风控、邮箱未验证，或代理/VPN 导致可用性接口失败。

按顺序试：

1. 验证邮箱、补全头像/昵称，完成新手引导；
2. 等 10–15 分钟再试；
3. 直接打开带参数的创建页：
   <https://github.com/new?name=dsh-qmt-bridge&owner=Xiang-ling-Wang>
4. 换无痕窗口、关闭代理/VPN/广告拦截，或改用手机热点；
5. 换一个仓库名测试（如 `dsh-qmt-bridge-plugin`）；如果所有名字都报同样错误，就是账号/网络问题，不是名字问题；
6. 仍不行：用已有老账号创建，或联系 GitHub Support。

npm 不依赖 GitHub，可以先完成 `npm login` + `npm publish`，仓库稍后补。

在仓库设置里添加 topic：`dsh-plugin`。

## 3. 检查 npm 包名

```powershell
npm view dsh-qmt-bridge version
```

- 返回 404 / `E404`：包名可用；
- 返回版本号：已被占用，改用 scoped 名：

```json
"name": "@xiang-ling-wang/dsh-qmt-bridge"
```

同步修改 README 安装命令。

## 4. 登录 npm 并发布

```powershell
cd D:\dsh\qmt-bridge-plugin
npm login
npm publish --access public
```

如果发布失败：

- `E402`：需要 `npm login`；
- `E403` 且提示 `Two-factor authentication or granular access token with bypass 2fa enabled`：
  这是账号开了 2FA，CLI 发布需要一次性验证码或带 Bypass 2FA 的 token。
  - 方式 A：带 OTP 发布
    ```powershell
    npm publish --access public --otp=123456
    ```
    123456 换成验证器 App 当前的 6 位码。
  - 方式 B（推荐，可重复发布）：创建 Granular Access Token
    1. 登录 npmjs.com → 头像 → **Access Tokens** → **Generate New Token** → **Granular Access Token**；
    2. Permissions 选 **Read and write**；
    3. Packages 选 **All packages** 或只选 `dsh-qmt-bridge`；
    4. 勾选 **Bypass 2FA**（关键）；
    5. 生成后复制 `npm_...`，本机执行：
       ```powershell
       $env:NODE_AUTH_TOKEN='npm_xxx'
       npm publish --access public
       ```
  不要把 token 写进仓库、不要发到对话里。
- `E403` 且提示包名/权限：包名可能被占用或 scope 无权限，改用 `@xiang-ling-wang/dsh-qmt-bridge`；
- `EPERM` / 网络错误：换 npm 镜像或检查代理。

## 4b. 可选：GitHub Actions 自动发布

仓库建好后，把 granular token（带 Bypass 2FA）存到 GitHub secret `NPM_TOKEN`，
打 tag 就会自动发布：

```powershell
git tag v0.1.1
git push origin v0.1.1
```

工作流文件在 `.github/workflows/publish.yml`。

## 4c. npm 显示 `0.0.0-stage`

`npm publish` 返回 `+ dsh-qmt-bridge@0.1.0`，但 `npm view` 显示 `latest: 0.0.0-stage`，这是 npm 的 **staged publishing / 新包审核**：

- registry 会先放一个 `0.0.0-stage` 占位版本，描述是
  `Temporary package placeholder for staged publishing`；
- 真正的 `0.1.0` 已提交审核，等待 staged release；
- 此时 `npm view dsh-qmt-bridge@0.1.0` 会 404，属正常。

处理：

1. `npm stage list` 查看有没有可自行批准的 staged release；
2. 有 stage id：`npm stage approve <stage-id>`；
3. 没有：说明在 npm 审核队列，等待即可（新账号/新包可能几小时到几天）；
4. 检查 npm 注册邮箱（含垃圾箱）是否有验证/审核邮件；
5. 24–48 小时仍未释放，联系 <https://support.npmjs.com>，提供包名、维护者邮箱、发布时间；
6. 不要反复重发同一个 `0.1.0`，避免版本冲突或重复审核。

只有 `npm view dsh-qmt-bridge version` 返回 `0.1.0` 后，才去插件市场提交。

## 5. 提交插件市场

1. 打开 <https://dsh-plugin.org/zh/submit>；
2. 填 npm 包名、GitHub 仓库、分类（工具能力 / 交易执行）；
3. 等待人工审核；
4. 收录后用户可：

```bash
dsh plugin add dsh-qmt-bridge
```

## 6. 发布后自检

```powershell
npm view dsh-qmt-bridge
npm pack dsh-qmt-bridge
```

在另一台机器或干净 profile 里安装，确认：

- `qmt_bridge_status` 能调用；
- `qmt-file-bridge` 技能出现在技能目录；
- `qmt_bridge_install` 能生成带正确 `BASE` 路径的策略。

## 7. 版本迭代

- 修 bug：`0.1.1`；
- 加功能：`0.2.0`；
- 改协议/不兼容：`1.0.0`；
- 每次发版同步 `CHANGELOG.md` 和 README。
