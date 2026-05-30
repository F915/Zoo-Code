import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import { userInfo } from "os"
import { getShell, getWslProfile, WSL_EXE_PATH } from "../shell"

vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(),
	},
	env: {
		shell: "",
	},
}))

vi.mock("os", () => ({
	userInfo: vi.fn(() => ({ shell: null })),
}))

describe("Shell Detection", () => {
	let originalPlatform: string
	let originalEnv: NodeJS.ProcessEnv

	function setVSEnvShell(path: string) {
		;(vscode.env as any).shell = path
	}

	beforeEach(() => {
		originalPlatform = process.platform
		originalEnv = { ...process.env }

		delete process.env.SHELL
		delete process.env.COMSPEC

		setVSEnvShell("")
		vi.mocked(userInfo).mockReturnValue({ shell: null } as any)
	})

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: originalPlatform })
		process.env = originalEnv
		vi.clearAllMocks()
	})

	// --------------------------------------------------------------------------
	// vscode.env.shell — primary data source
	// --------------------------------------------------------------------------
	describe("vscode.env.shell passthrough", () => {
		it("returns the shell from vscode.env.shell on Windows", () => {
			Object.defineProperty(process, "platform", { value: "win32" })
			setVSEnvShell("C:\\Program Files\\PowerShell\\7\\pwsh.exe")
			expect(getShell()).toBe("C:\\Program Files\\PowerShell\\7\\pwsh.exe")
		})

		it("returns the shell from vscode.env.shell on macOS", () => {
			Object.defineProperty(process, "platform", { value: "darwin" })
			setVSEnvShell("/usr/local/bin/fish")
			expect(getShell()).toBe("/usr/local/bin/fish")
		})

		it("returns the shell from vscode.env.shell on Linux", () => {
			Object.defineProperty(process, "platform", { value: "linux" })
			setVSEnvShell("/usr/bin/fish")
			expect(getShell()).toBe("/usr/bin/fish")
		})

		it("trusts non-standard shell paths (winget / Scoop / Homebrew)", () => {
			setVSEnvShell("C:\\Users\\user\\scoop\\apps\\pwsh\\current\\pwsh.exe")
			expect(getShell()).toBe("C:\\Users\\user\\scoop\\apps\\pwsh\\current\\pwsh.exe")
		})

		it("canonicalizes WSL paths", () => {
			setVSEnvShell("C:\\Windows\\System32\\wsl.exe")
			expect(getShell()).toBe(WSL_EXE_PATH)
		})

		it("canonicalizes differently-cased WSL paths", () => {
			setVSEnvShell("C:\\Windows\\system32\\WSL.EXE")
			expect(getShell()).toBe(WSL_EXE_PATH)
		})

		it("does not canonicalize non-WSL paths that resemble WSL", () => {
			setVSEnvShell("/usr/bin/wsl")
			expect(getShell()).toBe("/usr/bin/wsl")
		})
	})

	// --------------------------------------------------------------------------
	// Fallback chain — Windows
	// --------------------------------------------------------------------------
	describe("Fallback chain — Windows", () => {
		beforeEach(() => {
			Object.defineProperty(process, "platform", { value: "win32" })
		})

		it("falls back to userInfo() when vscode.env.shell is empty", () => {
			vi.mocked(userInfo).mockReturnValue({ shell: "C:\\Program Files\\Git\\bin\\bash.exe" } as any)
			expect(getShell()).toBe("C:\\Program Files\\Git\\bin\\bash.exe")
		})

		it("falls back to COMSPEC when userInfo is unavailable", () => {
			process.env.COMSPEC = "C:\\Windows\\System32\\cmd.exe"
			expect(getShell()).toBe("C:\\Windows\\System32\\cmd.exe")
		})

		it("falls back to cmd.exe default when nothing is available", () => {
			expect(getShell()).toBe("C:\\Windows\\System32\\cmd.exe")
		})
	})

	// --------------------------------------------------------------------------
	// Fallback chain — macOS
	// --------------------------------------------------------------------------
	describe("Fallback chain — macOS", () => {
		beforeEach(() => {
			Object.defineProperty(process, "platform", { value: "darwin" })
		})

		it("falls back to userInfo().shell", () => {
			vi.mocked(userInfo).mockReturnValue({ shell: "/opt/homebrew/bin/zsh" } as any)
			expect(getShell()).toBe("/opt/homebrew/bin/zsh")
		})

		it("falls back to SHELL env var", () => {
			process.env.SHELL = "/usr/local/bin/zsh"
			expect(getShell()).toBe("/usr/local/bin/zsh")
		})

		it("falls back to /bin/zsh when nothing is available", () => {
			expect(getShell()).toBe("/bin/zsh")
		})
	})

	// --------------------------------------------------------------------------
	// Fallback chain — Linux
	// --------------------------------------------------------------------------
	describe("Fallback chain — Linux", () => {
		beforeEach(() => {
			Object.defineProperty(process, "platform", { value: "linux" })
		})

		it("falls back to userInfo().shell", () => {
			vi.mocked(userInfo).mockReturnValue({ shell: "/usr/bin/zsh" } as any)
			expect(getShell()).toBe("/usr/bin/zsh")
		})

		it("falls back to SHELL env var", () => {
			process.env.SHELL = "/usr/bin/fish"
			expect(getShell()).toBe("/usr/bin/fish")
		})

		it("falls back to /bin/bash when nothing is available", () => {
			expect(getShell()).toBe("/bin/bash")
		})
	})

	// --------------------------------------------------------------------------
	// Error handling
	// --------------------------------------------------------------------------
	describe("Error handling", () => {
		it("returns /bin/bash for unknown platforms", () => {
			Object.defineProperty(process, "platform", { value: "sunos" })
			expect(getShell()).toBe("/bin/bash")
		})

		it("handles userInfo errors, falling back to env var", () => {
			Object.defineProperty(process, "platform", { value: "darwin" })
			vi.mocked(userInfo).mockImplementation(() => {
				throw new Error("userInfo error")
			})
			process.env.SHELL = "/bin/zsh"
			expect(getShell()).toBe("/bin/zsh")
		})

		it("falls back to platform default when everything errors", () => {
			Object.defineProperty(process, "platform", { value: "linux" })
			vi.mocked(userInfo).mockImplementation(() => {
				throw new Error("userInfo error")
			})
			delete process.env.SHELL
			expect(getShell()).toBe("/bin/bash")
		})
	})
	// --------------------------------------------------------------------------
	// Priority: vscode.env.shell beats all fallbacks
	// --------------------------------------------------------------------------
	describe("Priority: vscode.env.shell beats all fallbacks", () => {
		it("ignores userInfo().shell when vscode.env.shell is set", () => {
			setVSEnvShell("/usr/local/bin/fish")
			vi.mocked(userInfo).mockReturnValue({ shell: "/bin/zsh" } as any)
			expect(getShell()).toBe("/usr/local/bin/fish")
		})

		it("ignores SHELL/COMSPEC env var when vscode.env.shell is set", () => {
			setVSEnvShell("/opt/homebrew/bin/zsh")
			process.env.SHELL = "/bin/bash"
			expect(getShell()).toBe("/opt/homebrew/bin/zsh")
		})
	})

	// --------------------------------------------------------------------------
	// getWslProfile (preserved — needs VS Code config, not vscode.env.shell)
	// --------------------------------------------------------------------------
	describe("getWslProfile()", () => {
		beforeEach(() => {
			Object.defineProperty(process, "platform", { value: "win32" })
		})

		it("returns null on non-Windows platforms", () => {
			Object.defineProperty(process, "platform", { value: "darwin" })
			expect(getWslProfile()).toBeNull()
		})

		it("detects WSL by source field", () => {
			vscode.workspace.getConfiguration = () =>
				({
					get: (key: string) => {
						if (key === "defaultProfile.windows") return "Ubuntu"
						if (key === "profiles.windows") return { Ubuntu: { source: "WSL" } }
						return undefined
					},
				}) as any

			const result = getWslProfile()
			expect(result).not.toBeNull()
			expect(result!.path).toBe(WSL_EXE_PATH)
			expect(result!.args).toEqual([])
		})

		it("detects WSL by profile name pattern", () => {
			vscode.workspace.getConfiguration = () =>
				({
					get: (key: string) => {
						if (key === "defaultProfile.windows") return "Ubuntu WSL"
						if (key === "profiles.windows") return { "Ubuntu WSL": {} }
						return undefined
					},
				}) as any

			expect(getWslProfile()).not.toBeNull()
		})

		it("returns null for non-WSL profiles", () => {
			vscode.workspace.getConfiguration = () =>
				({
					get: (key: string) => {
						if (key === "defaultProfile.windows") return "PowerShell"
						if (key === "profiles.windows") return { PowerShell: { source: "PowerShell" } }
						return undefined
					},
				}) as any

			expect(getWslProfile()).toBeNull()
		})

		it("returns null when no default profile is set", () => {
			vscode.workspace.getConfiguration = () =>
				({
					get: () => undefined,
				}) as any

			expect(getWslProfile()).toBeNull()
		})
	})
})
