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
	"qwen3.6-plus": { inputPrice: 0.276, outputPrice: 1.651 },
	"qwen3.6-flash": { inputPrice: 0.165, outputPrice: 0.99 },
	"deepseek-v4-pro": { inputPrice: 1.65, outputPrice: 3.301 },
	"deepseek-v4-flash": { inputPrice: 0.138, outputPrice: 0.275 },
	"glm-5.1": { inputPrice: 0.825, outputPrice: 3.301 },
	"kimi-k2.6": { inputPrice: 0.8939, outputPrice: 3.7131 },
	"MiniMax-M2.5": { inputPrice: 0.304, outputPrice: 1.213 },
}

// International (Singapore + Token Plan Singapore)
const INTL_PRICES: Partial<Record<BailianModelId, BailianPrice>> = {
	"qwen3.7-max": { inputPrice: 2.5, outputPrice: 7.5 },
	"qwen3.6-plus": { inputPrice: 0.5, outputPrice: 3 },
	"qwen3.6-flash": { inputPrice: 0.25, outputPrice: 1.5 },
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
	let base: BailianPrice | undefined

	switch (region) {
		case "beijing":
		case "coding-plan":
		case "token-plan":
			base = CN_GLOBAL_PRICES[modelId as BailianModelId]
			break
		case "singapore":
		case "token-plan-sgp":
			base = INTL_PRICES[modelId as BailianModelId] ?? CN_GLOBAL_PRICES[modelId as BailianModelId]
			break
		case "hongkong":
			base = HK_EU_PRICES[modelId as BailianModelId] ?? CN_GLOBAL_PRICES[modelId as BailianModelId]
			break
		case "frankfurt":
			base = HK_EU_PRICES[modelId as BailianModelId] ?? CN_GLOBAL_PRICES[modelId as BailianModelId]
			break
		case "virginia":
			base = US_PRICES[modelId as BailianModelId] ?? CN_GLOBAL_PRICES[modelId as BailianModelId]
			break
		default:
			base = CN_GLOBAL_PRICES[modelId as BailianModelId]
	}

	if (!base) return undefined

	return {
		...base,
		cacheWritesPrice: round4(base.inputPrice * CACHE_WRITES_RATIO),
		cacheReadsPrice: round4(base.inputPrice * CACHE_READS_RATIO),
	}
}

function round4(n: number): number {
	return Math.round(n * 10000) / 10000
}
