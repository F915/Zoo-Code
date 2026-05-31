// npx vitest run src/api/providers/__tests__/bailian.spec.ts

import OpenAI from "openai"
import { Anthropic } from "@anthropic-ai/sdk"

import { type BailianModelId, bailianDefaultModelId, bailianModels } from "@roo-code/types"

import { BailianHandler } from "../bailian"

vitest.mock("openai", () => {
	const createMock = vitest.fn()
	return {
		default: vitest.fn(() => ({ chat: { completions: { create: createMock } } })),
	}
})

describe("BailianHandler", () => {
	let handler: BailianHandler
	let mockCreate: any

	beforeEach(() => {
		vitest.clearAllMocks()
		mockCreate = (OpenAI as unknown as any)().chat.completions.create
		handler = new BailianHandler({ bailianApiKey: "test-key", bailianRegion: "beijing" })
	})

	// --- Model ID handling (Mode B: ID passthrough) ---

	it("passes through user-provided model ID (mode B)", () => {
		const h = new BailianHandler({ bailianApiKey: "test-key", apiModelId: "custom-model" })
		expect(h.getModel().id).toBe("custom-model")
	})

	it("returns default model ID when none provided", () => {
		expect(handler.getModel().id).toBe(bailianDefaultModelId)
	})

	it("uses default model info for unknown model ID", () => {
		const h = new BailianHandler({ bailianApiKey: "test-key", apiModelId: "unknown" })
		const result = h.getModel()
		expect(result.id).toBe("unknown")
		expect(result.info).toMatchObject(bailianModels[bailianDefaultModelId])
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

	// --- Bailian-specific parameters ---

	it("should include enable_thinking as top-level param when thinking is enabled", async () => {
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

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({ enable_thinking: true }),
			undefined,
		)
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

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({ thinking_budget: 4096 }),
			undefined,
		)
	})

	it("should NOT include enable_thinking for MiniMax-M2.5 (thinking-only model)", async () => {
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

	it("should include reasoning_effort for DeepSeek V4 models", async () => {
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

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({ reasoning_effort: "high" }),
			undefined,
		)
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

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({ reasoning_effort: "max" }),
			undefined,
		)
	})

})
		it("should throw when Frankfurt region is used without workspaceId", () => {
			expect(
				() => new BailianHandler({ bailianApiKey: "test-key", bailianRegion: "frankfurt" }),
			).toThrow()
		})

		it("should throw when Hong Kong region is used without workspaceId", () => {
			expect(
				() => new BailianHandler({ bailianApiKey: "test-key", bailianRegion: "hongkong" }),
			).toThrow()
		})


