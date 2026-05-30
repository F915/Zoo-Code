import * as vscode from "vscode"

import type { RooTerminalCallbacks, RooTerminalProcessResultPromise } from "./types"
import { BaseTerminal } from "./BaseTerminal"
import { TerminalProcess } from "./TerminalProcess"
import { ShellIntegrationManager } from "./ShellIntegrationManager"
import { mergePromise } from "./mergePromise"
import { getWslProfile } from "../../utils/shell"

export class Terminal extends BaseTerminal {
	public terminal: vscode.Terminal

	public cmdCounter: number = 0

	// Promise that resolves once shell integration is ready (or times out).
	// Uses the onDidChangeTerminalShellIntegration event for instant detection
	// when shell integration activates, with a timeout as safety net.
	private shellIntegrationReady: Promise<void>

	constructor(id: number, terminal: vscode.Terminal | undefined, cwd: string) {
		super("vscode", id, cwd)

		const env = Terminal.getEnv()
		const iconPath = new vscode.ThemeIcon("rocket")

		const wslProfile = getWslProfile()

		// For WSL, do NOT pass explicit shellPath/shellArgs — let VS Code use
		// its default profile which has source:"WSL" (or auto-detects WSL via
		// the profile path). Explicitly passing shellPath bypasses the profile
		// system and prevents VS Code from injecting WSL shell integration.
		if (wslProfile) {
			this.terminal = terminal ?? vscode.window.createTerminal({ cwd, name: "Zoo Code", iconPath, env })
		} else if (BaseTerminal.getExecaShellPath()) {
			const shell = BaseTerminal.getExecaShellPath()!
			this.terminal =
				terminal ?? vscode.window.createTerminal({ cwd, name: "Zoo Code", iconPath, env, shellPath: shell })
		} else {
			this.terminal = terminal ?? vscode.window.createTerminal({ cwd, name: "Zoo Code", iconPath, env })
		}

		if (Terminal.getTerminalZdotdir()) {
			ShellIntegrationManager.terminalTmpDirs.set(id, env.ZDOTDIR)
		}

		// Wait for shell integration using both the VS Code event (instant)
		// and polling. Both run within the user-configured timeout — no hidden
		// extension. WSL terminals also follow this path: shell integration is
		// not supported for WSL (OSC 633 sequences don't traverse the PTY
		// bridge), so the timeout will fire naturally and runCommand falls
		// through to the execa fallback.
		this.shellIntegrationReady = new Promise<void>((resolve) => {
			// Already ready?
			if (this.terminal.shellIntegration) {
				resolve()
				return
			}

			const timeout = Terminal.getShellIntegrationTimeout()

			let settled = false
			const done = () => {
				if (settled) return
				settled = true
				clearTimeout(timeoutId)
				clearInterval(pollInterval)
				eventDisposable.dispose()
				resolve()
			}

			// Event-based detection: fires instantly when shell integration activates.
			// Check shellIntegration (not .executeCommand) — matching original
			// pWaitFor behavior. If we check .executeCommand, a brief window between
			// shellIntegration being set and executeCommand being ready would cause us
			// to miss the activation entirely (no more events fire, only timeout).
			const eventDisposable = vscode.window.onDidChangeTerminalShellIntegration((e) => {
				if (e.terminal === this.terminal && this.terminal.shellIntegration) {
					done()
				}
			})

			// Polling fallback: same loose check as original pWaitFor so that
			// non-WSL shells (Git Bash, pwsh) correctly detect shell integration
			// activation even when events fire out of order.
			const pollInterval = setInterval(() => {
				if (this.terminal.shellIntegration) {
					done()
				}
			}, 500)

			// Safety-net timeout: if shell integration never activates within the
			// configured time (e.g. WSL), resolve anyway.
			const timeoutId = setTimeout(() => done(), timeout)
		})

		// Clean up ZDOTDIR temp directory once shell integration is ready
		// (or on timeout). Covers all shell types including WSL.
		this.shellIntegrationReady.finally(() => {
			ShellIntegrationManager.zshCleanupTmpDir(this.id)
		})
	}

	/**
	 * Gets the current working directory from shell integration or falls back to initial cwd.
	 * @returns The current working directory
	 */
	public override getCurrentWorkingDirectory(): string {
		return this.terminal.shellIntegration?.cwd ? this.terminal.shellIntegration.cwd.fsPath : this.initialCwd
	}

	/**
	 * The exit status of the terminal will be undefined while the terminal is
	 * active. (This value is set when onDidCloseTerminal is fired.)
	 */
	public override isClosed(): boolean {
		return this.terminal.exitStatus !== undefined
	}

	public override runCommand(command: string, callbacks: RooTerminalCallbacks): RooTerminalProcessResultPromise {
		// We set busy before the command is running because the terminal may be
		// waiting on terminal integration, and we must prevent another instance
		// from selecting the terminal for use during that time.
		this.busy = true

		const process = new TerminalProcess(this)
		process.command = command
		this.process = process

		// Set up event handlers from callbacks before starting process.
		// This ensures that we don't miss any events because they are
		// configured before the process starts.
		process.on("line", (line) => callbacks.onLine(line, process))
		process.once("completed", (output) => callbacks.onCompleted(output, process))
		process.once("shell_execution_started", (pid) => callbacks.onShellExecutionStarted(pid, process))
		process.once("shell_execution_complete", (details) => callbacks.onShellExecutionComplete(details, process))
		process.once("no_shell_integration", (msg) => callbacks.onNoShellIntegration?.(msg, process))

		const promise = new Promise<void>((resolve, reject) => {
			process.once("continue", () => resolve())
			process.once("error", (error) => {
				console.error(`[Terminal ${this.id}] error:`, error)
				reject(error)
			})

			// Reuse the shell-integration-ready promise started in the
			// constructor — the wait has already been running since
			// terminal creation, so by now it may already be resolved.
			this.shellIntegrationReady.then(() => {
				process.run(command)
			})
		})

		return mergePromise(process, promise)
	}

	/**
	 * Gets the terminal contents based on the number of commands to include
	 * @param commands Number of previous commands to include (-1 for all)
	 * @returns The selected terminal contents
	 */
	public static async getTerminalContents(commands = -1): Promise<string> {
		// Save current clipboard content
		const tempCopyBuffer = await vscode.env.clipboard.readText()

		try {
			// Select terminal content
			if (commands < 0) {
				await vscode.commands.executeCommand("workbench.action.terminal.selectAll")
			} else {
				for (let i = 0; i < commands; i++) {
					await vscode.commands.executeCommand("workbench.action.terminal.selectToPreviousCommand")
				}
			}

			// Copy selection and clear it
			await vscode.commands.executeCommand("workbench.action.terminal.copySelection")
			await vscode.commands.executeCommand("workbench.action.terminal.clearSelection")

			// Get copied content
			let terminalContents = (await vscode.env.clipboard.readText()).trim()

			// Restore original clipboard content
			await vscode.env.clipboard.writeText(tempCopyBuffer)

			if (tempCopyBuffer === terminalContents) {
				// No terminal content was copied
				return ""
			}

			// Process multi-line content
			const lines = terminalContents.split("\n")
			const lastLine = lines.pop()?.trim()

			if (lastLine) {
				let i = lines.length - 1

				while (i >= 0 && !lines[i].trim().startsWith(lastLine)) {
					i--
				}

				terminalContents = lines.slice(Math.max(i, 0)).join("\n")
			}

			return terminalContents
		} catch (error) {
			// Ensure clipboard is restored even if an error occurs
			await vscode.env.clipboard.writeText(tempCopyBuffer)
			throw error
		}
	}

	public static getEnv(): Record<string, string> {
		const env: Record<string, string> = {
			ROO_ACTIVE: "true",
			PAGER: process.platform === "win32" ? "" : "cat",

			// VTE must be disabled because it prevents the prompt command from executing
			// See https://wiki.gnome.org/Apps/Terminal/VTE
			VTE_VERSION: "0",
		}

		// Set Oh My Zsh shell integration if enabled
		if (Terminal.getTerminalZshOhMy()) {
			env.ITERM_SHELL_INTEGRATION_INSTALLED = "Yes"
		}

		// Set Powerlevel10k shell integration if enabled
		if (Terminal.getTerminalZshP10k()) {
			env.POWERLEVEL9K_TERM_SHELL_INTEGRATION = "true"
		}

		// VSCode bug#237208: Command output can be lost due to a race between completion
		// sequences and consumers. Add delay via PROMPT_COMMAND to ensure the
		// \x1b]633;D escape sequence arrives after command output is processed.
		// Only add this if commandDelay is not zero
		if (Terminal.getCommandDelay() > 0) {
			env.PROMPT_COMMAND = `sleep ${Terminal.getCommandDelay() / 1000}`
		}

		// Clear the ZSH EOL mark to prevent issues with command output interpretation
		// when output ends with special characters like '%'
		if (Terminal.getTerminalZshClearEolMark()) {
			env.PROMPT_EOL_MARK = ""
		}

		// Handle ZDOTDIR for zsh if enabled
		if (Terminal.getTerminalZdotdir()) {
			env.ZDOTDIR = ShellIntegrationManager.zshInitTmpDir(env)
		}

		return env
	}
}
