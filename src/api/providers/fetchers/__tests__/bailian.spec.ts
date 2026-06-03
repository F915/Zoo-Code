import { getBailianModels } from "../bailian"

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

const BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
const API_KEY = "test-key"

beforeEach(() => {
	mockFetch.mockReset()
})

afterEach(() => {
	vi.restoreAllMocks()
})

function mockResponse(status: number, data: unknown) {
	mockFetch.mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		statusText: status === 200 ? "OK" : "Error",
		json: () => Promise.resolve(data),
		text: () => Promise.resolve(JSON.stringify(data)),
	})
}

describe("getBailianModels", () => {
	it("fetches from /models endpoint with auth header", async () => {
		mockResponse(200, { data: [] })
		await getBailianModels(BASE_URL, API_KEY)

		expect(mockFetch).toHaveBeenCalledTimes(1)
		const [url, init] = mockFetch.mock.calls[0]
		expect(url).toBe(`${BASE_URL}/models`)
		expect(init.headers["Authorization"]).toBe(`Bearer ${API_KEY}`)
	})

	it("returns preset spec for exact match model", async () => {
		mockResponse(200, { data: [{ id: "qwen3.6-plus" }] })

		const models = await getBailianModels(BASE_URL, API_KEY)
		expect(models["qwen3.6-plus"]).toBeDefined()
		const info = models["qwen3.6-plus"]
		expect(info.maxTokens).toBe(65536)
		expect(info.contextWindow).toBe(1_000_000)
		expect(info.supportsPromptCache).toBe(true)
		expect(info.supportsImages).toBe(true)
	})

	it("matches case-insensitively for exact match", async () => {
		mockResponse(200, { data: [{ id: "QWEN3.6-PLUS" }] })

		const models = await getBailianModels(BASE_URL, API_KEY)
		expect(models["QWEN3.6-PLUS"]).toBeDefined()
		expect(models["QWEN3.6-PLUS"].maxTokens).toBe(65536)
	})

	it("returns preset spec for substring match (versioned variant)", async () => {
		mockResponse(200, { data: [{ id: "qwen3.7-max-2026-05-17" }] })

		const models = await getBailianModels(BASE_URL, API_KEY)
		expect(models["qwen3.7-max-2026-05-17"]).toBeDefined()
		const info = models["qwen3.7-max-2026-05-17"]
		expect(info.maxTokens).toBe(65536)
		expect(info.contextWindow).toBe(1_000_000)
	})

	it("returns preset spec for substring match with namespace prefix", async () => {
		mockResponse(200, { data: [{ id: "kimi/kimi-k2.6" }] })

		const models = await getBailianModels(BASE_URL, API_KEY)
		expect(models["kimi/kimi-k2.6"]).toBeDefined()
		expect(models["kimi/kimi-k2.6"].maxTokens).toBe(98304)
		expect(models["kimi/kimi-k2.6"].contextWindow).toBe(262144)
	})

	it("matches case-insensitively for substring with different case namespace", async () => {
		// ZHIPU/GLM-5.1 contains substring "glm-5.1" (case-insensitive)
		mockResponse(200, { data: [{ id: "ZHIPU/GLM-5.1" }] })

		const models = await getBailianModels(BASE_URL, API_KEY)
		expect(models["ZHIPU/GLM-5.1"]).toBeDefined()
		expect(models["ZHIPU/GLM-5.1"].contextWindow).toBe(202752)
		expect(models["ZHIPU/GLM-5.1"].supportsPromptCache).toBe(true)
	})

	it("uses minimal metadata for unmatched models", async () => {
		mockResponse(200, { data: [{ id: "some-future-model" }] })

		const models = await getBailianModels(BASE_URL, API_KEY)
		expect(models["some-future-model"]).toBeDefined()
		expect(models["some-future-model"].contextWindow).toBe(200_000)
		expect(models["some-future-model"].supportsPromptCache).toBe(false)
		expect(models["some-future-model"].supportsImages).toBe(false)
	})

	it("filters out image models", async () => {
		mockResponse(200, {
			data: [{ id: "qwen-image-2.0-pro-2026-04-22" }, { id: "wanx-v1" }, { id: "qwen3.6-plus" }],
		})

		const models = await getBailianModels(BASE_URL, API_KEY)
		expect(models["qwen-image-2.0-pro-2026-04-22"]).toBeUndefined()
		expect(models["wanx-v1"]).toBeUndefined()
		expect(models["qwen3.6-plus"]).toBeDefined()
	})

	it("filters out embedding models", async () => {
		mockResponse(200, {
			data: [{ id: "text-embedding-v3" }, { id: "qwen3.6-flash" }],
		})

		const models = await getBailianModels(BASE_URL, API_KEY)
		expect(models["text-embedding-v3"]).toBeUndefined()
		expect(models["qwen3.6-flash"]).toBeDefined()
	})

	it("filters out speech/asr/tts models", async () => {
		mockResponse(200, {
			data: [
				{ id: "speech-synthesis-v1" },
				{ id: "paraformer-v2" },
				{ id: "cosyvoice-v1" },
				{ id: "sambert-v1" },
				{ id: "qwen3.6-plus" },
			],
		})

		const models = await getBailianModels(BASE_URL, API_KEY)
		expect(models["speech-synthesis-v1"]).toBeUndefined()
		expect(models["paraformer-v2"]).toBeUndefined()
		expect(models["cosyvoice-v1"]).toBeUndefined()
		expect(models["sambert-v1"]).toBeUndefined()
		expect(models["qwen3.6-plus"]).toBeDefined()
	})

	it("filters out video and ocr models", async () => {
		mockResponse(200, {
			data: [{ id: "video-understanding-v1" }, { id: "ocr-v1" }, { id: "deepseek-v4-pro" }],
		})

		const models = await getBailianModels(BASE_URL, API_KEY)
		expect(models["video-understanding-v1"]).toBeUndefined()
		expect(models["ocr-v1"]).toBeUndefined()
		expect(models["deepseek-v4-pro"]).toBeDefined()
	})

	it("returns empty object for empty response", async () => {
		mockResponse(200, { data: [] })

		const models = await getBailianModels(BASE_URL, API_KEY)
		expect(Object.keys(models)).toHaveLength(0)
	})

	it("throws on HTTP error", async () => {
		mockResponse(401, { error: "Unauthorized" })

		await expect(getBailianModels(BASE_URL, "bad-key")).rejects.toThrow("HTTP 401")
	})

	it("throws on malformed response", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			json: () => Promise.resolve({ not_data: true }),
			text: () => Promise.resolve('{"not_data":true}'),
		})

		await expect(getBailianModels(BASE_URL, API_KEY)).rejects.toThrow("Unexpected response format")
	})

	it("uses default base URL when none provided", async () => {
		mockResponse(200, { data: [] })
		await getBailianModels(undefined, API_KEY)

		const [url] = mockFetch.mock.calls[0]
		expect(url).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/models")
	})

	it("handles multiple models with mixed match types", async () => {
		mockResponse(200, {
			data: [
				{ id: "qwen3.7-max" },
				{ id: "qwen3.7-max-2026-05-20" },
				{ id: "ZHIPU/GLM-5.1" },
				{ id: "unknown-experimental" },
				{ id: "qwen-image-2.0-pro" },
			],
		})

		const models = await getBailianModels(BASE_URL, API_KEY)

		// Exact match
		expect(models["qwen3.7-max"].maxTokens).toBe(65536)
		// Substring match — versioned variant gets same preset as base
		expect(models["qwen3.7-max-2026-05-20"].maxTokens).toBe(65536)
		// ZHIPU/GLM-5.1 has "glm-5.1" as substring (case-insensitive)
		expect(models["ZHIPU/GLM-5.1"].contextWindow).toBe(202752)
		// Unknown model — included with minimal metadata
		expect(models["unknown-experimental"]).toBeDefined()
		expect(models["unknown-experimental"].contextWindow).toBe(200_000)
		expect(models["unknown-experimental"].supportsPromptCache).toBe(false)
		// Image model excluded
		expect(models["qwen-image-2.0-pro"]).toBeUndefined()
		// Total: 4 text models (unknown included with minimal metadata)
		expect(Object.keys(models)).toHaveLength(4)
	})

	it("preserves both API ID and preset ID as separate entries", async () => {
		mockResponse(200, {
			data: [{ id: "kimi/kimi-k2.6" }, { id: "kimi-k2.6" }],
		})

		const models = await getBailianModels(BASE_URL, API_KEY)
		expect(models["kimi/kimi-k2.6"]).toBeDefined()
		expect(models["kimi-k2.6"]).toBeDefined()
		expect(models["kimi/kimi-k2.6"].maxTokens).toBe(98304)
		expect(models["kimi-k2.6"].maxTokens).toBe(98304)
	})

	it("handles raw fetch rejection (network failure)", async () => {
		mockFetch.mockRejectedValue(new Error("fetch failed"))

		await expect(getBailianModels(BASE_URL, API_KEY)).rejects.toThrow("fetch failed")
	})

	it("passes AbortController signal to fetch", async () => {
		mockResponse(200, { data: [] })
		await getBailianModels(BASE_URL, API_KEY)

		const [, init] = mockFetch.mock.calls[0]
		expect(init.signal).toBeInstanceOf(AbortSignal)
	})

	it("skips models with non-string or empty id", async () => {
		mockResponse(200, {
			data: [{ id: null }, { id: 123 }, { id: "" }, { id: "qwen3.6-plus" }],
		})

		const models = await getBailianModels(BASE_URL, API_KEY)
		expect(Object.keys(models)).toHaveLength(1)
		expect(models["qwen3.6-plus"]).toBeDefined()
	})

	it("includes truncated error body in thrown Error message", async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 400,
			statusText: "Bad Request",
			json: () => Promise.resolve({}),
			text: () => Promise.resolve('{"code":"InvalidApiKey","message":"bad key"}'),
		})

		await expect(getBailianModels(BASE_URL, API_KEY)).rejects.toThrow("InvalidApiKey")
	})

	describe("findMatchingPreset", () => {
		it("returns exact match (case-insensitive)", async () => {
			const { findMatchingPreset } = await import("../bailian")
			expect(findMatchingPreset("qwen3.6-plus")).toBe("qwen3.6-plus")
			expect(findMatchingPreset("QWEN3.6-PLUS")).toBe("qwen3.6-plus")
		})

		it("returns longest substring match", async () => {
			const { findMatchingPreset } = await import("../bailian")
			expect(findMatchingPreset("qwen3.7-max-2026-05-17")).toBe("qwen3.7-max")
			expect(findMatchingPreset("kimi/kimi-k2.6")).toBe("kimi-k2.6")
			expect(findMatchingPreset("ZHIPU/GLM-5.1")).toBe("glm-5.1")
		})

		it("returns null for no match", async () => {
			const { findMatchingPreset } = await import("../bailian")
			expect(findMatchingPreset("completely-unknown-model")).toBeNull()
		})
	})
})
