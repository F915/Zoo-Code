import { useCallback, useMemo } from "react"
import { Checkbox } from "vscrui"
import { VSCodeTextField, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"

import {
	type ProviderSettings,
	type ModelInfo,
	type OrganizationAllowList,
	type RouterModels,
	type BailianRegion,
	bailianModels,
	bailianDefaultModelId,
	BAILIAN_REGIONS,
} from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button, StandardTooltip } from "@src/components/ui"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"
import { handleModelChangeSideEffects } from "../utils/providerModelConfig"
import { ModelPicker } from "../ModelPicker"
import { cn } from "@/lib/utils"

/**
 * Mirrors the handler-side findMatchingPreset() logic from
 * src/api/providers/fetchers/bailian.ts for use in the webview
 * context where we cannot import from the extension host.
 *
 * Returns true when the given model ID is an exact or substring
 * match (case-insensitive) of a static preset key, meaning the
 * handler will resolve it to a known preset rather than treating
 * it as unknown/custom.
 */
function matchesPresetLocally(modelId: string): boolean {
	const lower = modelId.trim().toLowerCase()
	if (!lower) return false
	const presetKeys = Object.keys(bailianModels)
	// Exact match (case-insensitive)
	if (presetKeys.some((k) => k.toLowerCase() === lower)) return true
	// Substring match — e.g. "qwen3.7-max" is a substring of
	// the API-returned "qwen3.7-max-2026-05-17"
	return presetKeys.some((k) => lower.includes(k.toLowerCase()))
}

type BailianProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(
		field: K,
		value: ProviderSettings[K],
		isUserAction?: boolean,
	) => void
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
	simplifySettings?: boolean
	routerModels?: RouterModels
}

export const Bailian = ({
	apiConfiguration,
	setApiConfigurationField,
	organizationAllowList,
	modelValidationError,
	simplifySettings,
	routerModels,
}: BailianProps) => {
	const { t } = useAppTranslation()

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	// Merge API-fetched models with static presets.
	// Static presets ("bailianModels") overwrite matching keys from routerModels
	// to ensure known models always get authoritative specs. API models that
	// don't match any preset appear as additional entries with conservative defaults.
	const mergedModels = useMemo(
		() =>
			({
				...(routerModels?.bailian ?? {}),
				...bailianModels,
			}) as Record<string, ModelInfo>,
		[routerModels?.bailian],
	)

	// Build the set of "known" model IDs: static preset keys plus any
	// API-returned model IDs that canonicalize to a preset. A model is
	// "known" when findMatchingPreset() would return a match — i.e. its
	// ID is an exact or substring match of a static preset key after
	// case-insensitive normalization.
	// This mirrors the handler-side findMatchingPreset() logic in
	// src/api/providers/fetchers/bailian.ts but runs in the webview
	// context where we cannot import from the extension host.
	const knownModelIds = useMemo(() => {
		const ids = new Set(Object.keys(bailianModels))
		const presetKeys = Object.keys(bailianModels)
		for (const apiId of Object.keys(routerModels?.bailian ?? {})) {
			const lower = apiId.trim().toLowerCase()
			// Exact match (case-insensitive)
			if (presetKeys.some((k) => k.toLowerCase() === lower)) {
				ids.add(apiId)
				continue
			}
			// Substring match — e.g. "qwen3.7-max" is a substring of
			// the API-returned "qwen3.7-max-2026-05-17"
			if (presetKeys.some((k) => lower.includes(k.toLowerCase()))) {
				ids.add(apiId)
			}
		}
		return ids
	}, [routerModels?.bailian])

	const modelId = (apiConfiguration.apiModelId ?? "").trim()
	const isCustomModel = !!(modelId && !knownModelIds.has(modelId) && !matchesPresetLocally(modelId))

	// Stable sort callback so ModelPicker's useMemo dependency doesn't
	// invalidate on every render.
	// Only static presets (bailianModels keys) sort to the top.
	// Canonicalized matches (versioned/named-space IDs) use preset
	// params but sort alongside unknown models — they are not pinned.
	const sortModels = useCallback((a: string, b: string) => {
		const aPreset = Object.hasOwn(bailianModels, a)
		const bPreset = Object.hasOwn(bailianModels, b)
		if (aPreset !== bPreset) return aPreset ? -1 : 1
		return a.localeCompare(b)
	}, [])
	const defaultInfo = bailianModels[bailianDefaultModelId] as ModelInfo

	const regionLabels: Record<BailianRegion, string> = {
		beijing: t("settings:providers.bailianRegionBeijing"),
		singapore: t("settings:providers.bailianRegionSingapore"),
		virginia: t("settings:providers.bailianRegionVirginia"),
		frankfurt: t("settings:providers.bailianRegionFrankfurt"),
		hongkong: t("settings:providers.bailianRegionHongKong"),
		"coding-plan": t("settings:providers.bailianRegionCodingPlan"),
		"token-plan": t("settings:providers.bailianRegionTokenPlan"),
		"token-plan-sgp": t("settings:providers.bailianRegionTokenPlanSgp"),
	}

	const customInfo = (apiConfiguration?.bailianCustomModelInfo ?? undefined) as ModelInfo | undefined

	return (
		<>
			{/* === Bailian-specific fields === */}
			<div>
				<label className="block font-medium mb-1">{t("settings:providers.bailianRegion")}</label>
				<VSCodeDropdown
					value={apiConfiguration.bailianRegion ?? "beijing"}
					onChange={handleInputChange("bailianRegion")}
					className={cn("w-full")}>
					{BAILIAN_REGIONS.map((region) => (
						<VSCodeOption key={region} value={region}>
							{regionLabels[region]}
						</VSCodeOption>
					))}
				</VSCodeDropdown>
			</div>

			{(apiConfiguration.bailianRegion === "frankfurt" || apiConfiguration.bailianRegion === "hongkong") && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.bailianWorkspaceId || ""}
						onInput={handleInputChange("bailianWorkspaceId")}
						placeholder={t("settings:providers.bailianWorkspaceIdPlaceholder")}
						className="w-full">
						<label className="block font-medium mb-1">{t("settings:providers.bailianWorkspaceId")}</label>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground mt-1">
						{t("settings:providers.bailianWorkspaceIdHint")}
					</div>
				</div>
			)}

			<div>
				<VSCodeTextField
					value={apiConfiguration?.bailianApiKey || ""}
					type="password"
					onInput={handleInputChange("bailianApiKey")}
					placeholder={t("settings:placeholders.apiKey")}
					className="w-full">
					<label className="block font-medium mb-1">{t("settings:providers.bailianApiKey")}</label>
				</VSCodeTextField>
				<div className="text-sm text-vscode-descriptionForeground">
					{t("settings:providers.apiKeyStorageNotice")}
				</div>
				{!apiConfiguration?.bailianApiKey && (
					<VSCodeButtonLink
						href="https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key"
						appearance="secondary">
						{t("settings:providers.getBailianApiKey")}
					</VSCodeButtonLink>
				)}
			</div>

			{/* === Model Picker (above custom config, per OpenAICompatible pattern) === */}
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={bailianDefaultModelId}
				models={mergedModels}
				modelIdKey="apiModelId"
				serviceName="Bailian (Alibaba Cloud)"
				serviceUrl="https://bailian.console.aliyun.com"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
				simplifySettings={simplifySettings}
				hideFreeSearchHint={true}
				sortModels={sortModels}
				onModelChange={(newModelId) => {
					handleModelChangeSideEffects("bailian", newModelId, setApiConfigurationField)
					// Clear custom model overrides when switching to a preset
					// model so stale bailianCustomModelInfo doesn't leak into
					// the UI display or API requests.
					if (knownModelIds.has(newModelId) || matchesPresetLocally(newModelId)) {
						setApiConfigurationField("bailianCustomModelInfo", null)
					}
				}}
			/>

			{/* === Custom Model Configuration (below ModelPicker, per OpenAICompatible pattern) === */}
			{isCustomModel && (
				<div className="flex flex-col gap-3">
					<div className="text-sm text-vscode-descriptionForeground whitespace-pre-line">
						{t("settings:providers.bailianCustomModelHint")}
					</div>

					{/* maxTokens */}
					<div>
						<VSCodeTextField
							value={
								customInfo?.maxTokens != null
									? String(customInfo.maxTokens)
									: (defaultInfo.maxTokens?.toString() ?? "")
							}
							type="text"
							style={{
								borderColor:
									customInfo?.maxTokens != null
										? "var(--vscode-charts-green)"
										: "var(--vscode-input-border)",
							}}
							onBlur={handleInputChange("bailianCustomModelInfo", (e) => {
								const value = parseInt((e.target as HTMLInputElement).value)
								return {
									...(customInfo ?? ({} as ModelInfo)),
									maxTokens: isNaN(value) ? undefined : value,
								}
							})}
							placeholder={t("settings:placeholders.numbers.maxTokens")}
							className="w-full">
							<label className="block font-medium mb-1">
								{t("settings:providers.customModel.maxTokens.label")}
							</label>
						</VSCodeTextField>
						<div className="text-sm text-vscode-descriptionForeground">
							{t("settings:providers.customModel.maxTokens.description")}
						</div>
					</div>

					{/* contextWindow */}
					<div>
						<VSCodeTextField
							value={customInfo?.contextWindow?.toString() ?? defaultInfo.contextWindow?.toString() ?? ""}
							type="text"
							style={{
								borderColor:
									customInfo?.contextWindow != null && customInfo.contextWindow > 0
										? "var(--vscode-charts-green)"
										: "var(--vscode-input-border)",
							}}
							onBlur={handleInputChange("bailianCustomModelInfo", (e) => {
								const value = parseInt((e.target as HTMLInputElement).value)
								return {
									...(customInfo ?? ({} as ModelInfo)),
									// contextWindow is required for model operation;
									// fall back to the default instead of clearing to undefined
									contextWindow: isNaN(value) ? defaultInfo.contextWindow : value,
								}
							})}
							placeholder={t("settings:placeholders.numbers.contextWindow")}
							className="w-full">
							<label className="block font-medium mb-1">
								{t("settings:providers.customModel.contextWindow.label")}
							</label>
						</VSCodeTextField>
						<div className="text-sm text-vscode-descriptionForeground">
							{t("settings:providers.customModel.contextWindow.description")}
						</div>
					</div>

					{/* supportsImages */}
					<div>
						<div className="flex items-center gap-1">
							<Checkbox
								checked={customInfo?.supportsImages ?? defaultInfo.supportsImages ?? false}
								onChange={handleInputChange("bailianCustomModelInfo", (checked) => {
									return {
										...(customInfo ?? ({} as ModelInfo)),
										supportsImages: checked as boolean,
									}
								})}>
								<span className="font-medium">
									{t("settings:providers.customModel.imageSupport.label")}
								</span>
							</Checkbox>
							<StandardTooltip content={t("settings:providers.customModel.imageSupport.description")}>
								<i
									className="codicon codicon-info text-vscode-descriptionForeground"
									style={{ fontSize: "12px" }}
								/>
							</StandardTooltip>
						</div>
						<div className="text-sm text-vscode-descriptionForeground pt-1">
							{t("settings:providers.customModel.imageSupport.description")}
						</div>
					</div>

					{/* supportsPromptCache */}
					<div>
						<div className="flex items-center gap-1">
							<Checkbox
								checked={customInfo?.supportsPromptCache ?? defaultInfo.supportsPromptCache ?? false}
								onChange={handleInputChange("bailianCustomModelInfo", (checked) => {
									return {
										...(customInfo ?? ({} as ModelInfo)),
										supportsPromptCache: checked as boolean,
									}
								})}>
								<span className="font-medium">
									{t("settings:providers.customModel.promptCache.label")}
								</span>
							</Checkbox>
							<StandardTooltip content={t("settings:providers.customModel.promptCache.description")}>
								<i
									className="codicon codicon-info text-vscode-descriptionForeground"
									style={{ fontSize: "12px" }}
								/>
							</StandardTooltip>
						</div>
						<div className="text-sm text-vscode-descriptionForeground pt-1">
							{t("settings:providers.customModel.promptCache.description")}
						</div>
					</div>

					{/* inputPrice */}
					<div>
						<VSCodeTextField
							value={
								customInfo?.inputPrice !== undefined
									? customInfo.inputPrice.toString()
									: (defaultInfo.inputPrice?.toString() ?? "")
							}
							type="text"
							style={{
								borderColor:
									customInfo?.inputPrice === undefined
										? "var(--vscode-input-border)"
										: customInfo.inputPrice >= 0
											? "var(--vscode-charts-green)"
											: "var(--vscode-errorForeground)",
							}}
							onInput={handleInputChange("bailianCustomModelInfo", (e) => {
								const value = parseFloat((e.target as HTMLInputElement).value)
								return {
									...(customInfo ?? ({} as ModelInfo)),
									inputPrice: isNaN(value) ? undefined : value,
								}
							})}
							placeholder={t("settings:placeholders.numbers.inputPrice")}
							className="w-full">
							<div className="flex items-center gap-1">
								<label className="block font-medium mb-1">
									{t("settings:providers.customModel.pricing.input.label")}
								</label>
								<StandardTooltip
									content={t("settings:providers.customModel.pricing.input.description")}>
									<i
										className="codicon codicon-info text-vscode-descriptionForeground"
										style={{ fontSize: "12px" }}
									/>
								</StandardTooltip>
							</div>
						</VSCodeTextField>
					</div>

					{/* outputPrice */}
					<div>
						<VSCodeTextField
							value={
								customInfo?.outputPrice !== undefined
									? customInfo.outputPrice.toString()
									: (defaultInfo.outputPrice?.toString() ?? "")
							}
							type="text"
							style={{
								borderColor:
									customInfo?.outputPrice === undefined
										? "var(--vscode-input-border)"
										: customInfo.outputPrice >= 0
											? "var(--vscode-charts-green)"
											: "var(--vscode-errorForeground)",
							}}
							onInput={handleInputChange("bailianCustomModelInfo", (e) => {
								const value = parseFloat((e.target as HTMLInputElement).value)
								return {
									...(customInfo ?? ({} as ModelInfo)),
									outputPrice: isNaN(value) ? undefined : value,
								}
							})}
							placeholder={t("settings:placeholders.numbers.outputPrice")}
							className="w-full">
							<div className="flex items-center gap-1">
								<label className="block font-medium mb-1">
									{t("settings:providers.customModel.pricing.output.label")}
								</label>
								<StandardTooltip
									content={t("settings:providers.customModel.pricing.output.description")}>
									<i
										className="codicon codicon-info text-vscode-descriptionForeground"
										style={{ fontSize: "12px" }}
									/>
								</StandardTooltip>
							</div>
						</VSCodeTextField>
					</div>

					{/* cache prices — conditional on supportsPromptCache */}
					{(customInfo?.supportsPromptCache ?? defaultInfo.supportsPromptCache) && (
						<>
							<div>
								<VSCodeTextField
									value={customInfo?.cacheReadsPrice?.toString() ?? ""}
									type="text"
									style={{
										borderColor:
											!customInfo?.cacheReadsPrice && customInfo?.cacheReadsPrice !== 0
												? "var(--vscode-input-border)"
												: (customInfo?.cacheReadsPrice ?? 0) >= 0
													? "var(--vscode-charts-green)"
													: "var(--vscode-errorForeground)",
									}}
									onInput={handleInputChange("bailianCustomModelInfo", (e) => {
										const value = parseFloat((e.target as HTMLInputElement).value)
										return {
											...(customInfo ?? ({} as ModelInfo)),
											cacheReadsPrice: isNaN(value) ? undefined : value,
										}
									})}
									placeholder={t("settings:placeholders.numbers.inputPrice")}
									className="w-full">
									<div className="flex items-center gap-1">
										<span className="font-medium">
											{t("settings:providers.customModel.pricing.cacheReads.label")}
										</span>
										<StandardTooltip
											content={t(
												"settings:providers.customModel.pricing.cacheReads.description",
											)}>
											<i
												className="codicon codicon-info text-vscode-descriptionForeground"
												style={{ fontSize: "12px" }}
											/>
										</StandardTooltip>
									</div>
								</VSCodeTextField>
							</div>
							<div>
								<VSCodeTextField
									value={customInfo?.cacheWritesPrice?.toString() ?? ""}
									type="text"
									style={{
										borderColor:
											!customInfo?.cacheWritesPrice && customInfo?.cacheWritesPrice !== 0
												? "var(--vscode-input-border)"
												: (customInfo?.cacheWritesPrice ?? 0) >= 0
													? "var(--vscode-charts-green)"
													: "var(--vscode-errorForeground)",
									}}
									onInput={handleInputChange("bailianCustomModelInfo", (e) => {
										const value = parseFloat((e.target as HTMLInputElement).value)
										return {
											...(customInfo ?? ({} as ModelInfo)),
											cacheWritesPrice: isNaN(value) ? undefined : value,
										}
									})}
									placeholder={t("settings:placeholders.numbers.cacheWritePrice")}
									className="w-full">
									<div className="flex items-center gap-1">
										<label className="block font-medium mb-1">
											{t("settings:providers.customModel.pricing.cacheWrites.label")}
										</label>
										<StandardTooltip
											content={t(
												"settings:providers.customModel.pricing.cacheWrites.description",
											)}>
											<i
												className="codicon codicon-info text-vscode-descriptionForeground"
												style={{ fontSize: "12px" }}
											/>
										</StandardTooltip>
									</div>
								</VSCodeTextField>
							</div>
						</>
					)}

					<Button
						variant="secondary"
						onClick={() => setApiConfigurationField("bailianCustomModelInfo", null)}>
						{t("settings:providers.customModel.resetDefaults")}
					</Button>
				</div>
			)}
		</>
	)
}
