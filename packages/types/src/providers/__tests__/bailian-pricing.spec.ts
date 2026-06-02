import { describe, it, expect } from "vitest"
import { getBailianPrice } from "../bailian-pricing.js"

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

	it("computes cache pricing proportionally", () => {
		const p = getBailianPrice("qwen3.6-plus", "beijing")
		expect(p).toBeDefined()
		expect(p!.cacheWritesPrice).toBe(0.345)
		expect(p!.cacheReadsPrice).toBe(0.0276)
	})
})
