// npx vitest run src/integrations/terminal/__tests__/Terminal.spec.ts

import * as vscode from "vscode"

import { BaseTerminal } from "../BaseTerminal"
import { Terminal } from "../Terminal"
import { ShellIntegrationManager } from "../ShellIntegrationManager"
import * as shellUtils from "../../../utils/shell"

/** Builds a realistic vscode.Terminal stub. */
function makeTerminal(overrides: Partial<vscode.Terminal> = {}): vscode.Terminal {
	return {
		shellIntegration: undefined as any,
		name: "Zoo Code",
		processId: Promise.resolve(123),
		creationOptions: {},
		exitStatus: undefined,
		state: { isInteractedWith: true } as vscode.TerminalState,
		dispose: vi.fn(),
		hide: vi.fn(),
		show: vi.fn(),
		sendText: vi.fn(),
		...overrides,
	} as unknown as vscode.Terminal
}

describe("Terminal", () => {
	let shellIntegrationCbs: Array<(e: any) => void>

	beforeEach(() => {
		shellIntegrationCbs = []

		// Intercept onDidChangeTerminalShellIntegration so we can fire events from tests.
		;(vscode.window as any).onDidChangeTerminalShellIntegration = (cb: any) => {
			shellIntegrationCbs.push(cb)
			return { dispose: () => {} }
		}

		// Default mocks: no WSL, no execaShellPath, no ZDOTDIR.
		vi.spyOn(shellUtils, "getWslProfile").mockReturnValue(null)
		BaseTerminal.setExecaShellPath(undefined)
		;(Terminal as any).getTerminalZdotdir = vi.fn().mockReturnValue(false)
		vi.spyOn(Terminal, "getShellIntegrationTimeout" as any).mockReturnValue(15_000)

		// Silence ZDOTDIR helpers (tested explicitly in the ZDOTDIR describe).
		vi.spyOn(ShellIntegrationManager, "zshInitTmpDir").mockReturnValue("/tmp/zoo-zdotdir")
		;(ShellIntegrationManager as any).zshCleanupTmpDir = vi.fn()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	// =====================================================================
	// Terminal creation branches
	// =====================================================================

	describe("constructor — terminal creation", () => {
		it("passes no shellPath when WSL profile is detected", () => {
			vi.mocked(shellUtils.getWslProfile).mockReturnValue({ path: "C:\\Windows\\System32\\wsl.exe", args: [] })
			const spy = vi.spyOn(vscode.window, "createTerminal" as any)

			new Terminal(1, undefined, "/home/user/project")

			expect(spy).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/home/user/project", name: "Zoo Code" }))
			expect((spy.mock.calls[0][0] as any).shellPath).toBeUndefined()
		})

		it("passes explicit shellPath when execaShellPath is set (no WSL)", () => {
			BaseTerminal.setExecaShellPath("/usr/bin/zsh")
			const spy = vi.spyOn(vscode.window, "createTerminal" as any)

			new Terminal(2, undefined, "/test/cwd")

			expect((spy.mock.calls[0][0] as any).shellPath).toBe("/usr/bin/zsh")
		})

		it("passes no shellPath when neither WSL nor execaShellPath is set", () => {
			const spy = vi.spyOn(vscode.window, "createTerminal" as any)

			new Terminal(3, undefined, "/default/cwd")

			expect((spy.mock.calls[0][0] as any).shellPath).toBeUndefined()
		})

		it("reuses the provided terminal without calling createTerminal", () => {
			const existing = makeTerminal()
			const spy = vi.spyOn(vscode.window, "createTerminal" as any)

			new Terminal(4, existing, "/reuse/cwd")

			expect(spy).not.toHaveBeenCalled()
		})
	})

	// =====================================================================
	// shellIntegrationReady — already ready
	// =====================================================================

	describe("constructor — shellIntegrationReady (already ready)", () => {
		it("does not stall when shellIntegration is pre-set on the terminal", async () => {
			vi.useFakeTimers()

			const ready = makeTerminal({ shellIntegration: { executeCommand: vi.fn() } as any })
			const spy = vi.spyOn(vscode.window, "createTerminal" as any).mockReturnValue(ready)

			const terminal = new Terminal(5, undefined, "/test")

			const result = terminal.runCommand("echo ok", {
				onLine: vi.fn(),
				onCompleted: vi.fn(),
				onShellExecutionStarted: vi.fn(),
				onShellExecutionComplete: vi.fn(),
				onNoShellIntegration: vi.fn(),
			})

			await vi.advanceTimersByTimeAsync(15_001)
			await expect(result).resolves.toBeUndefined()

			vi.useRealTimers()
		})
	})

	// =====================================================================
	// shellIntegrationReady — event-based detection
	// =====================================================================

	describe("constructor — shellIntegrationReady (event detection)", () => {
		it("resolves when onDidChangeTerminalShellIntegration fires for this terminal", async () => {
			vi.useFakeTimers()

			const mterm = makeTerminal()
			const spy = vi.spyOn(vscode.window, "createTerminal" as any).mockReturnValue(mterm)

			new Terminal(6, undefined, "/test")

			expect(shellIntegrationCbs).toHaveLength(1)
			;(mterm as any).shellIntegration = { executeCommand: vi.fn() }
			shellIntegrationCbs[0]({ terminal: mterm })

			const t = new Terminal(7, mterm, "/test")
			const promise = t.runCommand("echo ok", {
				onLine: vi.fn(),
				onCompleted: vi.fn(),
				onShellExecutionStarted: vi.fn(),
				onShellExecutionComplete: vi.fn(),
				onNoShellIntegration: vi.fn(),
			})

			await vi.advanceTimersByTimeAsync(15_001)
			await expect(promise).resolves.toBeUndefined()

			vi.useRealTimers()
		})

		it("ignores events for a different terminal", () => {
			const thisTerm = makeTerminal()
			const otherTerm = makeTerminal({ name: "Other" })
			const spy = vi.spyOn(vscode.window, "createTerminal" as any).mockReturnValue(thisTerm)

			new Terminal(8, undefined, "/test")

			shellIntegrationCbs[0]({ terminal: otherTerm })

			expect((thisTerm as any).shellIntegration).toBeUndefined()
		})
	})

	// =====================================================================
	// shellIntegrationReady — timeout
	// =====================================================================

	describe("constructor — shellIntegrationReady (timeout)", () => {
		it("resolves after the configured timeout elapses", async () => {
			vi.useFakeTimers()

			const mterm = makeTerminal()
			const spy = vi.spyOn(vscode.window, "createTerminal" as any).mockReturnValue(mterm)

			const terminal = new Terminal(9, undefined, "/test")

			const promise = terminal.runCommand("echo ok", {
				onLine: vi.fn(),
				onCompleted: vi.fn(),
				onShellExecutionStarted: vi.fn(),
				onShellExecutionComplete: vi.fn(),
				onNoShellIntegration: vi.fn(),
			})

			await vi.advanceTimersByTimeAsync(15_001)
			await expect(promise).resolves.toBeUndefined()

			vi.useRealTimers()
		})

		it("done() guard prevents double-resolve when event fires before timeout", async () => {
			vi.useFakeTimers()

			const mterm = makeTerminal()
			const spy = vi.spyOn(vscode.window, "createTerminal" as any).mockReturnValue(mterm)

			new Terminal(10, undefined, "/test")
			;(mterm as any).shellIntegration = { executeCommand: vi.fn() }
			shellIntegrationCbs[0]({ terminal: mterm })

			await vi.advanceTimersByTimeAsync(15_001)

			// No unhandled rejection = pass
			vi.useRealTimers()
		})
	})

	// =====================================================================
	// ZDOTDIR
	// =====================================================================

	describe("constructor — ZDOTDIR", () => {
		it("initialises ZDOTDIR temp dir when getTerminalZdotdir returns true", () => {
			;(Terminal as any).getTerminalZdotdir = vi.fn().mockReturnValue(true)
			const spy = vi.spyOn(vscode.window, "createTerminal" as any)

			new Terminal(11, undefined, "/zsh-project")

			expect(ShellIntegrationManager.zshInitTmpDir).toHaveBeenCalled()
		})

		it("cleans up ZDOTDIR via shellIntegrationReady.finally after timeout", async () => {
			;(Terminal as any).getTerminalZdotdir = vi.fn().mockReturnValue(true)
			vi.useFakeTimers()

			const mterm = makeTerminal()
			const spy = vi.spyOn(vscode.window, "createTerminal" as any).mockReturnValue(mterm)

			new Terminal(12, undefined, "/zsh-project")

			await vi.advanceTimersByTimeAsync(15_001)

			expect((ShellIntegrationManager as any).zshCleanupTmpDir).toHaveBeenCalledWith(12)

			vi.useRealTimers()
		})

		it("does NOT init ZDOTDIR when getTerminalZdotdir returns false", () => {
			;(Terminal as any).getTerminalZdotdir = vi.fn().mockReturnValue(false)
			const initSpy = vi.mocked(ShellIntegrationManager.zshInitTmpDir)

			new Terminal(13, undefined, "/plain-project")

			expect(initSpy).not.toHaveBeenCalled()
		})
	})

	// =====================================================================
	// runCommand — verify shellIntegrationReady is already resolved
	// =====================================================================

	describe("runCommand", () => {
		it("proceeds without blocking when shell integration was ready at construction", async () => {
			vi.useFakeTimers()

			const ready = makeTerminal({ shellIntegration: { executeCommand: vi.fn() } as any })
			const spy = vi.spyOn(vscode.window, "createTerminal" as any).mockReturnValue(ready)

			const terminal = new Terminal(14, undefined, "/test")
			const result = terminal.runCommand("echo fast", {
				onLine: vi.fn(),
				onCompleted: vi.fn(),
				onShellExecutionStarted: vi.fn(),
				onShellExecutionComplete: vi.fn(),
				onNoShellIntegration: vi.fn(),
			})

			await vi.advanceTimersByTimeAsync(15_001)
			await expect(result).resolves.toBeUndefined()

			vi.useRealTimers()
		})
	})
})
