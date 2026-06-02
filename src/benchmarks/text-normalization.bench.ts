import { bench, describe } from "vitest"

import { normalizeString, unescapeHtmlEntities } from "../utils/text-normalization"

const shortInput = "Hello “World” — it’s a test…"
const longInput = Array(100).fill("The “quick” brown fox’s jump — over the lazy dog…   extra  spaces ").join("\n")
const htmlInput = "&lt;div class=&quot;test&quot;&gt;Hello &amp; World&#39;s &#91;bracket&#93; &lt;/div&gt;".repeat(50)

describe("normalizeString", () => {
	bench("short string", () => {
		normalizeString(shortInput)
	})

	bench("long string (100 lines)", () => {
		normalizeString(longInput)
	})

	bench("smart quotes only", () => {
		normalizeString(longInput, {
			smartQuotes: true,
			typographicChars: false,
			extraWhitespace: false,
			trim: false,
		})
	})

	bench("all options enabled", () => {
		normalizeString(longInput, {
			smartQuotes: true,
			typographicChars: true,
			extraWhitespace: true,
			trim: true,
		})
	})
})

describe("unescapeHtmlEntities", () => {
	bench("short input", () => {
		unescapeHtmlEntities("&lt;p&gt;Hello &amp; World&lt;/p&gt;")
	})

	bench("long input (50 repetitions)", () => {
		unescapeHtmlEntities(htmlInput)
	})
})
