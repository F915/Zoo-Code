import * as assert from "assert"

import { RooCodeEventName, type ClineMessage, type RooCodeAPI, type RooCodeSettings } from "@roo-code/types"

import { setDefaultSuiteTimeout } from "../test-utils"
import { waitFor } from "../utils"

const BAILIAN_API_KEY = process.env.BAILIAN_API_KEY

// ---------------------------------------------------------------------------
// Fetch interceptor
//
// The OpenAI SDK resolves `fetch` at client construction time
// (this.fetch = options.fetch ?? getDefaultFetch()).  Patching globalThis.fetch
// before setConfiguration() ensures any BailianHandler created for this suite
// captures our interceptor.
//
// We intercept both /chat/completions (returning a mock SSE response) and
// /models (returning an empty model list) so that background model refresh
// never hits the real API.  Without /models interception, model refresh
// makes real HTTP requests that can slow down or interfere with tests.
// ---------------------------------------------------------------------------

type BailianRequestCapture = {
	url?: string
	model?: string
	enable_thinking?: boolean
	thinking_budget?: number
	reasoning_effort?: string
	probeTag?: string
}

function installBailianFetchInterceptor(capture: BailianRequestCapture[], passthrough?: boolean): () => void {
	const original = globalThis.fetch

	globalThis.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url

		let isBailianUrl = false
		try {
			const hostname = new URL(url).hostname
			// Safe: new URL(url).hostname extracts only the hostname
			// component, so === and .endsWith below are not substring
			// checks against the full URL.
			isBailianUrl = hostname === "dashscope.aliyuncs.com" || hostname.endsWith(".maas.aliyuncs.com")
		} catch {
			// leave isBailianUrl = false
		}

		if (isBailianUrl) {
			// Intercept /models endpoint — return empty model list so background
			// model refresh never hits the real API.
			if (url.includes("/models")) {
				return new Response(JSON.stringify({ data: [] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				})
			}

			if (url.includes("/chat/completions")) {
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

				// In mock mode, return a simple SSE response with a completion.
				// We use a tool call (attempt_completion) instead of plain text
				// to avoid a race condition: plain-text tasks complete so fast
				// that TaskCompleted can fire before waitUntilCompleted registers
				// its handler.  A tool call forces a second turn, giving the
				// event listener enough time to be installed.
				const enc = new TextEncoder()
				const body2 = new ReadableStream({
					start(controller) {
						// Chunk 1: tool call start — attempt_completion
						controller.enqueue(
							enc.encode(
								`data: ${JSON.stringify({
									id: "chatcmpl-mock",
									object: "chat.completion.chunk",
									created: Math.floor(Date.now() / 1000),
									model: body.model || "qwen3.6-plus",
									choices: [
										{
											index: 0,
											delta: {
												role: "assistant",
												tool_calls: [
													{
														index: 0,
														id: "call_bailian_mock_001",
														type: "function",
														function: {
															name: "attempt_completion",
															arguments: "",
														},
													},
												],
											},
											finish_reason: null,
										},
									],
								})}\n\n`,
							),
						)
						// Chunk 2: tool call arguments
						controller.enqueue(
							enc.encode(
								`data: ${JSON.stringify({
									id: "chatcmpl-mock",
									object: "chat.completion.chunk",
									created: Math.floor(Date.now() / 1000),
									model: body.model || "qwen3.6-plus",
									choices: [
										{
											index: 0,
											delta: {
												tool_calls: [
													{
														index: 0,
														function: {
															arguments: JSON.stringify({
																result: "bailian-e2e:mock-ok",
															}),
														},
													},
												],
											},
											finish_reason: null,
										},
									],
								})}\n\n`,
							),
						)
						// Chunk 3: finish with usage
						controller.enqueue(
							enc.encode(
								`data: ${JSON.stringify({
									id: "chatcmpl-mock",
									object: "chat.completion.chunk",
									created: Math.floor(Date.now() / 1000),
									model: body.model || "qwen3.6-plus",
									choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
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
	let restoreFetch: (() => void) | undefined
	const requests: BailianRequestCapture[] = []

	suiteSetup(async function () {
		api = globalThis.api
		if (!api) {
			throw new Error("E2E API not found — ensure the test runner initializes globalThis.api")
		}
		originalConfig = api.getConfiguration()

		// Install the fetch interceptor once for the entire suite so that
		// background model refreshes (triggered by setConfiguration) are
		// also intercepted — matching the pattern used by Z.ai and xAI.
		restoreFetch = installBailianFetchInterceptor(requests)
	})

	suiteTeardown(async function () {
		restoreFetch?.()
		restoreFetch = undefined

		if (originalConfig) {
			await api.setConfiguration(originalConfig)
		}
	})

	setup(function () {
		// Clear captured requests between tests so each test's assertions
		// only see requests from that test.
		requests.length = 0
	})

	// -----------------------------------------------------------------------
	// Beijing region — basic streaming smoke test
	// -----------------------------------------------------------------------

	test("completes a task on Beijing region with Qwen model", async function () {
		const messages: ClineMessage[] = []
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			if (message.type === "say" && message.partial === false) {
				messages.push(message)
			}
		}
		api.on(RooCodeEventName.Message, messageHandler)

		// Register TaskCompleted handler BEFORE startNewTask to avoid a race
		// condition where the task completes before waitUntilCompleted installs
		// its listener.
		const completed = new Set<string>()
		const completedHandler = (id: string) => completed.add(id)
		api.on(RooCodeEventName.TaskCompleted, completedHandler)

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
			await waitFor(() => completed.has(taskId))

			const completion = messages.find((m) => m.type === "say" && m.say === "completion_result")
			assert.ok(completion, "Task should complete successfully")
			assert.ok(
				completion.text?.includes("bailian-e2e:mock-ok") || completion.text?.includes("mock-ok"),
				`Completion should contain mock response, got: ${completion.text?.slice(0, 200)}`,
			)
		} finally {
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, completedHandler)
		}
	})

	// -----------------------------------------------------------------------
	// DeepSeek V4 reasoning_effort parameter
	// -----------------------------------------------------------------------

	test("sends reasoning_effort for DeepSeek V4 model", async function () {
		const messages: ClineMessage[] = []
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			if (message.type === "say" && message.partial === false) {
				messages.push(message)
			}
		}
		api.on(RooCodeEventName.Message, messageHandler)

		const completed = new Set<string>()
		const completedHandler = (id: string) => completed.add(id)
		api.on(RooCodeEventName.TaskCompleted, completedHandler)

		try {
			await api.setConfiguration({
				apiProvider: "bailian",
				bailianApiKey: BAILIAN_API_KEY ?? "mock-key",
				bailianRegion: "beijing",
				apiModelId: "deepseek-v4-pro",
				enableReasoningEffort: true,
				reasoningEffort: "high",
			})

			const taskId = await api.startNewTask({
				configuration: { mode: "ask", autoApprovalEnabled: true },
				text: "bailian-e2e:deepseek-reasoning: echo 'hello'",
			})
			await waitFor(() => completed.has(taskId))

			const reasoningRequest = requests.find((r) => r.reasoning_effort === "high")
			assert.ok(reasoningRequest, "Should send reasoning_effort: high for DeepSeek V4 model")
		} finally {
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, completedHandler)
		}
	})

	// -----------------------------------------------------------------------
	// Binary reasoning enable_thinking parameter (Qwen)
	// -----------------------------------------------------------------------

	test("sends enable_thinking for binary reasoning model (Qwen)", async function () {
		const messages: ClineMessage[] = []
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			if (message.type === "say" && message.partial === false) {
				messages.push(message)
			}
		}
		api.on(RooCodeEventName.Message, messageHandler)

		const completed = new Set<string>()
		const completedHandler = (id: string) => completed.add(id)
		api.on(RooCodeEventName.TaskCompleted, completedHandler)

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
			await waitFor(() => completed.has(taskId))

			const thinkingRequest = requests.find((r) => r.enable_thinking === true)
			assert.ok(thinkingRequest, "Should send enable_thinking: true for Qwen binary reasoning model")
		} finally {
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, completedHandler)
		}
	})

	// -----------------------------------------------------------------------
	// Binary reasoning disabled — enable_thinking: false
	// -----------------------------------------------------------------------

	test("sends enable_thinking: false for binary reasoning model when disabled", async function () {
		const messages: ClineMessage[] = []
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			if (message.type === "say" && message.partial === false) {
				messages.push(message)
			}
		}
		api.on(RooCodeEventName.Message, messageHandler)

		const completed = new Set<string>()
		const completedHandler = (id: string) => completed.add(id)
		api.on(RooCodeEventName.TaskCompleted, completedHandler)

		try {
			await api.setConfiguration({
				apiProvider: "bailian",
				bailianApiKey: BAILIAN_API_KEY ?? "mock-key",
				bailianRegion: "beijing",
				apiModelId: "qwen3.7-max",
				enableReasoningEffort: false,
			})

			const taskId = await api.startNewTask({
				configuration: { mode: "ask", autoApprovalEnabled: true },
				text: "bailian-e2e:qwen-no-thinking: echo 'hello'",
			})
			await waitFor(() => completed.has(taskId))

			const disabledRequest = requests.find((r) => r.enable_thinking === false)
			assert.ok(
				disabledRequest,
				"Should send enable_thinking: false when reasoning is explicitly disabled for binary reasoning model",
			)
		} finally {
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, completedHandler)
		}
	})

	// -----------------------------------------------------------------------
	// Workspace ID for Frankfurt region
	// -----------------------------------------------------------------------

	test("uses Frankfurt workspaceId-based URL", async function () {
		const messages: ClineMessage[] = []
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			if (message.type === "say" && message.partial === false) {
				messages.push(message)
			}
		}
		api.on(RooCodeEventName.Message, messageHandler)

		const completed = new Set<string>()
		const completedHandler = (id: string) => completed.add(id)
		api.on(RooCodeEventName.TaskCompleted, completedHandler)

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
			await waitFor(() => completed.has(taskId))

			assert.ok(
				messages.some((m) => m.type === "say" && m.say === "completion_result"),
				"Task should complete with Frankfurt endpoint",
			)
			const frankfurtRequest = requests.find((r) => {
				try {
					return new URL(r.url!).hostname === "ws-test-123.eu-central-1.maas.aliyuncs.com"
				} catch {
					return false
				}
			})
			assert.ok(frankfurtRequest, "Should use workspaceId-prefixed URL for Frankfurt region")
		} finally {
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, completedHandler)
		}
	})
})
