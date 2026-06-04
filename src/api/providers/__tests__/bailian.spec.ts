// npx vitest run src/api/providers/__tests__/bailian.spec.ts

import OpenAI from "openai"
import { Anthropic } from "@anthropic-ai/sdk"

import { type BailianModelId, bailianDefaultModelId, bailianModels } from "@roo-code/types"

import { BailianHandler } from "../bailian"
import { getModelsFromCache } from "../fetchers/modelCache"

vitest.mock("openai", () => {
	const createMock = vitest.fn()
	return {
		default: vitest.fn(() => ({ chat: { completions: { create: createMock } } })),
	}
})

vitest.mock("../fetchers/modelCache", () => ({
	getModelsFromCache: vitest.fn(),
}))

describe("BailianHandler", () => {
	let handler: BailianHandler
	let mockCreate: any

	beforeEach(() => {
		vitest.clearAllMocks()
		mockCreate = (OpenAI as unknown as any)().chat.completions.create
		handler = new BailianHandler({ bailianApiKey: "test-key", bailianRegion: "beijing" })
		vi.mocked(getModelsFromCache).mockReturnValue(undefined)
	})

	// --- Model ID handling (Mode B: ID passthrough) ---

	it("passes through user-provided model ID (mode B)", () => {
		const h = new BailianHandler({ bailianApiKey: "test-key", apiModelId: "custom-model" })
		expect(h.getModel().id).toBe("custom-model")
	})

	it("returns default model ID when none provided", () => {
		expect(handler.getModel().id).toBe(bailianDefaultModelId)
	})

	it("uses minimal fallback for unknown model ID", () => {
		const h = new BailianHandler({ bailianApiKey: "test-key", apiModelId: "unknown" })
		const result = h.getModel()
		expect(result.id).toBe("unknown")
		expect(result.info.contextWindow).toBe(200_000)
		expect(result.info.supportsPromptCache).toBe(false)
		expect(result.info.maxTokens).toBeUndefined()
	})

	it("returns known model with exact info", () => {
		const testModelId: BailianModelId = "qwen3.7-max"
		const h = new BailianHandler({ bailianApiKey: "test-key", apiModelId: testModelId })
		const result = h.getModel()
		expect(result.id).toBe(testModelId)
		expect(result.info.inputPrice).toBe(bailianModels[testModelId].inputPrice)
		expect(result.info.outputPrice).toBe(bailianModels[testModelId].outputPrice)
		expect(result.info.contextWindow).toBe(bailianModels[testModelId].contextWindow)
	})

	// --- getModel() returns getModelParams-computed fields ---

	it("getModel returns maxTokens from getModelParams", () => {
		const result = handler.getModel()
		expect(result).toHaveProperty("maxTokens")
	})

	it("getModel returns temperature from getModelParams", () => {
		const result = handler.getModel()
		expect(result).toHaveProperty("temperature")
	})

	// --- Endpoint configuration ---

	it("should use Beijing base URL by default", () => {
		new BailianHandler({ bailianApiKey: "test-key" })
		expect(OpenAI).toHaveBeenCalledWith(
			expect.objectContaining({ baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1" }),
		)
	})

	it("should use Singapore base URL when region is singapore", () => {
		new BailianHandler({ bailianApiKey: "test-key", bailianRegion: "singapore" })
		expect(OpenAI).toHaveBeenCalledWith(
			expect.objectContaining({ baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" }),
		)
	})

	it("should use Coding Plan base URL when region is coding-plan", () => {
		new BailianHandler({ bailianApiKey: "test-key", bailianRegion: "coding-plan" })
		expect(OpenAI).toHaveBeenCalledWith(
			expect.objectContaining({ baseURL: "https://coding.dashscope.aliyuncs.com/v1" }),
		)
	})

	it("should construct Frankfurt base URL with workspaceId", () => {
		new BailianHandler({ bailianApiKey: "test-key", bailianRegion: "frankfurt", bailianWorkspaceId: "ws-123" })
		expect(OpenAI).toHaveBeenCalledWith(
			expect.objectContaining({ baseURL: "https://ws-123.eu-central-1.maas.aliyuncs.com/compatible-mode/v1" }),
		)
	})

	it("should construct Hong Kong base URL with workspaceId", () => {
		new BailianHandler({ bailianApiKey: "test-key", bailianRegion: "hongkong", bailianWorkspaceId: "hk-456" })
		expect(OpenAI).toHaveBeenCalledWith(
			expect.objectContaining({ baseURL: "https://hk-456.cn-hongkong.maas.aliyuncs.com/compatible-mode/v1" }),
		)
	})

	// --- Constructor error tests (previously outside describe block) ---

	it("should throw when Frankfurt region is used without workspaceId", () => {
		expect(() => new BailianHandler({ bailianApiKey: "test-key", bailianRegion: "frankfurt" })).toThrow()
	})

	it("should throw when Hong Kong region is used without workspaceId", () => {
		expect(() => new BailianHandler({ bailianApiKey: "test-key", bailianRegion: "hongkong" })).toThrow()
	})

	it("should throw when region is not recognized", () => {
		expect(() => new BailianHandler({ bailianApiKey: "test-key", bailianRegion: "invalid-region" as any })).toThrow(
			/Unknown Bailian region/,
		)
	})

	it("error message lists valid regions", () => {
		try {
			new BailianHandler({ bailianApiKey: "test-key", bailianRegion: "unknown" as any })
			expect.unreachable("should have thrown")
		} catch (e: any) {
			expect(e.message).toContain("beijing")
			expect(e.message).toContain("singapore")
		}
	})

	// --- Streaming ---

	it("createMessage should yield text content from stream", async () => {
		const testContent = "Hello from Bailian"
		mockCreate.mockImplementationOnce(() => ({
			[Symbol.asyncIterator]: () => ({
				next: vitest
					.fn()
					.mockResolvedValueOnce({ done: false, value: { choices: [{ delta: { content: testContent } }] } })
					.mockResolvedValueOnce({ done: true }),
			}),
		}))

		const stream = handler.createMessage("system prompt", [])
		const firstChunk = await stream.next()
		expect(firstChunk.done).toBe(false)
		expect(firstChunk.value).toEqual({ type: "text", text: testContent })
	})

	it("createMessage should yield reasoning content from stream", async () => {
		const reasoningText = "Let me think about this..."
		mockCreate.mockImplementationOnce(() => ({
			[Symbol.asyncIterator]: () => ({
				next: vitest
					.fn()
					.mockResolvedValueOnce({
						done: false,
						value: { choices: [{ delta: { reasoning_content: reasoningText } }] },
					})
					.mockResolvedValueOnce({ done: true }),
			}),
		}))

		const stream = handler.createMessage("system prompt", [])
		const firstChunk = await stream.next()
		expect(firstChunk.done).toBe(false)
		expect(firstChunk.value).toEqual({ type: "reasoning", text: reasoningText })
	})

	it("createMessage should yield usage data from stream", async () => {
		mockCreate.mockImplementationOnce(() => ({
			[Symbol.asyncIterator]: () => ({
				next: vitest
					.fn()
					.mockResolvedValueOnce({
						done: false,
						value: { choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 20 } },
					})
					.mockResolvedValueOnce({ done: true }),
			}),
		}))

		const stream = handler.createMessage("system prompt", [])
		const firstChunk = await stream.next()
		expect(firstChunk.done).toBe(false)
		expect(firstChunk.value).toMatchObject({ type: "usage", inputTokens: 10, outputTokens: 20 })
	})

	// --- Bailian-specific reasoning parameters ---

	it("should include enable_thinking as top-level param when thinking is enabled (binary model)", async () => {
		const h = new BailianHandler({
			bailianApiKey: "test-key",
			enableReasoningEffort: true,
			apiModelId: "qwen3.6-plus",
		})

		mockCreate.mockImplementationOnce(() => ({
			[Symbol.asyncIterator]: () => ({ next: vitest.fn().mockResolvedValue({ done: true }) }),
		}))

		const generator = h.createMessage("system prompt", [])
		await generator.next()

		expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ enable_thinking: true }), undefined)
	})

	it("should include thinking_budget when modelMaxThinkingTokens is set", async () => {
		const h = new BailianHandler({
			bailianApiKey: "test-key",
			enableReasoningEffort: true,
			modelMaxThinkingTokens: 4096,
		})

		mockCreate.mockImplementationOnce(() => ({
			[Symbol.asyncIterator]: () => ({ next: vitest.fn().mockResolvedValue({ done: true }) }),
		}))

		const generator = h.createMessage("system prompt", [])
		await generator.next()

		expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ thinking_budget: 4096 }), undefined)
	})

	it("should NOT include enable_thinking for MiniMax-M2.5 (no reasoning flags in metadata)", async () => {
		const h = new BailianHandler({
			bailianApiKey: "test-key",
			enableReasoningEffort: true,
			apiModelId: "MiniMax-M2.5",
		})

		mockCreate.mockImplementationOnce(() => ({
			[Symbol.asyncIterator]: () => ({ next: vitest.fn().mockResolvedValue({ done: true }) }),
		}))

		const generator = h.createMessage("system prompt", [])
		await generator.next()

		const callArgs = mockCreate.mock.calls[0][0]
		expect(callArgs).not.toHaveProperty("enable_thinking")
	})

	it("should include reasoning_effort for DeepSeek V4 models (effort metadata)", async () => {
		const h = new BailianHandler({
			bailianApiKey: "test-key",
			reasoningEffort: "high",
			apiModelId: "deepseek-v4-pro",
		})

		mockCreate.mockImplementationOnce(() => ({
			[Symbol.asyncIterator]: () => ({ next: vitest.fn().mockResolvedValue({ done: true }) }),
		}))

		const generator = h.createMessage("system prompt", [])
		await generator.next()

		expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ reasoning_effort: "high" }), undefined)
	})

	it("should map xhigh reasoning_effort to max for DeepSeek V4", async () => {
		const h = new BailianHandler({
			bailianApiKey: "test-key",
			reasoningEffort: "xhigh",
			apiModelId: "deepseek-v4-flash",
		})

		mockCreate.mockImplementationOnce(() => ({
			[Symbol.asyncIterator]: () => ({ next: vitest.fn().mockResolvedValue({ done: true }) }),
		}))

		const generator = h.createMessage("system prompt", [])
		await generator.next()

		expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ reasoning_effort: "max" }), undefined)
	})

	// --- Prompt caching ---

	it("should inject cache_control in system message when supportsPromptCache is true", async () => {
		const h = new BailianHandler({
			bailianApiKey: "test-key",
			apiModelId: "qwen3.6-plus", // supportsPromptCache: true
		})

		mockCreate.mockImplementationOnce(() => ({
			[Symbol.asyncIterator]: () => ({ next: vitest.fn().mockResolvedValue({ done: true }) }),
		}))

		const generator = h.createMessage("system prompt", [])
		await generator.next()

		const callArgs = mockCreate.mock.calls[0][0]
		const systemMsg = callArgs.messages[0]
		expect(systemMsg.content).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "text",
					cache_control: { type: "ephemeral" },
				}),
			]),
		)
	})

	it("should inject cache_control in last user message", async () => {
		const h = new BailianHandler({ bailianApiKey: "test-key", apiModelId: "qwen3.6-plus" })

		mockCreate.mockImplementationOnce(() => ({
			[Symbol.asyncIterator]: () => ({ next: vitest.fn().mockResolvedValue({ done: true }) }),
		}))

		const userMsg: Anthropic.Messages.MessageParam = {
			role: "user",
			content: "Hello, do something",
		}
		const generator = h.createMessage("sys", [userMsg])
		await generator.next()

		const callArgs = mockCreate.mock.calls[0][0]
		const lastUserMsg = [...callArgs.messages].reverse().find((m: any) => m.role === "user")
		const lastTextPart = Array.isArray(lastUserMsg.content)
			? lastUserMsg.content.filter((p: any) => p.type === "text").pop()
			: undefined
		expect(lastTextPart).toHaveProperty("cache_control", { type: "ephemeral" })
	})

	it("should NOT inject cache_control when supportsPromptCache is false", async () => {
		// MiniMax-M2.5 has supportsPromptCache: false
		const h = new BailianHandler({ bailianApiKey: "test-key", apiModelId: "MiniMax-M2.5" })

		mockCreate.mockImplementationOnce(() => ({
			[Symbol.asyncIterator]: () => ({ next: vitest.fn().mockResolvedValue({ done: true }) }),
		}))

		const generator = h.createMessage("sys", [])
		await generator.next()

		const callArgs = mockCreate.mock.calls[0][0]
		const systemContent = callArgs.messages[0].content
		expect(typeof systemContent).toBe("string")
	})

	// --- supportsTemperature ---

	it("should omit temperature when no default and user has not set one", async () => {
		const h = new BailianHandler({ bailianApiKey: "test-key", apiModelId: "qwen3.6-plus" })

		mockCreate.mockImplementationOnce(() => ({
			[Symbol.asyncIterator]: () => ({ next: vitest.fn().mockResolvedValue({ done: true }) }),
		}))

		const generator = h.createMessage("sys", [])
		await generator.next()

		expect(mockCreate).toHaveBeenCalledWith(expect.not.objectContaining({ temperature: expect.any(Number) }), undefined)
	})

	it("should include temperature when user sets modelTemperature", async () => {
		const h = new BailianHandler({ bailianApiKey: "test-key", apiModelId: "qwen3.6-plus", modelTemperature: 0.3 })

		mockCreate.mockImplementationOnce(() => ({
			[Symbol.asyncIterator]: () => ({ next: vitest.fn().mockResolvedValue({ done: true }) }),
		}))

		const generator = h.createMessage("sys", [])
		await generator.next()

		expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0.3 }), undefined)
	})

	// --- includeMaxTokens ---

	it("should use max_completion_tokens when includeMaxTokens is true (not max_tokens)", async () => {
		const h = new BailianHandler({
			bailianApiKey: "test-key",
			includeMaxTokens: true,
			modelMaxTokens: 16000,
		})

		mockCreate.mockImplementationOnce(() => ({
			[Symbol.asyncIterator]: () => ({ next: vitest.fn().mockResolvedValue({ done: true }) }),
		}))

		const generator = h.createMessage("sys", [])
		await generator.next()

		const callArgs = mockCreate.mock.calls[0][0]
		expect(callArgs).toHaveProperty("max_completion_tokens", 16000)
		// Must NOT have max_tokens when includeMaxTokens is true
		expect(callArgs).not.toHaveProperty("max_tokens")
	})

	// --- completePrompt ---

	it("completePrompt should use enable_thinking for binary reasoning models", async () => {
		const h = new BailianHandler({
			bailianApiKey: "test-key",
			enableReasoningEffort: true,
			apiModelId: "qwen3.6-plus",
		})

		mockCreate.mockResolvedValueOnce({
			choices: [{ message: { content: "Hello" } }],
		})

		await h.completePrompt("test prompt")

		expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ enable_thinking: true }))
	})

	it("completePrompt should NOT send thinking param for MiniMax-M2.5", async () => {
		const h = new BailianHandler({
			bailianApiKey: "test-key",
			enableReasoningEffort: true,
			apiModelId: "MiniMax-M2.5",
		})

		mockCreate.mockResolvedValueOnce({
			choices: [{ message: { content: "Hello" } }],
		})

		await h.completePrompt("test prompt")

		const callArgs = mockCreate.mock.calls[0][0]
		expect(callArgs).not.toHaveProperty("thinking")
		expect(callArgs).not.toHaveProperty("enable_thinking")
	})

	it("completePrompt throws when response content is null", async () => {
		const h = new BailianHandler({
			bailianApiKey: "test-key",
			apiModelId: "qwen3.6-plus",
		})

		mockCreate.mockResolvedValueOnce({
			choices: [{ message: { content: null } }],
		})

		await expect(h.completePrompt("test")).rejects.toThrow("empty response content")
	})

	it("completePrompt throws when response content is undefined", async () => {
		const h = new BailianHandler({
			bailianApiKey: "test-key",
			apiModelId: "qwen3.6-plus",
		})

		mockCreate.mockResolvedValueOnce({
			choices: [{ message: {} }],
		})

		await expect(h.completePrompt("test")).rejects.toThrow("empty response content")
	})

	describe("getModelsFromCache integration", () => {
		it("uses cached model info when found (cache tier hit)", () => {
			vi.mocked(getModelsFromCache).mockReturnValue({
				"new-model": {
					maxTokens: 999,
					contextWindow: 5000,
					supportsImages: true,
					supportsPromptCache: false,
				},
			})

			const h = new BailianHandler({
				bailianApiKey: "test-key",
				bailianRegion: "beijing",
				apiModelId: "new-model",
			})
			const result = h.getModel()
			expect(result.id).toBe("new-model")
			expect(result.info.maxTokens).toBe(999)
			expect(result.info.contextWindow).toBe(5000)
			expect(result.info.supportsImages).toBe(true)
		})

		it("static preset overrides cache for same model ID", () => {
			vi.mocked(getModelsFromCache).mockReturnValue({
				"qwen3.6-plus": {
					maxTokens: 1,
					contextWindow: 999,
					supportsImages: false,
					supportsPromptCache: false,
				},
			})

			const h = new BailianHandler({
				bailianApiKey: "test-key",
				bailianRegion: "beijing",
				apiModelId: "qwen3.6-plus",
			})
			const result = h.getModel()
			expect(result.info.maxTokens).toBe(65536)
			expect(result.info.supportsImages).toBe(true)
		})

		it("falls back to custom model info when cache is empty", () => {
			vi.mocked(getModelsFromCache).mockReturnValue({})

			const customInfo = {
				maxTokens: 500,
				contextWindow: 10000,
				supportsImages: false,
				supportsPromptCache: true,
			}

			const h = new BailianHandler({
				bailianApiKey: "test-key",
				bailianRegion: "beijing",
				apiModelId: "unknown-model",
				bailianCustomModelInfo: customInfo,
			})
			const result = h.getModel()
			expect(result.id).toBe("unknown-model")
			expect(result.info.maxTokens).toBe(500)
			expect(result.info.contextWindow).toBe(10000)
		})

		it("trims whitespace from model ID and recognizes known model", () => {
			const h = new BailianHandler({
				bailianApiKey: "test-key",
				bailianRegion: "beijing",
				apiModelId: "  qwen3.6-plus  ",
			})
			const result = h.getModel()
			expect(result.id).toBe("qwen3.6-plus")
			expect(result.info.maxTokens).toBe(65536)
		})

		it("versioned variant gets canonical pricing via findMatchingPreset", () => {
			const h = new BailianHandler({
				bailianApiKey: "test-key",
				bailianRegion: "singapore",
				apiModelId: "qwen3.7-max-2026-05-17",
			})
			const result = h.getModel()
			expect(result.info.maxTokens).toBe(65536)
			expect(result.info.inputPrice).toBeDefined()
			expect(result.info.outputPrice).toBeDefined()
		})

		it("versioned variant gets canonical metadata (not default) on cold start", () => {
			// Simulate cold start: no cache (getModelsFromCache returns undefined by default in beforeEach)
			const h = new BailianHandler({
				bailianApiKey: "test-key",
				bailianRegion: "beijing",
				apiModelId: "qwen3.7-max-2026-05-17",
			})
			const result = h.getModel()
			// Versioned ID "qwen3.7-max-2026-05-17" matches preset "qwen3.7-max" via substring
			expect(result.info.maxTokens).toBe(65536) // from qwen3.7-max preset
			expect(result.info.contextWindow).toBe(1_000_000) // qwen3.7-max preset value
			expect(result.info.supportsImages).toBe(false) // qwen3.7-max preset value
			expect(result.info.supportsReasoningBinary).toBe(true) // qwen3.7-max preset value
		})

		it("custom model info overrides known model defaults", () => {
			const h = new BailianHandler({
				bailianApiKey: "test-key",
				bailianRegion: "beijing",
				apiModelId: "qwen3.6-plus",
				bailianCustomModelInfo: { maxTokens: 500, contextWindow: 10000 } as any,
			})
			const result = h.getModel()
			expect(result.info.maxTokens).toBe(500)
			expect(result.info.contextWindow).toBe(10000)
		})

		it("image-only message does not inject sentinel text", async () => {
			const h = new BailianHandler({
				bailianApiKey: "test-key",
				apiModelId: "qwen3.6-plus",
			})

			mockCreate.mockImplementationOnce(() => ({
				[Symbol.asyncIterator]: () => ({ next: vitest.fn().mockResolvedValue({ done: true }) }),
			}))

			const imageMsg: Anthropic.Messages.MessageParam = {
				role: "user",
				content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "aaa" } }],
			}
			const generator = h.createMessage("sys", [imageMsg])
			await generator.next()

			const callArgs = mockCreate.mock.calls[0][0]
			const lastUserMsg = [...callArgs.messages].reverse().find((m: any) => m.role === "user")
			const texts = Array.isArray(lastUserMsg.content)
				? lastUserMsg.content.filter((p: any) => p.type === "text").map((p: any) => p.text)
				: []
			expect(texts).not.toContain("...")
		})

	it("sends enable_thinking:false when DeepSeek V4 thinking is disabled", async () => {
		const h = new BailianHandler({
			bailianApiKey: "test-key",
			enableReasoningEffort: false,
			apiModelId: "deepseek-v4-pro",
		})

		mockCreate.mockImplementationOnce(() => ({
			[Symbol.asyncIterator]: () => ({ next: vitest.fn().mockResolvedValue({ done: true }) }),
		}))

		const generator = h.createMessage("system prompt", [])
		await generator.next()

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({ enable_thinking: false }),
			undefined,
		)
	})
	})
})
