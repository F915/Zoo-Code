import type { ModelRecord } from "@roo-code/types"
import { bailianModels } from "@roo-code/types"

import { TelemetryService } from "@roo-code/telemetry"
import { DEFAULT_HEADERS } from "../constants"

/**
 * Keywords used to filter out non-text models from the DashScope /models
 * endpoint. DashScope returns image, embedding, speech, video, OCR, and
 * other non-text models that are not usable via the chat completions API.
 * Matching is case-insensitive.
 */
const NON_TEXT_MODEL_KEYWORDS = [
	"image",
	"embed",
	"speech",
	"asr",
	"tts",
	"paraformer",
	"cosyvoice",
	"sambert",
	"video",
	"ocr",
	"wanx",
]

/**
 * Check whether a model ID belongs to a non-text model that should be
 * excluded from the chat-capable model list.
 *
 * Matching is case-insensitive. Models whose ID contains any keyword
 * from {@linkcode NON_TEXT_MODEL_KEYWORDS} are classified as non-text
 * and will be omitted from the returned {@linkcode ModelRecord}.
 *
 * @param modelId - The raw `id` field from a DashScope /models API response.
 * @returns `true` if the model should be excluded (image, embedding,
 *          speech, video, OCR, etc.), `false` if it is a text-capable model.
 */
function isNonTextModel(modelId: string): boolean {
	const lower = modelId.toLowerCase()
	return NON_TEXT_MODEL_KEYWORDS.some((kw) => lower.includes(kw))
}

/**
 * Find the best-matching preset key for an API-returned model ID.
 *
 * Matching is case-insensitive. For example, API-returned "ZHIPU/GLM-5.1"
 * matches preset key "glm-5.1" because "glm-5.1" is a case-insensitive
 * substring of "ZHIPU/GLM-5.1".
 *
 * Priority:
 * 1. Exact match (e.g. apiId "qwen3.7-max" === presetKey "qwen3.7-max")
 *    → Returns the matching preset key.
 * 2. Substring match (e.g. presetKey "glm-5.1" is substring of apiId
 *    "ZHIPU/GLM-5.1", or presetKey "qwen3.7-max" is substring of
 *    apiId "qwen3.7-max-2026-05-17")
 *    → Returns the substring-matching preset key.
 * 3. No match → Returns null.
 *
 * When multiple preset keys are substrings of the API ID, the longest
 * matching key wins (more specific match). When two keys have equal
 * length (e.g. both "model-v1" and "model-v2" are substrings of
 * "model-v1-v2"), the result depends on Object.keys() iteration order
 * — which follows insertion order in the bailianModels object. This
 * is not a practical concern with the current preset set because no
 * two presets share a common substring of equal length.
 *
 * @param apiModelId - The raw model ID string returned by the DashScope
 *                     /models endpoint.
 * @returns The matching preset key (from {@linkcode bailianModels}),
 *          or `null` if no preset matches.
 */
export function findMatchingPreset(apiModelId: string): string | null {
	const lowerId = apiModelId.trim().toLowerCase()
	const presetKeys = Object.keys(bailianModels)

	// Priority 1: exact match (case-insensitive)
	const exactMatch = presetKeys.find((key) => key.toLowerCase() === lowerId)
	if (exactMatch) return exactMatch

	// Priority 2: substring match — pick the longest matching preset key
	let bestMatch: string | null = null
	let bestLength = 0

	for (const key of presetKeys) {
		const lowerKey = key.toLowerCase()
		if (lowerId.includes(lowerKey) && lowerKey.length > bestLength) {
			bestMatch = key
			bestLength = lowerKey.length
		}
	}

	return bestMatch
}

/**
 * Fetches available models from the DashScope API (OpenAI-compatible
 * /models endpoint) and enriches them with metadata from the static
 * `bailianModels` preset map or conservative defaults.
 *
 * The DashScope /models endpoint only returns basic model identity
 * ({ id, created, object, owned_by }) without pricing, context window,
 * or capability metadata. We merge API results with known specs where
 * possible and use conservative defaults for unknown models.
 *
 * @param baseUrl - The DashScope compatible-mode base URL (region-specific)
 * @param apiKey  - Bailian API key for authentication
 * @returns A ModelRecord keyed by model ID
 */
export async function getBailianModels(baseUrl?: string, apiKey?: string): Promise<ModelRecord> {
	const normalizedBase = (baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/+$/, "")
	const url = `${normalizedBase}/models`

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...DEFAULT_HEADERS,
	}

	if (apiKey) {
		headers["Authorization"] = `Bearer ${apiKey}`
	}

	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), 10_000)

	try {
		const response = await fetch(url, {
			headers,
			signal: controller.signal,
		})

		if (!response.ok) {
			let errorBody = ""
			try {
				errorBody = await response.text()
			} catch (e) {
				console.error("[getBailianModels] Failed to read error response body:", e)
				errorBody = "(unable to read response body)"
			}

			console.error(`[getBailianModels] HTTP error:`, {
				status: response.status,
				statusText: response.statusText,
				url,
				body: errorBody.substring(0, 500),
			})

			TelemetryService.instance.captureException(
				new Error(`[getBailianModels] HTTP ${response.status}: ${response.statusText}`),
				{ extra: { url, status: response.status, body: errorBody.substring(0, 500) } },
			)

			const detail = errorBody.substring(0, 200)
			throw new Error(`HTTP ${response.status}: ${response.statusText} — ${detail}`)
		}

		const data = await response.json()

		if (!data?.data || !Array.isArray(data.data)) {
			console.error("[getBailianModels] Unexpected response format:", data)
			throw new Error("Failed to fetch Bailian models: Unexpected response format.")
		}

		// Use null-prototype to prevent prototype pollution
		const models: ModelRecord = Object.create(null)

		for (const model of data.data) {
			const modelId: string | null = typeof model.id === "string" && model.id ? model.id : null
			if (!modelId) continue

			// Filter out non-text models (image, embedding, speech, video, etc.)
			if (isNonTextModel(modelId)) continue

			// Look up matching preset
			const matchedPresetKey = findMatchingPreset(modelId)

			if (matchedPresetKey) {
				// Known model (exact or substring match) — use preset spec
				models[modelId] = { ...bailianModels[matchedPresetKey as keyof typeof bailianModels] }
			} else {
				// Unknown model — minimal metadata so it appears in the UI
				// picker but makes no capability assumptions. The handler's
				// getModel() will use a matching minimal fallback, and users
				// can enable capabilities via custom model config in the UI.
				models[modelId] = {
					contextWindow: 200_000,
					supportsImages: false,
					supportsPromptCache: false,
					supportsTemperature: true,
				}
			}
		}

		return models
	} finally {
		clearTimeout(timeoutId)
	}
}
