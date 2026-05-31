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

import { type ApiHandlerOptions, getModelMaxOutputTokens } from "../../shared/api"
import type { ApiHandlerCreateMessageMetadata } from "../index"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"
import { handleOpenAIError } from "./utils/openai-error-handler"

const REGION_URLS: Record<string, string> = {
	beijing: "https://dashscope.aliyuncs.com/compatible-mode/v1",
	singapore: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
	virginia: "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
	"coding-plan": "https://coding.dashscope.aliyuncs.com/v1",
	"token-plan": "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
	"token-plan-sgp": "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
}

const deepSeekModelIds = new Set(["deepseek-v4-pro", "deepseek-v4-flash"])

// MiniMax-M2.5 is thinking-only per Bailian docs — model always thinks, enable_thinking not applicable
const thinkingOnlyModelIds = new Set(["MiniMax-M2.5"])

export class BailianHandler extends BaseOpenAiCompatibleProvider<BailianModelId> {
	private readonly bailianOptions: ApiHandlerOptions

	constructor(options: ApiHandlerOptions) {
		const region = options.bailianRegion ?? "beijing"
		const baseURL =
			region === "frankfurt" || region === "hongkong"
				? (() => {
						const wsId = options.bailianWorkspaceId
						if (!wsId) {
							throw new Error(
								`Bailian ${region} endpoint requires a Workspace ID. Please configure it in provider settings.`,
							)
						}
						if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(wsId)) {
							throw new Error(
								`Invalid Bailian Workspace ID: "${wsId}". Only alphanumeric characters, hyphens, and underscores are allowed.`,
							)
						}
						const zone = region === "frankfurt" ? "eu-central-1" : "cn-hongkong"
						return `https://${wsId}.${zone}.maas.aliyuncs.com/compatible-mode/v1`
					})()
				: (REGION_URLS[region] ?? REGION_URLS["beijing"])

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

	// Mode B: ID passthrough with dynamic pricing per region endpoint.
	// Custom model overrides from bailianCustomModelInfo are merged on top.
	override getModel() {
		const userModelId = this.bailianOptions.apiModelId
		const id = (userModelId?.trim() ? userModelId : this.defaultProviderModelId) as BailianModelId
		const isKnownModel = id in this.providerModels
		const baseInfo = this.providerModels[id] ?? this.providerModels[this.defaultProviderModelId]
		const region = (this.bailianOptions.bailianRegion ?? "beijing") as BailianRegion
		const price = getBailianPrice(id, region)
		const custom = this.bailianOptions.bailianCustomModelInfo as ModelInfo | undefined | null
		const info: ModelInfo = isKnownModel
			? { ...baseInfo, ...price }
			: { ...baseInfo, ...price, ...(custom || {}) }
		return { id, info }
	}

	/**
	 * Override createStream to inject Bailian-specific parameters.
	 *
	 * Per Bailian docs (https://help.aliyun.com/zh/model-studio/deep-thinking):
	 * "In Node.js SDK, non-standard params like enable_thinking are passed as
	 * top-level properties, no need for extra_body."
	 *
	 * createMessage() is handled by the base class — TagMatcher, reasoning_content,
	 * tool_call state management, and usage metrics with cost calculation.
	 */
	protected override createStream(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
		requestOptions?: OpenAI.RequestOptions,
	) {
		const { id: modelId, info: modelInfo } = this.getModel()

		const max_tokens =
			getModelMaxOutputTokens({
				modelId,
				model: modelInfo,
				settings: this.options,
				format: "openai",
			}) ?? undefined

		const temperature = this.options.modelTemperature ?? modelInfo.defaultTemperature ?? this.defaultTemperature

		const params: Record<string, any> = {
			model: modelId,
			max_tokens,
			temperature,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			stream: true,
			stream_options: { include_usage: true },
			tools: this.convertToolsForOpenAI(metadata?.tools),
			tool_choice: metadata?.tool_choice,
			parallel_tool_calls: metadata?.parallelToolCalls ?? true,
		}

		// enable_thinking: linked to "Enable Reasoning Effort" UI toggle (enableReasoningEffort).
		// Applies to mixed-thinking models (Qwen/GLM/Kimi/MiMo); skipped for thinking-only models.
		if (
			!thinkingOnlyModelIds.has(modelId) &&
			this.options.enableReasoningEffort !== false &&
			modelInfo.supportsReasoningBinary
		) {
			params.enable_thinking = true
			if (this.options.modelMaxThinkingTokens) {
				params.thinking_budget = this.options.modelMaxThinkingTokens
			}
		}

		// reasoning_effort: DeepSeek V4 models.
		// Gated on enableReasoningEffort; "disable" means skip entirely.
		const reasoningEffort = this.options.reasoningEffort
		if (
			deepSeekModelIds.has(modelId) &&
			this.options.enableReasoningEffort !== false &&
			reasoningEffort &&
			reasoningEffort !== "disable"
		) {
			params.reasoning_effort = reasoningEffort === "xhigh" ? "max" : "high"
		}

		try {
			return this.client.chat.completions.create(
				params as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
				requestOptions,
			)
		} catch (error) {
			throw handleOpenAIError(error, "Bailian")
		}
	}
}