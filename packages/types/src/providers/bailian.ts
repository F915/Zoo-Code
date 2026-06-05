import type { ModelInfo } from "../model.js"

// https://help.aliyun.com/zh/model-studio/text-generation-model/
// https://help.aliyun.com/zh/model-studio/deep-thinking
//
// supportsPromptCache: per cachedoc.md — explicit cache (cache_control) support.
// supportsImages: per imagedoc.md — vision model list.
//
// Pricing (USD per 1M tokens): Beijing CN defaults shown in UI.
// Runtime pricing via getBailianPrice() in bailian-pricing.ts overrides per region endpoint.
// Cache pricing per cachedoc.md: writes = input × 1.25, reads = input × 0.10.
//
// Thinking mode:
// - Mixed mode: enable_thinking toggles on/off (Qwen, GLM, Kimi).
// - Thinking-only: always thinks, enable_thinking not applicable (MiniMax-M2.5).
// - DeepSeek V4: reasoning_effort parameter ("high" / "max").

export type BailianModelId = keyof typeof bailianModels
export const bailianDefaultModelId: BailianModelId = "qwen3.7-plus"

// Ordered: Qwen > DeepSeek > GLM > Kimi > MiniMax; higher version > lower; max > plus > flash > other
export const bailianModels = {
	"qwen3.7-max": {
		maxTokens: 65_536,
		maxThinkingTokens: 262_144,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsReasoningBinary: true,
		supportsTemperature: true,
		inputPrice: 1.65,
		outputPrice: 4.951,
		cacheWritesPrice: 2.0625,
		cacheReadsPrice: 0.165,
		description: "Qwen3.7-Max flagship model with 1M-token context, deep thinking, and structured output.",
	},
	"qwen3.7-plus": {
		maxTokens: 65_536,
		maxThinkingTokens: 81_920,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningBinary: true,
		supportsTemperature: true,
		inputPrice: 0.287,
		outputPrice: 1.147,
		cacheWritesPrice: 0.3588,
		cacheReadsPrice: 0.0287,
		description: "Qwen3.7-Plus with 1M-token context, balanced capability and cost. Recommended default.",
	},
	"qwen3.6-plus": {
		maxTokens: 65_536,
		maxThinkingTokens: 81_920,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningBinary: true,
		supportsTemperature: true,
		inputPrice: 0.276,
		outputPrice: 1.651,
		cacheWritesPrice: 0.345,
		cacheReadsPrice: 0.0276,
		description: "Qwen3.6-Plus native vision-language model balancing capability and cost. Recommended default.",
	},
	"qwen3.6-flash": {
		maxTokens: 65_536,
		maxThinkingTokens: 131_072,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningBinary: true,
		supportsTemperature: true,
		inputPrice: 0.165,
		outputPrice: 0.99,
		cacheWritesPrice: 0.2063,
		cacheReadsPrice: 0.0165,
		description: "Qwen3.6-Flash fast and economical vision-language model with near-flagship quality.",
	},
	"qwen3.5-plus": {
		maxTokens: 65_536,
		maxThinkingTokens: 81_920,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningBinary: true,
		supportsTemperature: true,
		inputPrice: 0.115,
		outputPrice: 0.688,
		cacheWritesPrice: 0.1438,
		cacheReadsPrice: 0.0115,
		description: "Qwen3.5-Plus with 1M-token context, balanced capability and cost.",
	},
	"qwen3.5-flash": {
		maxTokens: 65_536,
		maxThinkingTokens: 81_920,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningBinary: true,
		supportsTemperature: true,
		inputPrice: 0.029,
		outputPrice: 0.287,
		cacheWritesPrice: 0.0363,
		cacheReadsPrice: 0.0029,
		description: "Qwen3.5-Flash fast and economical model with 1M-token context.",
	},
	"deepseek-v4-pro": {
		maxTokens: 393_216,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsReasoningEffort: ["disable", "high", "xhigh"],
		supportsTemperature: true,
		inputPrice: 1.65,
		outputPrice: 3.301,
		cacheWritesPrice: 2.0625,
		cacheReadsPrice: 0.165,
		description: "DeepSeek V4 Pro flagship MoE model with 1M-token context and cutting-edge reasoning.",
	},
	"deepseek-v4-flash": {
		maxTokens: 393_216,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsReasoningEffort: ["disable", "high", "xhigh"],
		supportsTemperature: true,
		inputPrice: 0.138,
		outputPrice: 0.275,
		cacheWritesPrice: 0.1725,
		cacheReadsPrice: 0.0138,
		description: "DeepSeek V4 Flash cost-effective MoE model with 1M-token context and fast inference.",
	},
	"glm-5.1": {
		maxTokens: 131_072,
		maxThinkingTokens: 131_072,
		contextWindow: 202_752,
		supportsImages: false,
		supportsPromptCache: true,
		supportsReasoningBinary: true,
		supportsTemperature: true,
		inputPrice: 0.825,
		outputPrice: 3.301,
		cacheWritesPrice: 1.0313,
		cacheReadsPrice: 0.0825,
		description: "Zhipu GLM-5.1 with structured output, optimized for agent workflows.",
	},
	"kimi-k2.6": {
		maxTokens: 98_304,
		maxThinkingTokens: 81_920,
		contextWindow: 262_144,
		supportsImages: false,
		supportsPromptCache: true,
		supportsReasoningBinary: true,
		supportsTemperature: true,
		inputPrice: 0.8939,
		outputPrice: 3.7131,
		cacheWritesPrice: 1.1174,
		cacheReadsPrice: 0.0894,
		description: "Moonshot Kimi K2.6 with thinking mode disabled by default. Supports Token Plan and Coding Plan.",
	},
	"mimo-v2.5-pro": {
		maxTokens: 131_072,
		maxThinkingTokens: 131_072,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: false,
		supportsReasoningBinary: true,
		supportsTemperature: true,
		description: "Xiaomi MiMo V2.5 Pro with 1M-token context and thinking mode. No pricing available.",
	},
	// MiniMax-M2.5 is thinking-only — always thinks, enable_thinking not applicable.
	"MiniMax-M2.5": {
		maxTokens: 32_768,
		contextWindow: 196_608,
		supportsImages: false,
		supportsPromptCache: false,
		supportsTemperature: true,
		inputPrice: 0.304,
		outputPrice: 1.213,
		description: "MiniMax M2.5 thinking-only model optimized for agent workflows. Supports Token Plan.",
	},
} as const satisfies Record<string, ModelInfo>
