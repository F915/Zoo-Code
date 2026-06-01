import { getBailianPrice, type BailianRegion } from "@roo-code/types"
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	type BailianModelId,
	bailianDefaultModelId,
	bailianModels,
	BAILIAN_DEFAULT_TEMPERATURE,
	type ModelInfo,
} from "@roo-code/types"

import { type ApiHandlerOptions } from "../../shared/api"
import type { ApiHandlerCreateMessageMetadata } from "../index"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { getModelParams } from "../transform/model-params"
import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"
import { handleOpenAIError } from "./utils/openai-error-handler"
import { getModelsFromCache } from "./fetchers/modelCache"
import { getBailianBaseUrl } from "./bailian-region"
import { findMatchingPreset } from "./fetchers/bailian"

// cache_control is an OpenAI API extension (prompt caching) not yet present in
// the openai SDK types. Use this local interface so call sites are explicit
// about the extension rather than scattering inline @ts-ignore directives.
interface CacheControlTextPart {
	type: "text"
	text: string
	cache_control?: { type: "ephemeral" }
}

/**
 * Handler for the Bailian (Alibaba Cloud DashScope) AI provider.
 *
 * Extends {@linkcode BaseOpenAiCompatibleProvider} with Bailian-specific
 * reasoning parameters (enable_thinking, reasoning_effort), prompt caching
 * via cache_control injection, and region-aware pricing.
 *
 * Supports 8 static preset models and dynamic model fetching from the
 * DashScope /models endpoint for the full 200+ model catalog.
 */
export class BailianHandler extends BaseOpenAiCompatibleProvider<BailianModelId> {
	private readonly bailianOptions: ApiHandlerOptions

	/**
	 * Constructs a new Bailian handler.
	 *
	 * The base URL is derived from {@linkcode getBailianBaseUrl} based on
	 * the configured region and optional workspace ID.
	 *
	 * @param options - Bailian-specific provider settings including
	 *                  bailianApiKey, bailianRegion, and optionally
	 *                  bailianWorkspaceId for Frankfurt/Hong Kong regions.
	 */
	constructor(options: ApiHandlerOptions) {
		const baseURL = getBailianBaseUrl(options.bailianRegion, options.bailianWorkspaceId)

		super({
			...options,
			providerName: "Bailian",
			baseURL,
			apiKey: options.bailianApiKey,
			defaultProviderModelId: bailianDefaultModelId,
			providerModels: bailianModels as Record<BailianModelId, ModelInfo>,
			defaultTemperature: BAILIAN_DEFAULT_TEMPERATURE,
		})
		this.bailianOptions = options
	}

	/**
	 * Resolves the model ID and its complete metadata.
	 *
	 * Three-tier lookup:
	 * 1. Static presets (`bailianModels`) — authoritative specs with pricing
	 * 2. API-fetched cache — model list from DashScope /models endpoint
	 * 3. Custom model fallback — user-provided {@linkcode bailianCustomModelInfo}
	 *
	 * The model ID is trimmed of whitespace before lookup. Pricing is
	 * canonicalized via {@linkcode findMatchingPreset} to handle
	 * versioned/named-space API variants.
	 *
	 * @returns An object with `id`, `info` ({@linkcode ModelInfo}), and
	 *          computed parameters (maxTokens, temperature, etc.).
	 */
	override getModel() {
		const userModelId = this.bailianOptions.apiModelId
		const trimmed = userModelId?.trim()
		const id = (trimmed ? trimmed : this.defaultProviderModelId) as BailianModelId

		// Tier 1: static presets (always available)
		const staticInfo = this.providerModels[id]

		// Tier 2: API-fetched cache (populated when bailianApiKey is configured)
		const cachedModels = getModelsFromCache("bailian")
		const cachedInfo = cachedModels?.[id]

		// Tier 3: custom model fallback (uses default model as base + custom overrides)
		const region = (this.bailianOptions.bailianRegion ?? "beijing") as BailianRegion
		const canonicalKey = findMatchingPreset(id) ?? id
		const price = getBailianPrice(canonicalKey, region)
		const custom = this.bailianOptions.bailianCustomModelInfo as ModelInfo | undefined | null

		const baseInfo = staticInfo ?? cachedInfo ?? this.providerModels[this.defaultProviderModelId]

		const info: ModelInfo = { ...baseInfo, ...price, ...(custom || {}) }

		// Centralized parameter computation (maxTokens, temperature, reasoningEffort, etc.)
		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: BAILIAN_DEFAULT_TEMPERATURE,
		})

		return { id, info, ...params }
	}

	/**
	 * Override createStream to inject Bailian-specific parameters:
	 * - enable_thinking / thinking_budget for binary reasoning models (Qwen, GLM, Kimi)
	 * - reasoning_effort for effort-based reasoning models (DeepSeek V4)
	 * - cache_control injection for prompt caching
	 */
	protected override createStream(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
		requestOptions?: OpenAI.RequestOptions,
	) {
		const { id: modelId, info: modelInfo, maxTokens, temperature } = this.getModel()

		// Convert to OpenAI format once (needed for both cache injection and params)
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// Prompt caching: inject cache_control on system and last 2 user messages
		if (modelInfo.supportsPromptCache) {
			this.addPromptCaching(openAiMessages)
		}

		const params: Record<string, any> = {
			model: modelId,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			tools: this.convertToolsForOpenAI(metadata?.tools),
			tool_choice: metadata?.tool_choice,
			parallel_tool_calls: metadata?.parallelToolCalls ?? true,
		}

		// max output tokens: use max_completion_tokens when includeMaxTokens is set
		// (matching DeepSeek/OpenAiHandler convention), otherwise use capped max_tokens
		if (this.options.includeMaxTokens === true) {
			params.max_completion_tokens = this.options.modelMaxTokens || modelInfo.maxTokens
		} else if (maxTokens !== undefined) {
			params.max_tokens = maxTokens
		}

		// Temperature: respect supportsTemperature flag
		if (modelInfo.supportsTemperature !== false) {
			params.temperature = temperature
		}

		// Delegate reasoning params to shared helper
		Object.assign(params, this.getReasoningParams(modelInfo))

		try {
			return this.client.chat.completions.create(
				params as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
				requestOptions,
			)
		} catch (error) {
			throw handleOpenAIError(error, "Bailian")
		}
	}

	/**
	 * Override completePrompt to use Bailian-specific reasoning parameters
	 * (enable_thinking, reasoning_effort) instead of the base class's
	 * generic `thinking: { type: "enabled" }`.
	 *
	 * Temperature and max output tokens are deliberately omitted here — matching
	 * the base class's default behavior for non-streaming completions.
	 */
	override async completePrompt(prompt: string): Promise<string> {
		const { id: modelId, info: modelInfo } = this.getModel()

		const params: Record<string, any> = {
			model: modelId,
			messages: [{ role: "user", content: prompt }],
			stream: false,
		}

		// Delegate reasoning params to shared helper
		Object.assign(params, this.getReasoningParams(modelInfo))

		try {
			const response = await this.client.chat.completions.create(
				params as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
			)
			return response.choices?.[0]?.message.content || ""
		} catch (error) {
			throw handleOpenAIError(error, "Bailian")
		}
	}

	/**
	 * Build reasoning parameters based on model metadata (not hardcoded model IDs).
	 *
	 * - supportsReasoningEffort (array) → reasoning_effort param (DeepSeek V4)
	 * - supportsReasoningBinary (boolean) → enable_thinking param (Qwen, GLM, Kimi)
	 * - Neither → empty (MiniMax-M2.5, thinking-only, no params needed)
	 *
	 * Bailian enables reasoning by default (gated on enableReasoningEffort !== false)
	 * unlike the base class which requires an explicit opt-in (truthy check). This
	 * matches the Bailian settings UI where the thinking toggle defaults to enabled
	 * for thinking-capable models.
	 *
	 * @param modelInfo - The resolved model metadata from
	 *                    {@linkcode getModel()}.
	 * @returns A parameter object to spread into the API request body.
	 *          May contain `enable_thinking`, `thinking_budget`,
	 *          and/or `reasoning_effort`.
	 */
	private getReasoningParams(modelInfo: ModelInfo): Record<string, any> {
		const params: Record<string, any> = {}

		const isEffortReasoningModel = Array.isArray(modelInfo.supportsReasoningEffort)
		const isBinaryReasoningModel = modelInfo.supportsReasoningBinary === true && !isEffortReasoningModel

		if (isBinaryReasoningModel && this.options.enableReasoningEffort !== false) {
			params.enable_thinking = true
			if (this.options.modelMaxThinkingTokens) {
				params.thinking_budget = this.options.modelMaxThinkingTokens
			}
		}

		if (isEffortReasoningModel) {
			const reasoningEffort = this.options.reasoningEffort
			if (this.options.enableReasoningEffort !== false && reasoningEffort && reasoningEffort !== "disable") {
				params.reasoning_effort = reasoningEffort === "xhigh" ? "max" : "high"
			}
		}

		return params
	}

	/**
	 * Inject cache_control: { type: "ephemeral" } into the system message content
	 * and the last two user messages' last text parts.
	 *
	 * This enables DashScope's explicit prompt caching feature for compatible
	 * models. Messages without text parts (e.g. image-only user messages) are
	 * skipped — no sentinel text is injected.
	 *
	 * @param messages - The full OpenAI-format message array (mutated in place).
	 *                   The system message at index 0 receives cache_control on
	 *                   its text content. The last two user messages receive
	 *                   cache_control on their last text part.
	 */
	private addPromptCaching(messages: OpenAI.Chat.ChatCompletionMessageParam[]): void {
		// Inject into the system message (always index 0)
		const systemMsg = messages[0]
		if (systemMsg && systemMsg.role === "system") {
			if (typeof systemMsg.content === "string") {
				const cachedPart: CacheControlTextPart = {
					type: "text",
					text: systemMsg.content,
					cache_control: { type: "ephemeral" },
				}
				systemMsg.content = [cachedPart]
			} else if (Array.isArray(systemMsg.content)) {
				const firstTextPart = systemMsg.content.find(
					(part): part is CacheControlTextPart => part.type === "text",
				)
				if (firstTextPart) {
					firstTextPart.cache_control = { type: "ephemeral" }
				}
			}
		}

		// Inject into the last two user messages
		const lastTwoUserMessages = messages.filter((msg) => msg.role === "user").slice(-2)

		for (const msg of lastTwoUserMessages) {
			if (typeof msg.content === "string") {
				msg.content = [{ type: "text", text: msg.content }]
			}

			if (Array.isArray(msg.content)) {
				const lastTextPart = msg.content
					.filter((part): part is CacheControlTextPart => part.type === "text")
					.pop()

				if (lastTextPart) {
					lastTextPart.cache_control = { type: "ephemeral" }
				}
			}
		}
	}
}
