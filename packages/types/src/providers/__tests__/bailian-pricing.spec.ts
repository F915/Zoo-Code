import { describe, it, expect } from "vitest"
import { BAILIAN_REGIONS, CN_GLOBAL_PRICES, INTL_PRICES, getBailianPrice } from "../bailian-pricing.js"
import { bailianModels } from "../bailian.js"

describe("getBailianPrice", () => {
	it("returns beijing pricing for exact model ID", () => {
		const p = getBailianPrice("qwen3.6-plus", "beijing")
		expect(p).toBeDefined()
		expect(p!.inputPrice).toBe(0.276)
	})

	it("canonicalizes versioned variant to correct pricing", () => {
		const p = getBailianPrice("qwen3.7-max-2026-05-17", "singapore")
		expect(p).toBeDefined()
		expect(p!.inputPrice).toBe(2.5)
	})

	it("canonicalizes namespaced variant", () => {
		const p = getBailianPrice("kimi/kimi-k2.6", "beijing")
		expect(p).toBeDefined()
		expect(p!.inputPrice).toBe(0.8939)
	})

	it("canonicalizes case-insensitive namespaced variant", () => {
		const p = getBailianPrice("ZHIPU/GLM-5.1", "beijing")
		expect(p).toBeDefined()
		expect(p!.inputPrice).toBe(0.825)
	})

	it("returns undefined for unknown model", () => {
		const p = getBailianPrice("completely-unknown-model", "beijing")
		expect(p).toBeUndefined()
	})

	it("returns undefined for model with unavailable pricing", () => {
		const p = getBailianPrice("mimo-v2.5-pro", "beijing")
		expect(p).toBeUndefined()
	})

	it("computes cache pricing proportionally", () => {
		const p = getBailianPrice("qwen3.6-plus", "beijing")
		expect(p).toBeDefined()
		expect(p!.cacheWritesPrice).toBe(0.345)
		expect(p!.cacheReadsPrice).toBe(0.0276)
	})

	it("BAILIAN_REGIONS contains all 8 expected region values", () => {
		expect(BAILIAN_REGIONS).toHaveLength(8)
		expect(BAILIAN_REGIONS).toContain("beijing")
		expect(BAILIAN_REGIONS).toContain("singapore")
		expect(BAILIAN_REGIONS).toContain("virginia")
		expect(BAILIAN_REGIONS).toContain("frankfurt")
		expect(BAILIAN_REGIONS).toContain("hongkong")
		expect(BAILIAN_REGIONS).toContain("coding-plan")
		expect(BAILIAN_REGIONS).toContain("token-plan")
		expect(BAILIAN_REGIONS).toContain("token-plan-sgp")
	})
})

describe("pricing consistency between bailian.ts and bailian-pricing.ts", () => {
	// Collect all models that have pricing in at least one table
	const pricedModels = new Set(
		Object.keys({
			...CN_GLOBAL_PRICES,
			...INTL_PRICES,
		} as Record<string, unknown>),
	)

	for (const modelId of pricedModels) {
		const modelDef = bailianModels[modelId as keyof typeof bailianModels] as {
			inputPrice?: number
			outputPrice?: number
			cacheWritesPrice?: number
			cacheReadsPrice?: number
		}
		if (!modelDef) {
			continue // Pricing added before bailian.ts definition — skip
		}

		it(`bailian.ts inputPrice matches bailian-pricing.ts for "${modelId}"`, () => {
			const price = getBailianPrice(modelId, "beijing")
			// If getBailianPrice returns undefined, bailian.ts should have no pricing
			if (!price) {
				expect(modelDef.inputPrice).toBeUndefined()
				expect(modelDef.outputPrice).toBeUndefined()
				return
			}
			// Otherwise values must match
			expect(modelDef.inputPrice).toBe(price.inputPrice)
			expect(modelDef.outputPrice).toBe(price.outputPrice)
		})

		it(`bailian.ts cache price matches bailian-pricing.ts computed value for "${modelId}"`, () => {
			const price = getBailianPrice(modelId, "beijing")
			if (!price) {
				return
			}
			if (modelDef.cacheWritesPrice !== undefined) {
				// Use toBeCloseTo to tolerate floating-point rounding in computations
				// like round4(inputPrice * 1.25) where e.g. 0.287 * 1.25 may yield
				// 0.35874999999999996 → round4 = 0.3587 instead of the true 0.3588.
				expect(modelDef.cacheWritesPrice).toBeCloseTo(price.cacheWritesPrice!, 3)
			}
			if (modelDef.cacheReadsPrice !== undefined) {
				expect(modelDef.cacheReadsPrice).toBeCloseTo(price.cacheReadsPrice!, 3)
			}
		})
	}
})

describe("region fallback pricing", () => {
	it("returns CN_GLOBAL_PRICES fallback for model not in INTL_PRICES (singapore)", () => {
		// kimi-k2.6 is in CN_GLOBAL_PRICES but NOT in INTL_PRICES
		const p = getBailianPrice("kimi-k2.6", "singapore")
		expect(p).toBeDefined()
		expect(p!.inputPrice).toBe(0.8939) // CN pricing
	})

	it("returns INTL_PRICES price when model exists there (singapore)", () => {
		// glm-5.1 is in both tables, CN=0.825 vs INTL=1.4
		const p = getBailianPrice("glm-5.1", "singapore")
		expect(p).toBeDefined()
		expect(p!.inputPrice).toBe(1.4) // INTL takes priority
	})

	it("returns token-plan-sgp INTL_PRICES fallback for model not in INTL", () => {
		const p = getBailianPrice("MiniMax-M2.5", "token-plan-sgp")
		expect(p).toBeDefined()
		expect(p!.inputPrice).toBe(0.304) // Falls back to CN
	})

	it("returns CN_GLOBAL_PRICES fallback for hongkong (HK_EU_PRICES empty)", () => {
		const p = getBailianPrice("qwen3.7-plus", "hongkong")
		expect(p).toBeDefined()
		expect(p!.inputPrice).toBe(0.287) // From CN (HK_EU is empty)
	})

	it("returns CN_GLOBAL_PRICES fallback for frankfurt (HK_EU_PRICES empty)", () => {
		const p = getBailianPrice("deepseek-v4-pro", "frankfurt")
		expect(p).toBeDefined()
		expect(p!.inputPrice).toBe(1.65) // From CN (HK_EU is empty)
	})

	it("returns CN_GLOBAL_PRICES fallback for virginia (US_PRICES empty)", () => {
		const p = getBailianPrice("qwen3.6-flash", "virginia")
		expect(p).toBeDefined()
		expect(p!.inputPrice).toBe(0.165) // From CN (US is empty)
	})
})
