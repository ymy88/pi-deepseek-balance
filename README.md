# pi-deepseek-balance

一个 [pi](https://pi.dev) 扩展，把 **DeepSeek 官方账户余额**显示在状态栏，例如 `💵 DS $12.34`。

## 显示规则

和 `pi-ark-quota` 一样按 provider 判断，只看当前模型实际落在哪个端点上：

| 当前模型 | 是否显示 |
|---|---|
| provider 的 baseUrl 主机名等于 `api.deepseek.com` | 显示 |
| 其他 provider（OpenRouter、火山、…） | 隐藏，不占状态栏 |
| 虚拟模型 `deepseek/auto` | 看会话分支里**最后一条回复**的 provider：上一轮走 DeepSeek 官方就显示，走 OpenRouter 就隐藏 |

`deepseek/auto` 是虚拟模型，选择它的 provider 是 `deepseek`，本身不代表真实端点，所以这里不用 `ctx.model.provider` 判断，而是读 `ctx.sessionManager.getBranch()` 里最后一条 assistant 消息的 `provider`。这一轮还没回复过时，退回虚拟模型登记的 provider。

配合非高峰时段这个扩展显示余额、高峰时段 `pi-openrouter-balance` 显示余额，两个扩展不会同时出现。

判断依据是 baseUrl 的主机名，不是 provider 名字。

## 数据来源

`GET https://api.deepseek.com/user/balance`，密钥用 pi 里已有的 provider 密钥（`ctx.modelRegistry.getApiKeyForProvider()`），不需要额外配置环境变量。

```json
{"is_available":false,"balance_infos":[{"currency":"USD","total_balance":"0.00"}]}
```

美元条目优先显示，没有美元余额时显示第一个币种（例如 `¥70.00`）。

## 状态栏颜色

| 条件 | 颜色 |
|---|---|
| `is_available` 为 false（余额为 0 时 DeepSeek 就是这样，会拒绝新请求） | 红 |
| 余额 ≤ 0 | 红 |
| 余额 < 阈值（默认 5） | 黄 |
| 其他 | 正常 |

查询失败时显示暗色的 `💵 DS 登录✗` / `💵 DS 无密钥` / `💵 DS ✗`，不显示过期数字（401/403 会清空缓存）。

## 安装

```bash
pi install npm:@ymy88/pi-deepseek-balance
```

也可以直接装 git 版本，或者装本地目录：

```bash
pi install git:github.com/ymy88/pi-deepseek-balance
pi install ~/Projects/pi-deepseek-balance
```

然后在 pi 里 `/reload`。

## 命令

| 命令 | 作用 |
|---|---|
| `/deepseek-balance` | 强制刷新并显示各币种余额和账户是否可用 |

## 配置（环境变量，可选）

| 变量 | 默认 |
|---|---|
| `DEEPSEEK_BALANCE_TTL_MS` | `300000`（5 分钟缓存） |
| `DEEPSEEK_BALANCE_LOW_USD` | `5`（低于它标黄） |

刷新时机：`session_start`、`model_select`、`agent_settled`（每轮结束），都受缓存 TTL 约束。

## 测试

```bash
npm test
```

只测纯函数（解析、币种排序、颜色、文本、主机名匹配、虚拟模型可见性判断），不发网络请求。

## 许可证

MIT，见 [LICENSE](LICENSE)。
