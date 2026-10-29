/** 纯函数自检，直接 node --experimental-strip-types 跑。 */

import assert from "node:assert/strict";
import {
	activeProvider,
	colorRole,
	formatDetails,
	hostOf,
	isTargetHost,
	parseBalance,
	renderBalance,
} from "../index.ts";

const identity = (_role: string, text: string) => text;

// /user/balance 的真实响应形状（当前账户余额为 0）
const real = {
	is_available: false,
	balance_infos: [
		{ currency: "USD", total_balance: "0.00", granted_balance: "0.00", topped_up_balance: "0.00" },
		{ currency: "CNY", total_balance: "-0.00", granted_balance: "0.00", topped_up_balance: "-0.00" },
	],
};
const balance = parseBalance(real);
assert.ok(balance);
assert.equal(balance.available, false);
assert.equal(balance.usd, 0);
assert.equal(balance.infos.length, 2);

// 美元条目排在最前面，即使原始顺序相反
const cnyFirst = parseBalance({
	is_available: true,
	balance_infos: [
		{ currency: "CNY", total_balance: "70.00" },
		{ currency: "USD", total_balance: "10.00" },
	],
});
assert.ok(cnyFirst);
assert.equal(cnyFirst.infos[0].currency, "USD");
assert.equal(cnyFirst.usd, 10);
assert.equal(cnyFirst.available, true);

// 只有人民币时没有美元余额
const cnyOnly = parseBalance({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "70.00" }] });
assert.ok(cnyOnly);
assert.equal(cnyOnly.usd, undefined);

// 坏数据
assert.equal(parseBalance({}), null);
assert.equal(parseBalance({ balance_infos: [] }), null);
assert.equal(parseBalance({ balance_infos: [{ currency: "USD", total_balance: "abc" }] }), null);

// 颜色：不可用或非正数报红
assert.equal(colorRole(balance), "error");
assert.equal(colorRole(cnyFirst), "success");
assert.equal(colorRole({ ...cnyFirst, usd: 3 }), "warning");
assert.equal(colorRole({ ...cnyFirst, usd: 0 }), "error");
assert.equal(colorRole({ ...cnyFirst, available: false, usd: 99 }), "error");

// 状态栏文本
assert.equal(renderBalance(identity, balance), "💵 DS $0.00");
assert.equal(renderBalance(identity, cnyOnly), "💵 DS ¥70.00");
assert.match(formatDetails(balance), /unavailable/);

// 主机名匹配
assert.equal(hostOf("https://api.deepseek.com"), "api.deepseek.com");
assert.equal(isTargetHost("https://api.deepseek.com/v1"), true);
assert.equal(isTargetHost("https://openrouter.ai/api/v1"), false);
assert.equal(isTargetHost(undefined), false);

// 可见性：物理模型用自身 provider
assert.equal(activeProvider({ model: { provider: "deepseek", api: "openai-completions" } }), "deepseek");

// 虚拟模型用分支里最后一条助手的 provider
const ctx = (messages: any[]) => ({
	model: { provider: "deepseek", id: "auto", api: "pi-virtual" },
	sessionManager: { getBranch: () => messages.map((message) => ({ type: "message", message })) },
});
assert.equal(activeProvider(ctx([{ role: "assistant", provider: "openrouter" }])), "openrouter");
assert.equal(activeProvider(ctx([{ role: "assistant", provider: "deepseek" }])), "deepseek");
assert.equal(activeProvider(ctx([{ role: "user" }])), "deepseek");

console.log("pi-deepseek-balance: 全部通过");
