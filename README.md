# pi-deepseek-balance

A [pi](https://pi.dev) extension that shows your **official DeepSeek account balance** in the status bar, for example `💵 DS $12.34`.

## When it shows

Visibility is decided by provider, the same way `pi-ark-quota` does it — only by where the current model actually runs:

| Current model | Shown |
|---|---|
| Provider whose base URL host is `api.deepseek.com` | Shown |
| Any other provider (OpenRouter, Volcano Ark, …) | Hidden, no status bar space used |
| The virtual model `deepseek/auto` | Follows the provider of the **last reply** on the session branch: if the previous turn went to the official DeepSeek endpoint it shows, if it went to OpenRouter it hides |

`deepseek/auto` is a virtual model. The provider you select it under is `deepseek`, which does not identify the real endpoint, so this extension does not look at `ctx.model.provider`. It reads the `provider` of the last assistant message from `ctx.sessionManager.getBranch()` instead. Before the first reply of a turn, it falls back to the provider the virtual model is registered under.

Together with `pi-openrouter-balance` this means the DeepSeek balance shows during off-peak hours and the OpenRouter balance shows during peak hours — the two never appear at the same time.

The check is the host name of the provider's base URL, not the provider's name.

## Data source

`GET https://api.deepseek.com/user/balance`, authenticated with the provider key pi already holds (`ctx.modelRegistry.getApiKeyForProvider()`). No extra environment variable is needed.

```json
{"is_available":false,"balance_infos":[{"currency":"USD","total_balance":"0.00"}]}
```

The USD entry is preferred. When there is no USD balance, the first currency in the list is shown instead, for example `¥70.00`.

## Status bar colors

| Condition | Color |
|---|---|
| `is_available` is false (DeepSeek reports this when the balance is 0, and it then rejects new requests) | Red |
| Balance ≤ 0 | Red |
| Balance < threshold (5 by default) | Yellow |
| Otherwise | Normal |

When the query fails, the status reads a dim `💵 DS 登录✗` / `💵 DS 无密钥` / `💵 DS ✗`. A 401 or 403 clears the cache so a stale number is never shown.

## Install

```bash
pi install npm:@ymy88/pi-deepseek-balance
```

You can also install from git or from a local directory:

```bash
pi install git:github.com/ymy88/pi-deepseek-balance
pi install ~/Projects/pi-deepseek-balance
```

Then run `/reload` inside pi.

The unscoped name `pi-deepseek-balance` on npm belongs to another author, which is why this package is published under the `@ymy88` scope.

## Command

| Command | Effect |
|---|---|
| `/deepseek-balance` | Refresh immediately and report every currency balance plus whether the account is usable |

## Configuration (optional environment variables)

| Variable | Default |
|---|---|
| `DEEPSEEK_BALANCE_TTL_MS` | `300000` (5 minute cache) |
| `DEEPSEEK_BALANCE_LOW_USD` | `5` (below this the number turns yellow) |

Refreshes happen on `session_start`, `model_select`, and `agent_settled` (end of every turn), all bounded by the cache TTL.

## Tests

```bash
npm test
```

Only the pure functions are tested — parsing, currency ordering, colors, status text, host matching, and the visibility decision for virtual models. No network requests are made.

## License

MIT, see [LICENSE](LICENSE).
