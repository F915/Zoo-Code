import type { BailianModelId } from "./bailian.js"

export type BailianRegion =
	| "beijing"
	| "singapore"
	| "virginia"
	| "frankfurt"
	| "hongkong"
	| "coding-plan"
	| "token-plan"
	| "token-plan-sgp"

export interface BailianPrice {
	inputPrice: number
	outputPrice: number
	cacheReadsPrice?: number
	cacheWritesPrice?: number
}

// Pricing in USD per 1M tokens.
// Source: https://help.aliyun.com/zh/model-studio/model-pricing
// Explicit cache pricing: writes = 1.25 × input, reads = 0.1 × input (cachedoc.md)

const CACHE_WRITES_RATIO = 1.25
const CACHE_READS_RATIO = 0.1

// Ordered: Qwen > DeepSeek > GLM > Kimi > MiniMax; higher version > lower; max > plus > flash > other
const CN_GLOBAL_PRICES: Record<BailianModelId, BailianPrice> = {
	"qwen3.7-max": { inputPrice: 1.65, outputPrice: 4.951 },
	"qwen3.7-plus": { inputPrice: 0.287, outputPrice: 1.147 },
	"qwen3.6-plus": { inputPrice: 0.276, outputPrice: 1.651 },
	"qwen3.6-flash": { inputPrice: 0.165, outputPrice: 0.99 },
	"qwen3.5-plus": { inputPrice: 0.115, outputPrice: 0.688 },
	"qwen3.5-flash": { inputPrice: 0.029, outputPrice: 0.287 },
	"deepseek-v4-pro": { inputPrice: 1.65, outputPrice: 3.301 },
	"deepseek-v4-flash": { inputPrice: 0.138, outputPrice: 0.275 },
	"glm-5.1": { inputPrice: 0.825, outputPrice: 3.301 },
	"kimi-k2.6": { inputPrice: 0.8939, outputPrice: 3.7131 },
	"mimo-v2.5-pro": { inputPrice: 0, outputPrice: 0 },
	"MiniMax-M2.5": { inputPrice: 0.304, outputPrice: 1.213 },
}

// International (Singapore + Token Plan Singapore)
const INTL_PRICES: Partial<Record<BailianModelId, BailianPrice>> = {
	"qwen3.7-max": { inputPrice: 2.5, outputPrice: 7.5 },
	"qwen3.7-plus": { inputPrice: 0.4, outputPrice: 1.6 },
	"qwen3.6-plus": { inputPrice: 0.5, outputPrice: 3 },
	"qwen3.6-flash": { inputPrice: 0.25, outputPrice: 1.5 },
	"qwen3.5-plus": { inputPrice: 0.4, outputPrice: 2.4 },
	"qwen3.5-flash": { inputPrice: 0.1, outputPrice: 0.4 },
	"deepseek-v4-pro": { inputPrice: 2.4, outputPrice: 4.8 },
	"deepseek-v4-flash": { inputPrice: 0.2, outputPrice: 0.4 },
	"glm-5.1": { inputPrice: 1.4, outputPrice: 4.4 },
}

// Hong Kong / EU specific pricing
const HK_EU_PRICES: Partial<Record<BailianModelId, BailianPrice>> = {
	// Reserved for future HK/EU-specific overrides
}

// US specific pricing
const US_PRICES: Partial<Record<BailianModelId, BailianPrice>> = {
	// Reserved for future US-specific overrides
}

export function getBailianPrice(modelId: string, region?: BailianRegion): BailianPrice | undefined {
	// Canonicalize versioned/named-space API IDs (e.g. "qwen3.7-max-2026-05-17",
	// "kimi/kimi-k2.6", "ZHIPU/GLM-5.1") to preset keys for pricing lookup.
	// Uses case-insensitive exact match → longest substring match against
	// CN_GLOBAL_PRICES (the master table). Matches the fetcher's
	// findMatchingPreset() logic.
	const canonicalKey = findMatchingPricingKey(modelId, CN_GLOBAL_PRICES) ?? modelId

	let base: BailianPrice | undefined

	switch (region) {
		case "beijing":
		case "coding-plan":
		case "token-plan":
			base = CN_GLOBAL_PRICES[canonicalKey as BailianModelId]
			break
		case "singapore":
		case "token-plan-sgp":
			base = INTL_PRICES[canonicalKey as BailianModelId] ?? CN_GLOBAL_PRICES[canonicalKey as BailianModelId]
			break
		case "hongkong":
			base = HK_EU_PRICES[canonicalKey as BailianModelId] ?? CN_GLOBAL_PRICES[canonicalKey as BailianModelId]
			break
		case "frankfurt":
			base = HK_EU_PRICES[canonicalKey as BailianModelId] ?? CN_GLOBAL_PRICES[canonicalKey as BailianModelId]
			break
		case "virginia":
			base = US_PRICES[canonicalKey as BailianModelId] ?? CN_GLOBAL_PRICES[canonicalKey as BailianModelId]
			break
		default:
			base = CN_GLOBAL_PRICES[canonicalKey as BailianModelId]
	}

	if (!base) return undefined

	return {
		...base,
		cacheWritesPrice: round4(base.inputPrice * CACHE_WRITES_RATIO),
		cacheReadsPrice: round4(base.inputPrice * CACHE_READS_RATIO),
	}
}

/**
 * Find the best-matching pricing key for a model ID against a pricing table.
 * Case-insensitive exact match first, then longest substring match.
 * Returns undefined if no match is found.
 */
function findMatchingPricingKey(modelId: string, table: Record<string, BailianPrice>): string | undefined {
	const lowerId = modelId.toLowerCase()
	const keys = Object.keys(table)

	// Priority 1: exact match (case-insensitive)
	const exact = keys.find((k) => k.toLowerCase() === lowerId)
	if (exact) return exact

	// Priority 2: longest substring match
	let best: string | undefined
	let bestLen = 0
	for (const k of keys) {
		const lk = k.toLowerCase()
		if (lowerId.includes(lk) && lk.length > bestLen) {
			best = k
			bestLen = lk.length
		}
	}
	return best
}

function round4(n: number): number {
	return Math.round(n * 10000) / 10000
}
