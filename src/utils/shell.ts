import * as vscode from "vscode"
import { existsSync } from "fs"
import { userInfo } from "os"

export const WSL_EXE_PATH = "C:\\Windows\\System32\\wsl.exe" as const

const SHELL_PATHS = {
	CMD: "C:\\Windows\\System32\\cmd.exe",
	MAC_DEFAULT: "/bin/zsh",
	LINUX_DEFAULT: "/bin/bash",
} as const

interface WindowsTerminalProfile {
	path?: string | string[]
	args?: string | string[]
	source?: "PowerShell" | "WSL"
}

type WindowsTerminalProfiles = Record<string, WindowsTerminalProfile>

// -----------------------------------------------------
// 1) WSL Profile Detection
// -----------------------------------------------------

function getWindowsTerminalConfig() {
	try {
		const config = vscode.workspace.getConfiguration("terminal.integrated")
		const defaultProfileName = config.get<string>("defaultProfile.windows")
		const profiles = config.get<WindowsTerminalProfiles>("profiles.windows") || {}
		return { defaultProfileName, profiles }
	} catch {
		return { defaultProfileName: null, profiles: {} as WindowsTerminalProfiles }
	}
}

/**
 * Returns the WSL profile path and args from the user's VS Code config, or null
 * if the default profile is not WSL.
 */
export function getWslProfile(): { path: string; args: string[] } | null {
	if (process.platform !== "win32") {
		return null
	}

	const { defaultProfileName, profiles } = getWindowsTerminalConfig()

	if (!defaultProfileName) {
		// No explicit Windows terminal profile is configured. VS Code auto-detects
		// the default on modern Windows and prefers PowerShell 7 (pwsh.exe) when it
		// is installed, otherwise the always-present Windows PowerShell 5.1. Mirror
		// that here so the system prompt advertises the real shell instead of falling
		// through to COMSPEC (cmd.exe). See issue #82.
		return existsSync(SHELL_PATHS.POWERSHELL_7) ? SHELL_PATHS.POWERSHELL_7 : SHELL_PATHS.POWERSHELL_LEGACY
	}

	const profile = profiles[defaultProfileName]
	const isWsl = profile?.source === "WSL" || /\bwsl\b/i.test(defaultProfileName)

	if (!isWsl) {
		return null
	}

	const args = normalizeShellArgs(profile?.args)

	return {
		path: WSL_EXE_PATH,
		args: args.length > 0 ? args : [],
	}
}

/** Normalizes shell args that can be a string or array of strings. */
function normalizeShellArgs(args: string | string[] | undefined): string[] {
	if (!args) return []
	if (Array.isArray(args)) return args.filter((a) => a.length > 0)
	return [args]
}

// -----------------------------------------------------
// 2) Fallback Helpers
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
// 3) Public Shell Getter
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
	if (shell.toLowerCase() === WSL_EXE_PATH.toLowerCase()) {
		return WSL_EXE_PATH
	}

	return shell
}

