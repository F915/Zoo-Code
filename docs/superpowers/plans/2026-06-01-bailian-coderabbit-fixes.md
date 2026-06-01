# Bailian CodeRabbit 4-Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 correctness/code-quality issues identified by coderabbit code review + add explanatory comments for 1 deferred issue: (1) versioned model ID metadata fallback bug, (2) document why shared cache key is safe (deferred full fix), (3) missing E2E suite teardown, (4) unsaved region/workspace override not respected.

**Architecture:** Four independent tasks touching 6 files. Task 2 (deferred cache key fix) reduces to adding comments at 2 locations explaining the design rationale. Tasks 1, 3, 4 are surgical: one block change in bailian.ts + 1 new test, suiteTeardown block in E2E, two extra local variables in webviewMessageHandler.

**Tech Stack:** TypeScript, Vitest (unit tests), Mocha (E2E)

---

### Task 1: Fix versioned model ID metadata fallback (coderabbit Comment 2)

**Files:**
- Modify: `src/api/providers/bailian.ts:99-105`
- Modify: `src/api/providers/__tests__/bailian.spec.ts` (add test after line 489)

- [ ] **Step 1: Write the failing test**

Add to `src/api/providers/__tests__/bailian.spec.ts` after the `"versioned variant gets canonical pricing via findMatchingPreset"` test (after line 489):

```typescript
it("versioned variant gets canonical metadata (not default) on cold start", () => {
    // Simulate cold start: no cache (getModelsFromCache returns undefined by default in beforeEach)
    const h = new BailianHandler({
        bailianApiKey: "test-key",
        bailianRegion: "beijing",
        apiModelId: "qwen3.7-max-2026-05-17",
    })
    const result = h.getModel()
    // Versioned ID "qwen3.7-max-2026-05-17" matches preset "qwen3.7-max" via substring
    expect(result.info.maxTokens).toBe(65536)          // from qwen3.7-max preset
    expect(result.info.contextWindow).toBe(1_000_000)   // qwen3.7-max preset value
    expect(result.info.supportsImages).toBe(true)       // qwen3.7-max preset value
    expect(result.info.supportsReasoningBinary).toBe(true) // qwen3.7-max preset value
})
```

- [ ] **Step 2: Run test to verify it fails**

```sh
cd src && npx vitest run api/providers/__tests__/bailian.spec.ts -t "versioned variant gets canonical metadata"
```

Expected: **FAIL** — if the bug exists, `contextWindow` will be the default model's value (qwen3.6-plus: 131072) rather than qwen3.7-max's (1000000).

- [ ] **Step 3: Implement the fix**

In `src/api/providers/bailian.ts`, replace lines 99-103:

**Before:**
```typescript
		const canonicalKey = findMatchingPreset(id) ?? id
		const price = getBailianPrice(canonicalKey, region)
		const custom = this.bailianOptions.bailianCustomModelInfo as ModelInfo | undefined | null

		const baseInfo = staticInfo ?? cachedInfo ?? this.providerModels[this.defaultProviderModelId]
```

**After:**
```typescript
		const canonicalKey = findMatchingPreset(id) ?? id
		const price = getBailianPrice(canonicalKey, region)
		const custom = this.bailianOptions.bailianCustomModelInfo as ModelInfo | undefined | null

		// If findMatchingPreset resolved to a different key, use that
		// preset's metadata before falling back to the default model.
		// This ensures versioned/named-space IDs (e.g. "qwen3.7-max-2026-05-17"
		// matching preset "qwen3.7-max") get the correct capabilities on cold start.
		const matchedPresetInfo =
			canonicalKey !== id && canonicalKey in this.providerModels
				? this.providerModels[canonicalKey as BailianModelId]
				: undefined

		const baseInfo =
			staticInfo ?? cachedInfo ?? matchedPresetInfo ?? this.providerModels[this.defaultProviderModelId]
```

Key design decisions:
- The `canonicalKey !== id` guard avoids a redundant lookup when `findMatchingPreset` returned `null` (in which case `canonicalKey === id`)
- `in` operator + type assertion matches the surrounding code style
- Comment references concrete example `qwen3.7-max-2026-05-17` → `qwen3.7-max`

- [ ] **Step 4: Run tests to verify the fix**

```sh
cd src && npx vitest run api/providers/__tests__/bailian.spec.ts -t "versioned variant"
```

Expected: both the existing pricing test AND the new metadata test **PASS**.

- [ ] **Step 5: Run full handler test suite to check for regressions**

```sh
cd src && npx vitest run api/providers/__tests__/bailian.spec.ts
```

Expected: all existing tests still **PASS** (35+ tests, 0 failures).

- [ ] **Step 6: Commit**

```sh
git add src/api/providers/bailian.ts src/api/providers/__tests__/bailian.spec.ts
git commit -m "fix(bailian): use matched preset metadata for versioned model IDs on cold start

findMatchingPreset() canonicalized the model ID but the resolved key was only
used for pricing lookup (getBailianPrice). Metadata still fell back to the
default model when neither staticInfo nor cachedInfo matched, causing
versioned IDs like qwen3.7-max-2026-05-17 to get wrong capabilities.

Add matchedPresetInfo as a third fallback tier in baseInfo resolution."
```

---

### Task 2: Document why shared cache key is acceptable for Bailian (coderabbit Comment 3)

**Decision:** Defer the full cache-key isolation fix (risk > reward for shared infrastructure change). Instead, add comments explaining why the current single-key approach is safe in practice.

**Files:**
- Modify: `src/api/providers/fetchers/modelCache.ts:100-102` — add comment near `case "bailian":`
- Modify: `src/api/providers/bailian.ts:94` — add comment near `getModelsFromCache("bailian")`

- [ ] **Step 1: Add comment in modelCache.ts explaining the single-key design**

In `src/api/providers/fetchers/modelCache.ts`, replace lines 100-102:

**Before:**
```typescript
		case "bailian":
			models = await getBailianModels(options.baseUrl, options.apiKey)
			break
```

**After:**
```typescript
		case "bailian":
			// NOTE: Bailian uses a provider-only cache key ("bailian")
			// shared across all region endpoints. This is acceptable
			// in practice because:
			//
			// 1. Most users stay on a single region — per-endpoint
			//    model lists differ only rarely (primarily for
			//    region-exclusive beta models).
			// 2. Region switch always calls flushModels(refresh=true)
			//    first, which fetches fresh data from the correct
			//    endpoint before any stale cache could reach the UI.
			// 3. The memory cache TTL is 5 minutes, so stale data
			//    expires quickly on its own.
			// 4. If the constructor detects a workspace-dependent URL,
			//    the handler won't be built without a valid workspaceId
			//    — the cache simply holds the last successfully fetched
			//    list.
			//
			// If multi-region usage becomes common, the fix is to
			// derive a cache key from the normalized baseUrl
			// (e.g. "bailian:<normalizedBaseUrl>") so each endpoint
			// gets its own cache entry. This was deferred to avoid
			// risky signature changes to shared infrastructure
			// (getModelsFromCache, writeModels, readModels,
			// inFlightRefresh) that serve 10+ providers.
			models = await getBailianModels(options.baseUrl, options.apiKey)
			break
```

- [ ] **Step 2: Add comment in bailian.ts explaining the cache lookup**

In `src/api/providers/bailian.ts`, replace line 94:

**Before:**
```typescript
		const cachedModels = getModelsFromCache("bailian")
```

**After:**
```typescript
		// Shared cache key ("bailian") across all regions — see
		// note in modelCache.ts case "bailian" for rationale. In
		// short: region switch flushes the cache before any stale
		// data reaches the UI, and the TTL is only 5 minutes.
		const cachedModels = getModelsFromCache("bailian")
```

- [ ] **Step 3: Commit**

```sh
git add src/api/providers/fetchers/modelCache.ts src/api/providers/bailian.ts
git commit -m "docs(bailian): document why shared cache key across regions is safe

Add comments in modelCache.ts (case 'bailian') and bailian.ts (getModelsFromCache
call) explaining why the single 'bailian' cache key is acceptable despite
per-region model lists. The full per-baseUrl cache isolation fix was deferred
because the risk of changing shared infrastructure signatures outweighs the
practical benefit for the current single-region usage pattern."
```

---

### Task 3: Add E2E suiteTeardown to restore default config (coderabbit Comment 1)

**Files:**
- Modify: `apps/vscode-e2e/src/suite/providers/bailian.test.ts:117-129`

- [ ] **Step 1: Add `getConfiguration` capture and suiteTeardown**

In `apps/vscode-e2e/src/suite/providers/bailian.test.ts`, modify the `before` hook and add `suiteTeardown`:

**Before (lines 120-128):**
```typescript
	/** @type {import("../../../src/extension/api").API} */
	let api: any

	before(async function () {
		api = globalThis.api
		if (!api) {
			throw new Error("E2E API not found — ensure the test runner initializes globalThis.api")
		}
	})
```

**After:**
```typescript
	/** @type {import("../../../src/extension/api").API} */
	let api: any

	/** @type {import("../../../src/extension/api").ProviderSettings} */
	let originalConfig: any

	before(async function () {
		api = globalThis.api
		if (!api) {
			throw new Error("E2E API not found — ensure the test runner initializes globalThis.api")
		}
		originalConfig = await api.getConfiguration()
	})

	suiteTeardown(async function () {
		if (originalConfig) {
			await api.setConfiguration(originalConfig)
		}
	})
```

This follows the same pattern as `bedrock.test.ts:52-55` — capture original config before tests mutate it, restore in suiteTeardown.

- [ ] **Step 2: Verify E2E tests still pass**

```sh
pnpm --filter @roo-code/vscode-e2e test:ci:mock
```

Expected: Bailian E2E tests pass (or same pre-existing failures — no new failures).

- [ ] **Step 3: Commit**

```sh
git add apps/vscode-e2e/src/suite/providers/bailian.test.ts
git commit -m "test(bailian): add suiteTeardown to restore default provider config

Prevents Bailian E2E settings from leaking into subsequent test suites.
Follows the same pattern as bedrock.test.ts suiteTeardown."
```

---

### Task 4: Respect unsaved region/workspaceId overrides (coderabbit Comment 4)

**Files:**
- Modify: `src/core/webview/webviewMessageHandler.ts:1033-1041`

- [ ] **Step 1: Apply the fix**

In `src/core/webview/webviewMessageHandler.ts`, replace the region/workspace resolution block:

**Before:**
```typescript
			const bailianApiKey = message?.values?.bailianApiKey ?? apiConfiguration.bailianApiKey

			if (bailianApiKey) {
				let bailianBaseUrl: string
				try {
					bailianBaseUrl = getBailianBaseUrl(
						apiConfiguration.bailianRegion,
						apiConfiguration.bailianWorkspaceId,
					)
```

**After:**
```typescript
			const bailianApiKey = message?.values?.bailianApiKey ?? apiConfiguration.bailianApiKey
			const bailianRegion = message?.values?.bailianRegion ?? apiConfiguration.bailianRegion
			const bailianWorkspaceId =
				message?.values?.bailianWorkspaceId ?? apiConfiguration.bailianWorkspaceId

			if (bailianApiKey) {
				let bailianBaseUrl: string
				try {
					bailianBaseUrl = getBailianBaseUrl(bailianRegion, bailianWorkspaceId)
```

This makes the region/workspaceId resolution consistent with the API key pattern: unsaved form values (`message.values`) take precedence over saved configuration (`apiConfiguration`).

- [ ] **Step 2: Verify type check**

```sh
pnpm check-types
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```sh
git add src/core/webview/webviewMessageHandler.ts
git commit -m "fix(bailian): read region/workspaceId from message.values for refresh models

When the user clicks 'Refresh Models' with unsaved region/workspaceId changes
in the settings form, resolve those values from message.values first (same
pattern as the API key) before falling back to the saved apiConfiguration.
Previously, only apiConfiguration was read, so a refresh request would hit
the previously-saved region endpoint instead of the one currently shown in
the form."
```

---

### Verification (After All Tasks)

```sh
# Unit tests — handler
cd src && npx vitest run api/providers/__tests__/bailian.spec.ts

# Unit tests — fetcher regression
cd src && npx vitest run api/providers/fetchers/__tests__/bailian.spec.ts

# Full backend regression
cd src && npx vitest run

# Type check
pnpm check-types

# Webview-UI tests
cd webview-ui && npx vitest run

# E2E tests
pnpm --filter @roo-code/vscode-e2e test:ci:mock
```
