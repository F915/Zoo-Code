import { bench, describe } from "vitest"

import { sanitizeToolUseId, truncateOpenAiCallId, sanitizeOpenAiCallId } from "../utils/tool-id"

const shortId = "toolu_01ABC123"
const longId = "toolu_" + "a".repeat(100) + "_special!@#$%chars"
const specialCharsId = "call!@#$%^&*()+={}[]|\\:;<>,?/ id with spaces"

describe("sanitizeToolUseId", () => {
	bench("clean ID (no-op)", () => {
		sanitizeToolUseId(shortId)
	})

	bench("ID with special characters", () => {
		sanitizeToolUseId(specialCharsId)
	})
})

describe("truncateOpenAiCallId", () => {
	bench("short ID (no truncation)", () => {
		truncateOpenAiCallId(shortId)
	})

	bench("long ID (needs truncation + hash)", () => {
		truncateOpenAiCallId(longId)
	})
})

describe("sanitizeOpenAiCallId", () => {
	bench("short clean ID", () => {
		sanitizeOpenAiCallId(shortId)
	})

	bench("long ID with special characters", () => {
		sanitizeOpenAiCallId(longId)
	})

	bench("special characters ID", () => {
		sanitizeOpenAiCallId(specialCharsId)
	})
})
