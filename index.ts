/**
 * pi-deepseek-balance - 把 DeepSeek 官方账户余额显示在 pi 状态栏。
 *
 * 是否显示按 provider 判断，和 pi-ark-quota 一样：只有当前模型实际落在
 * api.deepseek.com 上时才显示。当前模型是虚拟模型（比如 deepseek/auto）时，
 * 用会话分支里最后一条回复的 provider 判断，所以平峰期显示这个余额，高峰期
 * 这个扩展自动隐藏（那时候请求走 OpenRouter）。
 *
 * 查询接口：GET https://api.deepseek.com/user/balance（用 pi 里已有的 provider 密钥）
 * 状态栏：💵 DS $12.34；余额为 0 或账户不可用时标红
 *
 * 配置（环境变量）：
 *   DEEPSEEK_BALANCE_TTL_MS   缓存时间，默认 300000（5 分钟）
 *   DEEPSEEK_BALANCE_LOW_USD  低于这个余额标黄，默认 5
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const HOST = "api.deepseek.com";
const PROVIDER_ID = "deepseek";
const ENDPOINT = `https://${HOST}/user/balance`;
const STATUS_KEY = "deepseek-balance";
const COMMAND = "deepseek-balance";
const LABEL = "DS";
/** 虚拟模型目录条目的 api 值，见 pi 的 virtual-models。 */
const VIRTUAL_API = "pi-virtual";
const TIMEOUT_MS = 15_000;

const TTL_MS = Number(process.env.DEEPSEEK_BALANCE_TTL_MS) || 5 * 60 * 1000;
const LOW_USD = Number(process.env.DEEPSEEK_BALANCE_LOW_USD ?? 5);

export interface Money {
	currency: string;
	total: number;
}

export interface Balance {
	/** DeepSeek 是否接受新请求；余额为 0 时它是 false。 */
	available: boolean;
	/** 所有币种的余额，美元在前。 */
	infos: Money[];
	/** 美元余额，没有美元条目时为 undefined。 */
	usd: number | undefined;
}

// ---- 纯函数（导出给测试用）----

const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", CNY: "¥" };

function symbolOf(currency: string): string {
	return CURRENCY_SYMBOL[currency] ?? `${currency} `;
}

/** 从 /user/balance 的响应里取出余额，美元条目排最前面。 */
export function parseBalance(json: any): Balance | null {
	const raw = json?.balance_infos;
	if (!Array.isArray(raw)) return null;
	const infos: Money[] = raw
		.map((item: any) => ({ currency: String(item?.currency ?? ""), total: Number(item?.total_balance) }))
		.filter((m: Money) => m.currency && Number.isFinite(m.total));
	if (!infos.length) return null;
	infos.sort((a, b) => (a.currency === "USD" ? -1 : b.currency === "USD" ? 1 : 0));
	return {
		available: json?.is_available === true,
		infos,
		usd: infos.find((m) => m.currency === "USD")?.total,
	};
}

/** 余额对应的颜色：账户不可用或余额不是正数报红，低于阈值标黄。 */
export function colorRole(b: Balance, low = LOW_USD): "success" | "warning" | "error" {
	const main = b.usd ?? b.infos[0].total;
	if (!b.available || main <= 0) return "error";
	if (main < low) return "warning";
	return "success";
}

/** 状态栏文本。 */
export function renderBalance(fg: (role: string, text: string) => string, b: Balance): string {
	const main = b.usd !== undefined ? { currency: "USD", total: b.usd } : b.infos[0];
	return `💵 ${LABEL} ${fg(colorRole(b), `${symbolOf(main.currency)}${main.total.toFixed(2)}`)}`;
}

/** /deepseek-balance 的详情。 */
export function formatDetails(b: Balance): string {
	const lines = b.infos.map((m) => `${m.currency} ${m.total.toFixed(2)}`);
	const state = b.available ? "可用" : "不可用（余额不足或账户被停用，DeepSeek 会拒绝新请求）";
	return `DeepSeek 余额：${lines.join(" / ")}\n状态：${state}`;
}

/** 取 URL 的主机名，解析失败返回 undefined。 */
export function hostOf(url: string | undefined): string | undefined {
	if (!url) return undefined;
	try {
		return new URL(url).host.toLowerCase();
	} catch {
		return undefined;
	}
}

/** 这个 baseUrl 是否指向本扩展关心的服务。 */
export function isTargetHost(url: string | undefined, host = HOST): boolean {
	return hostOf(url) === host;
}

/**
 * 当前该看哪个 provider 的余额。
 * 物理模型就是它自己的 provider；虚拟模型用分支里最后一条回复的 provider，
 * 也就是真正回答了上一轮的那个端点。
 */
export function activeProvider(ctx: any): string | undefined {
	const selected = ctx?.model;
	if (!selected) return undefined;
	if (selected.api !== VIRTUAL_API) return selected.provider;
	const branch: any[] = ctx?.sessionManager?.getBranch?.() ?? [];
	for (let i = branch.length - 1; i >= 0; i--) {
		const message = branch[i]?.message;
		if (message?.role === "assistant" && typeof message.provider === "string") return message.provider;
	}
	return selected.provider; // 还没收到过回复，先按虚拟模型登记的 provider
}

// ---- 扩展 ----

export default function deepseekBalance(pi: ExtensionAPI) {
	let lastCtx: any = null;
	let lastProvider: string | undefined;
	let cache: Balance | null = null;
	let cacheKey: string | undefined; // 缓存属于哪个 provider
	let fetchedAt = 0;
	let inFlight = false;
	let failure: "auth" | "error" | "no-key" | null = null;

	function provider(ctx: any): string | undefined {
		const id = activeProvider(ctx);
		if (!id) return undefined;
		// baseUrl 指向 api.deepseek.com 就算命中，不依赖 provider 叫什么名字。
		const baseUrl = ctx?.modelRegistry?.getProvider?.(id)?.baseUrl;
		if (baseUrl) return isTargetHost(baseUrl) ? id : undefined;
		return id === PROVIDER_ID ? id : undefined;
	}

	function bindFg(ctx: any): ((role: string, text: string) => string) | null {
		try {
			return ctx?.ui?.theme?.fg?.bind(ctx.ui.theme) ?? null;
		} catch {
			return null; // 主题还没准备好
		}
	}

	async function fetchBalance(ctx: any): Promise<Balance | null> {
		if (inFlight) return cache;
		const id = provider(ctx);
		if (!id) return null;
		if (cache && cacheKey === id && Date.now() - fetchedAt < TTL_MS) return cache;
		inFlight = true;
		try {
			const key = await ctx.modelRegistry.getApiKeyForProvider(id);
			if (!key) {
				failure = "no-key";
				return null;
			}
			const res = await fetch(ENDPOINT, {
				headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if (res.status === 401 || res.status === 403) {
				failure = "auth";
				cache = null; // 旧数据会骗人
				return null;
			}
			if (!res.ok) {
				failure = "error";
				return null;
			}
			const parsed = parseBalance(await res.json());
			if (!parsed) {
				failure = "error";
				return null;
			}
			cache = parsed;
			cacheKey = id;
			fetchedAt = Date.now();
			failure = null;
			return cache;
		} catch {
			failure = "error";
			return null;
		} finally {
			inFlight = false;
		}
	}

	async function sync(ctx: any) {
		const setStatus = ctx?.ui?.setStatus;
		if (!setStatus) return;
		if (!provider(ctx)) {
			setStatus(STATUS_KEY, undefined);
			return;
		}
		const fg = bindFg(ctx);
		if (!fg) return;
		if (!cache) setStatus(STATUS_KEY, fg("dim", `💵 ${LABEL} …`));
		const balance = await fetchBalance(ctx);
		if (balance) {
			setStatus(STATUS_KEY, renderBalance(fg, balance));
			return;
		}
		if (!cache) {
			const text =
				failure === "auth" ? `💵 ${LABEL} 登录✗` : failure === "no-key" ? `💵 ${LABEL} 无密钥` : `💵 ${LABEL} ✗`;
			setStatus(STATUS_KEY, fg("dim", text));
			return;
		}
		setStatus(STATUS_KEY, renderBalance(fg, cache));
	}

	pi.on("session_start", async (_event, ctx) => {
		lastCtx = ctx;
		await sync(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		lastCtx = ctx;
		// 换了端点就重查，同一端点沿用缓存。
		if (lastProvider !== undefined && lastProvider !== provider(ctx)) fetchedAt = 0;
		lastProvider = provider(ctx);
		await sync(ctx);
	});

	pi.on("agent_settled", async () => {
		const ctx = lastCtx;
		if (!ctx?.ui?.setStatus) return;
		// 虚拟模型可能刚换了端点，这一轮结束后重新判断可见性。
		await sync(ctx);
	});

	pi.registerCommand(COMMAND, {
		description: "显示 DeepSeek 官方余额并强制刷新",
		handler: async (_args, ctx) => {
			lastCtx = ctx;
			if (!provider(ctx)) {
				ctx?.ui?.notify?.(`当前模型不在 DeepSeek 官方端点上，没有可显示的 ${LABEL} 余额`, "info");
				return;
			}
			fetchedAt = 0; // 强制刷新
			const balance = await fetchBalance(ctx);
			if (!balance) {
				const hint =
					failure === "auth"
						? "DeepSeek 密钥无效，请用 /login 重新登录 deepseek"
						: failure === "no-key"
							? "没有找到 deepseek 的密钥，请用 /login 登录"
							: "查询 DeepSeek 余额失败，请检查网络后重试";
				ctx?.ui?.notify?.(hint, "error");
				return;
			}
			const fg = bindFg(ctx);
			if (fg && ctx?.ui?.setStatus) ctx.ui.setStatus(STATUS_KEY, renderBalance(fg, balance));
			ctx?.ui?.notify?.(formatDetails(balance), balance.available ? "info" : "warning");
		},
	});
}
