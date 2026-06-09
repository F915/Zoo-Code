/**
 * Linux-only e2e smoke test for the VS Code terminal profile override.
 *
 * Proves that:
 *  1. Setting a profile override causes commands to run through the selected
 *     VS Code integrated-terminal shell.
 *  2. Clearing the override starts a fresh terminal on the next command.
 *  3. Shell integration completes before the first command — transient
 *     startup races are tolerated, but systemic failure fails. The guard
 *     runs only when a capability probe confirms SI is available.
 *
 * Windows profile coverage (cmd.exe fast-path, PowerShell) is proven by unit
 * tests in src/integrations/terminal/__tests__/. This test requires /bin/bash
 * which only exists on Linux/macOS.
 */
import * as assert from "assert"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

import { RooCodeEventName, type ClineMessage, type RooCodeAPI } from "@roo-code/types"

import { sleep, waitUntilCompleted } from "../utils"
import { setDefaultSuiteTimeout } from "../test-utils"

const TEST_DIR_NAME = "terminal-profile-e2e"
const OVERRIDE_FILE = "terminal-profile-override.txt"
const DEFAULT_FILE = "terminal-profile-default.txt"
const PROFILE_NAME = "Zoo E2E Bash"
const PROFILE_SHELL_ARGS = ["--noprofile", "--norc"]

/** Set by suiteSetup after probing whether VS Code shell integration can
 *  activate in this environment. Gates the regression guard suite. */
let shellIntegrationWorks = false

/** Result of a single profile task run. */
interface ProfileRunResult {
	gotWarning: boolean
	gotError: boolean
	errorText?: string
	warningText?: string
	outputContent: string
	gotMarker: boolean
}

/**
 * Run a profile e2e task and collect messages.
 *
 * Returns structured results instead of requiring each test to duplicate
 * the message collection, assertion, and file-reading logic.
 */
async function runProfileTask(
	api: RooCodeAPI,
	prompt: string,
	outputFile: string,
	marker: string,
	testDir: string,
): Promise<ProfileRunResult> {
	const messages: ClineMessage[] = []

	const messageHandler = ({ message }: { message: ClineMessage }) => {
		messages.push(message)
	}
	api.on(RooCodeEventName.Message, messageHandler)

	try {
		await waitUntilCompleted({
			api,
			start: () =>
				api.startNewTask({
					configuration: {
						mode: "code",
						autoApprovalEnabled: true,
						alwaysAllowExecute: true,
						allowedCommands: ["*"],
						terminalShellIntegrationDisabled: false,
					},
					text: prompt,
				}),
			timeout: 90_000,
		})

		const gotWarning = messages.some((m) => m.type === "say" && m.say === "shell_integration_warning")
		const gotError = messages.some((m) => m.type === "say" && m.say === "error")
		const errorMsg = messages.find((m) => m.type === "say" && m.say === "error")
		const warningMsg = messages.find((m) => m.type === "say" && m.say === "shell_integration_warning")

		let outputContent = ""
		let gotMarker = false
		try {
			outputContent = await fs.readFile(path.join(testDir, outputFile), "utf-8")
			gotMarker = outputContent.includes(marker)
		} catch {
			// File may not exist if command failed
		}

		return {
			gotWarning,
			gotError,
			errorText: errorMsg?.text,
			warningText: warningMsg?.text,
			outputContent,
			gotMarker,
		}
	} finally {
		api.off(RooCodeEventName.Message, messageHandler)
	}
}

suite("Terminal Profile", function () {
	if (process.platform !== "linux") {
		return
	}

	setDefaultSuiteTimeout(this)

	let workspaceDir: string
	let testDir: string
	let originalProfiles: Record<string, unknown> | undefined
	let profilesSaved = false
	let previousSiTimeout: number = 5_000

	suiteSetup(async () => {
		const aimockUrl = process.env.AIMOCK_URL
		const isRecord = process.env.AIMOCK_RECORD === "true"

		await globalThis.api.setConfiguration({
			apiProvider: "openrouter" as const,
			openRouterApiKey: aimockUrl && !isRecord ? "mock-key" : process.env.OPENROUTER_API_KEY!,
			openRouterModelId: "anthropic/claude-sonnet-4.5",
			...(aimockUrl && { openRouterBaseUrl: `${aimockUrl}/v1` }),
		})

		const workspaceFolders = vscode.workspace.workspaceFolders
		if (!workspaceFolders?.length) throw new Error("No workspace folder found")
		workspaceDir = workspaceFolders[0]!.uri.fsPath
		testDir = path.join(workspaceDir, TEST_DIR_NAME)
		await fs.rm(testDir, { recursive: true, force: true })
		await fs.mkdir(testDir, { recursive: true })

		// Save the current global linux profiles so we can restore them in teardown.
		originalProfiles = vscode.workspace
			.getConfiguration("terminal.integrated.profiles")
			.inspect<Record<string, unknown>>("linux")?.globalValue
		profilesSaved = true

		// Write the test profile to VS Code user (global) settings.
		// Terminal.getConfiguredProfiles() intentionally excludes workspace settings
		// for security, so global scope is required here.
		await vscode.workspace.getConfiguration("terminal.integrated.profiles").update(
			"linux",
			{
				...originalProfiles,
				[PROFILE_NAME]: { path: "/bin/bash", args: PROFILE_SHELL_ARGS },
			},
			vscode.ConfigurationTarget.Global,
		)

		// Activate the profile override in-process. api.setConfiguration() alone
		// does not call Terminal.setTerminalProfile(), so this dedicated method is
		// required to wire up the static in the running extension host.
		globalThis.api.setTerminalProfile(PROFILE_NAME)

		// Probe whether shell integration can activate in this environment.
		// Both the probe and production code use the same timeout so the probe
		// result accurately predicts whether command execution will see SI.
		// 10 s is generous for /bin/bash --noprofile --norc, even under xvfb
		// in resource-constrained CI runners.
		previousSiTimeout = globalThis.api.getShellIntegrationTimeout()
		globalThis.api.setShellIntegrationTimeout(10_000)

		const probeTerminal = vscode.window.createTerminal({
			name: "Zoo Code",
			cwd: testDir,
			shellPath: "/bin/bash",
			shellArgs: PROFILE_SHELL_ARGS,
		})

		shellIntegrationWorks = await new Promise<boolean>((resolve) => {
			const timeout = setTimeout(() => {
				disposable.dispose()
				resolve(false)
			}, globalThis.api.getShellIntegrationTimeout())
			const disposable = vscode.window.onDidChangeTerminalShellIntegration((e) => {
				if (e.terminal === probeTerminal && probeTerminal.shellIntegration) {
					clearTimeout(timeout)
					disposable.dispose()
					resolve(true)
				}
			})
		})

		probeTerminal.dispose()
	})

	suiteTeardown(async () => {
		try {
			await globalThis.api.cancelCurrentTask()
		} catch {
			// task may not be running
		}

		// Always restore — order matters: clear profile first so any subsequent
		// terminal creation uses the default, then restore VS Code settings.
		globalThis.api.setTerminalProfile(undefined)

		if (profilesSaved) {
			await vscode.workspace
				.getConfiguration("terminal.integrated.profiles")
				.update("linux", originalProfiles, vscode.ConfigurationTarget.Global)
		}

		await fs.rm(testDir, { recursive: true, force: true })
		globalThis.api.setShellIntegrationTimeout(previousSiTimeout)

		const aimockUrl = process.env.AIMOCK_URL
		const isRecord = process.env.AIMOCK_RECORD === "true"
		await globalThis.api.setConfiguration({
			apiProvider: "openrouter" as const,
			openRouterApiKey: aimockUrl && !isRecord ? "mock-key" : process.env.OPENROUTER_API_KEY!,
			openRouterModelId: "openai/gpt-4.1",
			...(aimockUrl && { openRouterBaseUrl: `${aimockUrl}/v1` }),
		})
	})

	setup(async () => {
		try {
			await globalThis.api.cancelCurrentTask()
		} catch {
			// task may not be running
		}

		await fs.rm(path.join(testDir, OVERRIDE_FILE), { force: true })
		await fs.rm(path.join(testDir, DEFAULT_FILE), { force: true })
		await sleep(100)
	})

	teardown(async () => {
		try {
			await globalThis.api.cancelCurrentTask()
		} catch {
			// task may not be running
		}

		await sleep(100)
	})

	// ── Functional tests (all environments) ──────────────────────────

	test("executes command through profile override", async function () {
		const api = globalThis.api

		const result = await runProfileTask(
			api,
			"TERMINAL_PROFILE_E2E_OVERRIDE",
			OVERRIDE_FILE,
			"zoo-profile-override-ok",
			testDir,
		)

		assert.strictEqual(result.gotError, false, `Unexpected error: ${result.errorText}`)
		assert.ok(result.gotMarker, `Output file should contain marker, got: ${result.outputContent}`)

		if (result.gotWarning) {
			console.warn(
				"shell_integration_warning fired — shell startup race occurred, execa fallback used",
				result.warningText,
			)
		}

		// Verify the terminal was created with the configured profile.
		assert.ok(vscode.window.terminals.length >= 1, "At least one VS Code terminal should exist")
		const profileTerminal = vscode.window.terminals.find((terminal) => {
			const options = terminal.creationOptions as vscode.TerminalOptions
			return (
				options.name === "Zoo Code" &&
				options.shellPath === "/bin/bash" &&
				Array.isArray(options.shellArgs) &&
				options.shellArgs.includes("--noprofile") &&
				options.shellArgs.includes("--norc")
			)
		})
		assert.ok(profileTerminal, "Expected a Zoo Code terminal created with the configured Bash profile")
	})

	test("starts a fresh terminal after clearing the profile override", async function () {
		const api = globalThis.api

		// Clear the override — this also calls TerminalRegistry.closeIdleTerminals()
		// so the terminal from test 1 is disposed before this task runs.
		api.setTerminalProfile(undefined)
		await sleep(200) // let VS Code process the disposal

		const result = await runProfileTask(
			api,
			"TERMINAL_PROFILE_E2E_DEFAULT",
			DEFAULT_FILE,
			"zoo-profile-default-ok",
			testDir,
		)

		assert.strictEqual(result.gotError, false, `Unexpected error: ${result.errorText}`)
		assert.ok(result.gotMarker, `Output file should contain marker, got: ${result.outputContent}`)

		if (result.gotWarning) {
			console.warn("shell_integration_warning (non-fatal, transient):", result.warningText)
		}
	})

	// ── Shell integration regression guard ───────────────────────────
	//
	// Runs only when the suiteSetup capability probe confirmed that
	// shell integration can activate in this environment.  When SI is
	// unavailable (e.g. slow CI runner, misconfigured shell), the guard
	// is skipped — the functional tests still verify fallback behaviour.

	suite("Shell integration regression guard", function () {
		suiteSetup(function () {
			if (!shellIntegrationWorks) {
				this.skip()
			}
		})

		setup(async () => {
			// Re-activate the profile override cleared by test 2
			globalThis.api.setTerminalProfile(PROFILE_NAME)
		})

		test("profile override completes shell integration before first command", async function () {
			const api = globalThis.api

			let warningCount = 0
			const attempts = 2

			for (let i = 0; i < attempts; i++) {
				await fs.rm(path.join(testDir, OVERRIDE_FILE), { force: true })

				const result = await runProfileTask(
					api,
					"TERMINAL_PROFILE_E2E_OVERRIDE",
					OVERRIDE_FILE,
					"zoo-profile-override-ok",
					testDir,
				)

				assert.strictEqual(
					result.gotError,
					false,
					`Unexpected error on attempt ${i + 1}/${attempts}: ${result.errorText}`,
				)
				assert.ok(
					result.gotMarker,
					`Output file should contain marker on attempt ${i + 1}/${attempts}, got: ${result.outputContent}`,
				)

				if (result.gotWarning) {
					warningCount++
					console.warn(
						`shell_integration_warning on attempt ${i + 1}/${attempts} — shell startup race, execa fallback used`,
						result.warningText,
					)
				}

				if (!result.gotWarning) {
					break // one clean run proves shell integration is not systemically broken
				}
			}

			// Soft assertion: a single transient warning is tolerated
			// (environment-dependent shell startup race), but warnings
			// on EVERY attempt indicate a systemic regression where
			// shell integration never completes before the first command.
			assert.ok(
				warningCount < attempts,
				`shell_integration_warning fired on ALL ${attempts} attempts — possible regression in shell integration`,
			)
		})
	})
})
