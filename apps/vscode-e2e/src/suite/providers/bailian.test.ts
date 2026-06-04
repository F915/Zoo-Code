import * as assert from "assert"

import { RooCodeEventName, type ClineMessage, type RooCodeAPI, type RooCodeSettings } from "@roo-code/types"

import { setDefaultSuiteTimeout } from "../test-utils"
import { waitUntilCompleted } from "../utils"

const BAILIAN_API_KEY = process.env.BAILIAN_API_KEY

// ---------------------------------------------------------------------------
// Fetch interceptor
// ---------------------------------------------------------------------------

type BailianRequestCapture = {
	url?: string
	model?: string
	enable_thinking?: boolean
	thinking_budget?: number
	reasoning_effort?: string
	probeTag?: string
}

/**
 * @param {BailianRequestCapture[]} capture
 * @param {boolean} [passthrough]
 * @returns {() => void} restore function
 */
function installBailianFetchInterceptor(capture: BailianRequestCapture[], passthrough?: boolean): () => void {
	const original = globalThis.fetch

	globalThis.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url

		let isBailianUrl = false
		try {
			const hostname = new URL(url).hostname
			isBailianUrl = hostname === "dashscope.aliyuncs.com" || hostname.endsWith(".maas.aliyuncs.com")
		} catch {
			// leave isBailianUrl = false
		}

		if (isBailianUrl && url.includes("/chat/completions")) {
			const body = init?.body ? JSON.parse(init.body as string) : {}
			const messages = body.messages ?? []
			const allMessagesText = JSON.stringify(messages)
			const probeTag = allMessagesText.match(/bailian-e2e:[^"\s]+/)?.[0]

			capture.push({
				url,
				model: body.model,
				enable_thinking: body.enable_thinking,
				thinking_budget: body.thinking_budget,
				reasoning_effort: body.reasoning_effort,
				probeTag,
			})

			if (passthrough) {
				return original.call(globalThis, input, init)
			}

			// In mock mode, return a simple SSE response with a completion
			const enc = new TextEncoder()
			const body2 = new ReadableStream({
				start(controller) {
					controller.enqueue(
						enc.encode(
							`data: ${JSON.stringify({
								id: "chatcmpl-mock",
								object: "chat.completion.chunk",
								created: Math.floor(Date.now() / 1000),
								model: body.model || "qwen3.6-plus",
								choices: [{ index: 0, delta: { content: "bailian-e2e:" }, finish_reason: null }],
							})}\n\n`,
						),
					)
					controller.enqueue(
						enc.encode(
							`data: ${JSON.stringify({
								id: "chatcmpl-mock",
								object: "chat.completion.chunk",
								created: Math.floor(Date.now() / 1000),
								model: body.model || "qwen3.6-plus",
								choices: [{ index: 0, delta: { content: "mock-ok" }, finish_reason: null }],
							})}\n\n`,
						),
					)
					controller.enqueue(
						enc.encode(
							`data: ${JSON.stringify({
								id: "chatcmpl-mock",
								object: "chat.completion.chunk",
								created: Math.floor(Date.now() / 1000),
								model: body.model || "qwen3.6-plus",
								choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
								usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
							})}\n\n`,
						),
					)
					controller.enqueue(enc.encode("data: [DONE]\n\n"))
					controller.close()
				},
			})
			return new Response(body2, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			})
		}

		return original.call(globalThis, input, init)
	} as typeof globalThis.fetch

	return () => {
		globalThis.fetch = original
	}
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite("Bailian Provider", function () {
	setDefaultSuiteTimeout(this)

	let api: RooCodeAPI

	let originalConfig: RooCodeSettings

	suiteSetup(async function () {
		api = globalThis.api
		if (!api) {
			throw new Error("E2E API not found — ensure the test runner initializes globalThis.api")
		}
		originalConfig = api.getConfiguration()
	})

	suiteTeardown(async function () {
		if (originalConfig) {
			await api.setConfiguration(originalConfig)
		}
	})

	// -----------------------------------------------------------------------
	// Beijing region — basic streaming smoke test
	// -----------------------------------------------------------------------

	test("completes a task on Beijing region with Qwen model", async function () {
		const requests: BailianRequestCapture[] = []
		const restore = installBailianFetchInterceptor(requests)

		const messages: ClineMessage[] = []
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			if (message.type === "say" && message.partial === false) {
				messages.push(message)
			}
		}
		api.on(RooCodeEventName.Message, messageHandler)

		try {
			await api.setConfiguration({
				apiProvider: "bailian",
				bailianApiKey: BAILIAN_API_KEY ?? "mock-key",
				bailianRegion: "beijing",
				apiModelId: "qwen3.6-plus",
				enableReasoningEffort: false,
			})

			const taskId = await api.startNewTask({
				configuration: { mode: "ask", autoApprovalEnabled: true },
				text: "bailian-e2e:beijing-basic: echo 'hello'",
			})
			await waitUntilCompleted({ api, taskId })

			const completion = messages.find((m) => m.type === "say" && m.say === "completion_result")
			assert.ok(completion, "Task should complete successfully")
			assert.ok(
				completion.text?.includes("bailian-e2e:mock-ok") || completion.text?.includes("mock-ok"),
				`Completion should contain mock response, got: ${completion.text?.slice(0, 200)}`,
			)
		} finally {
			api.off(RooCodeEventName.Message, messageHandler)
			restore()
		}
	})

	// -----------------------------------------------------------------------
	// DeepSeek V4 reasoning_effort parameter
	// -----------------------------------------------------------------------

	test("sends reasoning_effort for DeepSeek V4 model", async function () {
		const requests: BailianRequestCapture[] = []
		const restore = installBailianFetchInterceptor(requests)

		const messages: ClineMessage[] = []
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			if (message.type === "say" && message.partial === false) {
				messages.push(message)
			}
		}
		api.on(RooCodeEventName.Message, messageHandler)

		try {
			await api.setConfiguration({
				apiProvider: "bailian",
				bailianApiKey: BAILIAN_API_KEY ?? "mock-key",
				bailianRegion: "beijing",
				apiModelId: "deepseek-v4-pro",
				reasoningEffort: "high",
			})

			const taskId = await api.startNewTask({
				configuration: { mode: "ask", autoApprovalEnabled: true },
				text: "bailian-e2e:deepseek-reasoning: echo 'hello'",
			})
			await waitUntilCompleted({ api, taskId })

			const reasoningRequest = requests.find((r) => r.reasoning_effort === "high")
			assert.ok(reasoningRequest, "Should send reasoning_effort: high for DeepSeek V4 model")
		} finally {
			api.off(RooCodeEventName.Message, messageHandler)
			restore()
		}
	})

	// -----------------------------------------------------------------------
	// Binary reasoning enable_thinking parameter (Qwen)
	// -----------------------------------------------------------------------

	test("sends enable_thinking for binary reasoning model (Qwen)", async function () {
		const requests: BailianRequestCapture[] = []
		const restore = installBailianFetchInterceptor(requests)

		const messages: ClineMessage[] = []
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			if (message.type === "say" && message.partial === false) {
				messages.push(message)
			}
		}
		api.on(RooCodeEventName.Message, messageHandler)

		try {
			await api.setConfiguration({
				apiProvider: "bailian",
				bailianApiKey: BAILIAN_API_KEY ?? "mock-key",
				bailianRegion: "beijing",
				apiModelId: "qwen3.7-max",
				enableReasoningEffort: true,
			})

			const taskId = await api.startNewTask({
				configuration: { mode: "ask", autoApprovalEnabled: true },
				text: "bailian-e2e:qwen-thinking: echo 'hello'",
			})
			await waitUntilCompleted({ api, taskId })

			const thinkingRequest = requests.find((r) => r.enable_thinking === true)
			assert.ok(thinkingRequest, "Should send enable_thinking: true for Qwen binary reasoning model")
		} finally {
			api.off(RooCodeEventName.Message, messageHandler)
			restore()
		}
	})

	// -----------------------------------------------------------------------
	// Workspace ID for Frankfurt region
	// -----------------------------------------------------------------------

	test("uses Frankfurt workspaceId-based URL", async function () {
		const requests: BailianRequestCapture[] = []
		const restore = installBailianFetchInterceptor(requests)

		const messages: ClineMessage[] = []
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			if (message.type === "say" && message.partial === false) {
				messages.push(message)
			}
		}
		api.on(RooCodeEventName.Message, messageHandler)

		try {
			await api.setConfiguration({
				apiProvider: "bailian",
				bailianApiKey: BAILIAN_API_KEY ?? "mock-key",
				bailianRegion: "frankfurt",
				bailianWorkspaceId: "ws-test-123",
				apiModelId: "qwen3.6-flash",
				enableReasoningEffort: false,
			})

			const taskId = await api.startNewTask({
				configuration: { mode: "ask", autoApprovalEnabled: true },
				text: "bailian-e2e:frankfurt: echo 'hello'",
			})
			await waitUntilCompleted({ api, taskId })

			assert.ok(
				messages.some((m) => m.type === "say" && m.say === "completion_result"),
				"Task should complete with Frankfurt endpoint",
			)
			const frankfurtRequest = requests.find((r) => r.url?.includes("ws-test-123.eu-central-1.maas.aliyuncs.com"))
			assert.ok(frankfurtRequest, "Should use workspaceId-prefixed URL for Frankfurt region")
		} finally {
			api.off(RooCodeEventName.Message, messageHandler)
			restore()
		}
	})
})
