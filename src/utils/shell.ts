import * as vscode from "vscode"
import { userInfo } from "os"
import { Terminal } from "../integrations/terminal/Terminal"

export const WSL_EXE_PATH = "C:\\Windows\\System32\\wsl.exe" as const

const SHELL_PATHS = {
	CMD: "C:\\Windows\\System32\\cmd.exe",
	MAC_DEFAULT: "/bin/zsh",
	LINUX_DEFAULT: "/bin/bash",
} as const

// -----------------------------------------------------
// 1) Fallback Helpers
// -----------------------------------------------------

/**
 * Tries to get a user's shell from os.userInfo() (works on Unix if the
 * underlying system call is supported). Returns null on error or if not found.
 */
function getShellFromUserInfo(): string | null {
	try {
		const { shell } = userInfo()
		return shell || null
	} catch {
		return null
	}
}

/** Returns the environment-based shell variable, or null if not set. */
function getShellFromEnv(): string | null {
	const { env } = process

	if (process.platform === "win32") {
		return env.COMSPEC || null
	}

	if (process.platform === "darwin" || process.platform === "linux") {
		return env.SHELL || null
	}

	return null
}

function getSafeFallbackShell(): string {
	if (process.platform === "win32") {
		return SHELL_PATHS.CMD
	} else if (process.platform === "darwin") {
		return SHELL_PATHS.MAC_DEFAULT
	} else {
		return SHELL_PATHS.LINUX_DEFAULT
	}
}

// -----------------------------------------------------
// 2) Public Shell Getter
// -----------------------------------------------------

/**
 * Returns the user's shell path.
 *
 * Resolution order:
 * 1. vscode.env.shell — VS Code's official shell resolution (stable since 1.37).
 *    Internally resolves terminal.integrated.defaultProfile.<platform> and
 *    terminal.integrated.profiles.<platform> — including PowerShell version
 *    deduction, WSL detection, array-path normalization, and per-platform
 *    system fallback.
 * 2. os.userInfo().shell — Unix login shell (if available).
 * 3. COMSPEC (Windows) or SHELL (Unix) environment variable.
 * 4. Platform default: cmd.exe / /bin/zsh / /bin/bash.
 *
 * Zoo Code defers entirely to VS Code for shell selection — no additional
 * allowlist or validation is applied.
 */
export function getShell(): string {
	// When the user has overridden the terminal profile in Zoo Code settings,
	// resolve it and return the actual shell path. This ensures the LLM
	// system prompt and the execa fallback path use the effective shell,
	// not just VS Code's default terminal profile (vscode.env.shell).
	const profileShell = Terminal.getProfileShell()
	if (profileShell?.shellPath) {
		// Canonicalize WSL paths so downstream === WSL_EXE_PATH comparisons
		// (ExecaTerminalProcess.ts) work correctly regardless of path casing
		// or slash direction. VS Code profile paths come from
		// resolveProfilePath() which may return non-canonical forms.
		const normalized = profileShell.shellPath.replace(/\//g, "\\")
		if (normalized.toLowerCase() === WSL_EXE_PATH.toLowerCase()) {
			return WSL_EXE_PATH
		}
		return profileShell.shellPath
	}

	let shell: string | null = vscode.env.shell || null

	if (!shell) {
		shell = getShellFromUserInfo()
	}

	if (!shell) {
		shell = getShellFromEnv()
	}

	if (!shell) {
		shell = getSafeFallbackShell()
	}

	// Canonicalize WSL paths for downstream === WSL_EXE_PATH comparisons
	// (ExecaTerminalProcess.ts). VS Code may return varying casing for
	// wsl.exe depending on how the profile was configured.
	const normalizedShell = shell.replace(/\//g, "\\")
	if (normalizedShell.toLowerCase() === WSL_EXE_PATH.toLowerCase()) {
		return WSL_EXE_PATH
	}

	return shell
}
