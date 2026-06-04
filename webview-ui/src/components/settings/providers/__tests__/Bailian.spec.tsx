import React from "react"
import { render, screen } from "@/utils/test-utils"
import { Bailian } from "../Bailian"
import type { ProviderSettings } from "@roo-code/types"

// Mock vscrui Checkbox
vi.mock("vscrui", () => ({
	Checkbox: ({ children, checked, onChange }: any) => (
		<label>
			<input
				type="checkbox"
				checked={checked}
				onChange={() => onChange?.(!checked)}
				data-testid="mock-checkbox"
			/>
			{children}
		</label>
	),
}))

// Mock VSCode UI toolkit
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({ children, value, onInput, placeholder, className }: any) => (
		<div className={className}>
			{children}
			<input
				type="text"
				value={value || ""}
				onChange={(e) => onInput?.(e)}
				placeholder={placeholder}
				data-testid="mock-textfield"
			/>
		</div>
	),
	VSCodeDropdown: ({ children, value: _value, onChange: _onChange, className }: any) => (
		<div className={className} data-testid="mock-dropdown">
			{children}
		</div>
	),
	VSCodeOption: ({ children, value }: any) => <option value={value}>{children}</option>,
}))

// Mock translation
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

// Mock UI components
vi.mock("@src/components/ui", () => ({
	Button: ({ children, onClick, variant: _variant }: any) => (
		<button onClick={onClick} data-testid="mock-button">
			{children}
		</button>
	),
	StandardTooltip: ({ children }: any) => <>{children}</>,
}))

// Mock ModelPicker — capture its models prop for assertions
let capturedModels: Record<string, any> = {}
vi.mock("../../ModelPicker", () => ({
	ModelPicker: ({ models }: any) => {
		capturedModels = models
		return <div data-testid="model-picker">{Object.keys(models || {}).length} models</div>
	},
}))

// Mock VSCodeButtonLink
vi.mock("@src/components/common/VSCodeButtonLink", () => ({
	VSCodeButtonLink: ({ children }: any) => <a data-testid="mock-link">{children}</a>,
}))

// Mock provider model config utils
vi.mock("../../utils/providerModelConfig", () => ({
	handleModelChangeSideEffects: vi.fn(),
}))

// Mock transforms
vi.mock("../../transforms", () => ({
	inputEventTransform: (e: any) => (e?.target as HTMLInputElement)?.value ?? e,
}))

const baseApiConfig: ProviderSettings = {
	apiProvider: "bailian",
	bailianApiKey: "test-key",
	bailianRegion: "beijing",
	apiModelId: "qwen3.6-plus",
} as ProviderSettings

const setApiConfigurationField = vi.fn()

function renderBailian(overrides: Partial<ProviderSettings> = {}, routerModels?: any) {
	const apiConfig = { ...baseApiConfig, ...overrides }
	return render(
		<Bailian
			apiConfiguration={apiConfig}
			setApiConfigurationField={setApiConfigurationField}
			organizationAllowList={{ allowAll: true, providers: {} }}
			routerModels={routerModels}
		/>,
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	capturedModels = {}
})

describe("Bailian mergedModels", () => {
	it("static preset overrides API-fetched model with same ID", () => {
		renderBailian(
			{ apiModelId: "qwen3.6-plus" },
			{
				bailian: {
					"qwen3.6-plus": {
						maxTokens: 1,
						contextWindow: 999,
						supportsImages: false,
						supportsPromptCache: false,
					},
				},
			},
		)

		expect(capturedModels["qwen3.6-plus"].maxTokens).toBe(65536)
	})

	it("includes API-only models not in static presets", () => {
		renderBailian(
			{ apiModelId: "qwen3.6-plus" },
			{
				bailian: {
					"some-api-model": {
						maxTokens: 4096,
						contextWindow: 128_000,
						supportsImages: false,
						supportsPromptCache: false,
					},
				},
			},
		)

		expect(capturedModels["some-api-model"]).toBeDefined()
		expect(capturedModels["some-api-model"].maxTokens).toBe(4096)
	})

	it("API model from cache is treated as known (isCustomModel=false)", () => {
		renderBailian(
			{ apiModelId: "api-only-model" },
			{
				bailian: {
					"api-only-model": {
						maxTokens: 2048,
						contextWindow: 64000,
						supportsImages: false,
						supportsPromptCache: false,
					},
				},
			},
		)

		expect(capturedModels["api-only-model"]).toBeDefined()
		expect(screen.getByTestId("model-picker")).toBeDefined()
	})

	it("truly custom model not in either collection triggers isCustomModel=true", () => {
		renderBailian({ apiModelId: "truly-custom-model" }, { bailian: {} })

		expect(capturedModels["truly-custom-model"]).toBeUndefined()
	})

	it("trims whitespace from model ID before lookup", () => {
		renderBailian({ apiModelId: "  qwen3.6-plus  " })

		expect(capturedModels["qwen3.6-plus"]).toBeDefined()
		expect(capturedModels["qwen3.6-plus"].maxTokens).toBe(65536)
	})
})
