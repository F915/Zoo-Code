import { useCallback } from "react"
import { Checkbox } from "vscrui"
import { VSCodeTextField, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"

import {
	type ProviderSettings,
	type ModelInfo,
	type OrganizationAllowList,
	type RouterModels,
	bailianModels,
	bailianDefaultModelId,
} from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button, StandardTooltip } from "@src/components/ui"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"
import { handleModelChangeSideEffects } from "../utils/providerModelConfig"
import { ModelPicker } from "../ModelPicker"
import { cn } from "@/lib/utils"

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
	const mergedModels = {
		...(routerModels?.bailian ?? {}),
		...bailianModels,
	} as Record<string, ModelInfo>

	const modelId = (apiConfiguration.apiModelId ?? "").trim()
	const isCustomModel = !!(modelId && !Object.hasOwn(mergedModels, modelId))
	const defaultInfo = bailianModels[bailianDefaultModelId]
	const customInfo = (apiConfiguration?.bailianCustomModelInfo ?? undefined) as ModelInfo | undefined

	// Helper: build a clean base for custom model info
	const makeBase = () => {
		const { description: _, ...base } = defaultInfo as ModelInfo & { description?: string }
		return base as ModelInfo
	}

	return (
		<>
			{/* === Bailian-specific fields === */}
			<div>
				<label className="block font-medium mb-1">{t("settings:providers.bailianRegion")}</label>
				<VSCodeDropdown
					value={apiConfiguration.bailianRegion ?? "beijing"}
					onChange={handleInputChange("bailianRegion")}
					className={cn("w-full")}>
					<VSCodeOption value="beijing">{t("settings:providers.bailianRegionBeijing")}</VSCodeOption>
					<VSCodeOption value="singapore">{t("settings:providers.bailianRegionSingapore")}</VSCodeOption>
					<VSCodeOption value="virginia">{t("settings:providers.bailianRegionVirginia")}</VSCodeOption>
					<VSCodeOption value="frankfurt">{t("settings:providers.bailianRegionFrankfurt")}</VSCodeOption>
					<VSCodeOption value="hongkong">{t("settings:providers.bailianRegionHongKong")}</VSCodeOption>
					<VSCodeOption value="coding-plan">{t("settings:providers.bailianRegionCodingPlan")}</VSCodeOption>
					<VSCodeOption value="token-plan">{t("settings:providers.bailianRegionTokenPlan")}</VSCodeOption>
					<VSCodeOption value="token-plan-sgp">
						{t("settings:providers.bailianRegionTokenPlanSgp")}
					</VSCodeOption>
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
				sortModels={(a, b) => {
					const aPreset = Object.hasOwn(bailianModels, a)
					const bPreset = Object.hasOwn(bailianModels, b)
					if (aPreset !== bPreset) return aPreset ? -1 : 1
					return a.localeCompare(b)
				}}
				onModelChange={(newModelId) =>
					handleModelChangeSideEffects("bailian", newModelId, setApiConfigurationField)
				}
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
							value={customInfo?.maxTokens?.toString() ?? defaultInfo.maxTokens?.toString() ?? ""}
							type="text"
							style={{
								borderColor:
									customInfo?.maxTokens != null && customInfo.maxTokens > 0
										? "var(--vscode-charts-green)"
										: "var(--vscode-input-border)",
							}}
							onInput={handleInputChange("bailianCustomModelInfo", (e) => {
								const value = parseInt((e.target as HTMLInputElement).value)
								return {
									...(customInfo || makeBase()),
									maxTokens: isNaN(value) ? undefined : value === -1 ? undefined : value,
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
							onInput={handleInputChange("bailianCustomModelInfo", (e) => {
								const value = parseInt((e.target as HTMLInputElement).value)
								return {
									...(customInfo || makeBase()),
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
										...(customInfo || makeBase()),
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
										...(customInfo || makeBase()),
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
							onChange={handleInputChange("bailianCustomModelInfo", (e) => {
								const value = parseFloat((e.target as HTMLInputElement).value)
								return {
									...(customInfo || makeBase()),
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
							onChange={handleInputChange("bailianCustomModelInfo", (e) => {
								const value = parseFloat((e.target as HTMLInputElement).value)
								return {
									...(customInfo || makeBase()),
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
					{(customInfo?.supportsPromptCache || (!customInfo && defaultInfo.supportsPromptCache)) && (
						<>
							<div>
								<VSCodeTextField
									value={customInfo?.cacheReadsPrice?.toString() ?? "0"}
									type="text"
									style={{
										borderColor:
											!customInfo?.cacheReadsPrice && customInfo?.cacheReadsPrice !== 0
												? "var(--vscode-input-border)"
												: (customInfo?.cacheReadsPrice ?? 0) >= 0
													? "var(--vscode-charts-green)"
													: "var(--vscode-errorForeground)",
									}}
									onChange={handleInputChange("bailianCustomModelInfo", (e) => {
										const value = parseFloat((e.target as HTMLInputElement).value)
										return {
											...(customInfo || makeBase()),
											cacheReadsPrice: isNaN(value) ? 0 : value,
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
									value={customInfo?.cacheWritesPrice?.toString() ?? "0"}
									type="text"
									style={{
										borderColor:
											!customInfo?.cacheWritesPrice && customInfo?.cacheWritesPrice !== 0
												? "var(--vscode-input-border)"
												: (customInfo?.cacheWritesPrice ?? 0) >= 0
													? "var(--vscode-charts-green)"
													: "var(--vscode-errorForeground)",
									}}
									onChange={handleInputChange("bailianCustomModelInfo", (e) => {
										const value = parseFloat((e.target as HTMLInputElement).value)
										return {
											...(customInfo || makeBase()),
											cacheWritesPrice: isNaN(value) ? 0 : value,
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
						onClick={() => setApiConfigurationField("bailianCustomModelInfo", makeBase())}>
						{t("settings:providers.customModel.resetDefaults")}
					</Button>
				</div>
			)}
		</>
	)
}
