import type { BailianRegion } from "@roo-code/types"

/**
 * Base URLs for each Bailian region endpoint. Each region uses a distinct
 * DashScope-compatible base URL with the format
 * `https://<host>/compatible-mode/v1` (except coding-plan which uses `/v1`).
 *
 * Region keys correspond to the Zod-validated
 * {@linkcode ProviderSettings.bailianRegion} enum values.
 */
const REGION_URLS: Record<BailianRegion, string> = {
	beijing: "https://dashscope.aliyuncs.com/compatible-mode/v1",
	singapore: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
	virginia: "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
	frankfurt: "", // dynamically constructed via workspaceId
	hongkong: "", // dynamically constructed via workspaceId
	"coding-plan": "https://coding.dashscope.aliyuncs.com/v1",
	"token-plan": "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
	"token-plan-sgp": "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
}

/**
 * Resolve a Bailian region + optional workspace ID into the DashScope-compatible
 * base URL.
 *
 * Throws for frankfurt/hongkong when workspaceId is missing or invalid,
 * and for unknown region values (the caller is responsible for catching
 * this when appropriate).
 *
 * @param region      - The region identifier (e.g. "beijing", "singapore").
 *                      Defaults to "beijing" when undefined. Must be one of
 *                      the keys in {@linkcode REGION_URLS}.
 * @param workspaceId - Required for frankfurt/hongkong regions; ignored
 *                      for all others. Must match `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`.
 * @returns The fully-qualified DashScope-compatible base URL for the region.
 * @throws {Error} When region is frankfurt or hongkong and workspaceId
 *                 is missing or malformed, or when region is unknown.
 */
export function getBailianBaseUrl(region?: string, workspaceId?: string): string {
	const r = region ?? "beijing"

	if (r === "frankfurt" || r === "hongkong") {
		const wsId = workspaceId?.trim()
		if (!wsId) {
			throw new Error(`Bailian ${r} endpoint requires a Workspace ID. Please configure it in provider settings.`)
		}
		if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(wsId)) {
			throw new Error(
				`Invalid Bailian Workspace ID: "${wsId}". Only alphanumeric characters, hyphens, and underscores are allowed.`,
			)
		}
		const zone = r === "frankfurt" ? "eu-central-1" : "cn-hongkong"
		return `https://${wsId}.${zone}.maas.aliyuncs.com/compatible-mode/v1`
	}

	const url = REGION_URLS[r as BailianRegion]
	if (!url) {
		throw new Error(`Unknown Bailian region "${r}". Valid regions: ${Object.keys(REGION_URLS).join(", ")}`)
	}
	return url
}
