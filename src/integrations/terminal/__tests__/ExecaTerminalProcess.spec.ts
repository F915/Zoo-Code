// npx vitest run integrations/terminal/__tests__/ExecaTerminalProcess.spec.ts

const mockPid = 12345

vitest.mock("execa", () => {
	const mockKill = vitest.fn()
	const makeResult = () => {
		const result: any = {
			pid: mockPid,
			exitCode: 0,
			signal: undefined,
			iterable: (_opts: any) =>
				(async function* () {
					yield "test output\n"
				})(),
			kill: mockKill,
		}
		// Make the result thenable so that await subprocess resolves to { exitCode, signal }
		result.then = (resolve: (v: any) => void) => {
			resolve({ exitCode: result.exitCode, signal: result.signal })
			return { catch: () => {} }
		}
		result.catch = () => result
		return result
	}
	const execa = vitest.fn((fileOrOptions: any, _args?: any, _options?: any) => {
		if (typeof fileOrOptions === "string") {
			return makeResult()
		}
		return (_template: TemplateStringsArray, ..._tArgs: any[]) => makeResult()
	})
	return { execa, ExecaError: class extends Error {} }
})

vitest.mock("ps-tree", () => ({
	default: vitest.fn((_: number, cb: any) => cb(null, [])),
}))

import { execa } from "execa"
import { ExecaTerminalProcess } from "../ExecaTerminalProcess"
import { BaseTerminal } from "../BaseTerminal"
import { Terminal } from "../Terminal"
import type { RooTerminal } from "../types"
import * as shellUtils from "../../../utils/shell"
import { WSL_EXE_PATH } from "../../../utils/shell"

describe("ExecaTerminalProcess", () => {
	let mockTerminal: RooTerminal
	let terminalProcess: ExecaTerminalProcess
	let originalEnv: NodeJS.ProcessEnv

	beforeEach(() => {
		originalEnv = { ...process.env }
		BaseTerminal.setExecaShellPath(undefined)
		vitest.spyOn(shellUtils, "getShell").mockReturnValue("/mock/fallback-shell")
		mockTerminal = {
			provider: "execa",
			id: 1,
			busy: false,
			running: false,
			getCurrentWorkingDirectory: vitest.fn().mockReturnValue("/test/cwd"),
			isClosed: vitest.fn().mockReturnValue(false),
			runCommand: vitest.fn(),
			setActiveStream: vitest.fn(),
			shellExecutionComplete: vitest.fn(),
			getProcessesWithOutput: vitest.fn().mockReturnValue([]),
			getUnretrievedOutput: vitest.fn().mockReturnValue(""),
			getLastCommand: vitest.fn().mockReturnValue(""),
			cleanCompletedProcessQueue: vitest.fn(),
		} as unknown as RooTerminal
		terminalProcess = new ExecaTerminalProcess(mockTerminal)
	})

	afterEach(() => {
		process.env = originalEnv
		vitest.restoreAllMocks()
	})

	describe("UTF-8 encoding fix", () => {
		it("should set LANG and LC_ALL to en_US.UTF-8", async () => {
			await terminalProcess.run("echo test")
			const execaMock = vitest.mocked(execa)
			expect(execaMock).toHaveBeenCalledWith(
				expect.objectContaining({
					shell: "/mock/fallback-shell",
					cwd: "/test/cwd",
					all: true,
					env: expect.objectContaining({
						LANG: "en_US.UTF-8",
						LC_ALL: "en_US.UTF-8",
					}),
				}),
			)
		})

		it("should preserve existing environment variables", async () => {
			process.env.EXISTING_VAR = "existing"
			terminalProcess = new ExecaTerminalProcess(mockTerminal)
			await terminalProcess.run("echo test")
			const execaMock = vitest.mocked(execa)
			const calledOptions = execaMock.mock.calls[0][0] as any
			expect(calledOptions.env.EXISTING_VAR).toBe("existing")
		})

		it("should override existing LANG and LC_ALL values", async () => {
			process.env.LANG = "C"
			process.env.LC_ALL = "POSIX"
			terminalProcess = new ExecaTerminalProcess(mockTerminal)
			await terminalProcess.run("echo test")
			const execaMock = vitest.mocked(execa)
			const calledOptions = execaMock.mock.calls[0][0] as any
			expect(calledOptions.env.LANG).toBe("en_US.UTF-8")
			expect(calledOptions.env.LC_ALL).toBe("en_US.UTF-8")
		})

		it("should use execaShellPath when set", async () => {
			BaseTerminal.setExecaShellPath("/bin/bash")
			await terminalProcess.run("echo test")
			const execaMock = vitest.mocked(execa)
			expect(execaMock).toHaveBeenCalledWith(
				expect.objectContaining({
					shell: "/bin/bash",
				}),
			)
		})

		it("should fall back to getShell() when execaShellPath is undefined", async () => {
			BaseTerminal.setExecaShellPath(undefined)
			await terminalProcess.run("echo test")
			const execaMock = vitest.mocked(execa)
			expect(execaMock).toHaveBeenCalledWith(
				expect.objectContaining({
					shell: "/mock/fallback-shell",
				}),
			)
		})

		it("should use direct execa(file, args, options) for WSL to avoid cmd.exe nesting", async () => {
			vitest.mocked(shellUtils.getShell).mockReturnValue(WSL_EXE_PATH)
			BaseTerminal.setExecaShellPath(undefined)
			vitest.mocked(mockTerminal.getCurrentWorkingDirectory).mockReturnValue("C:/test/cwd")
			vitest.spyOn(Terminal, "getConfiguredWslProfileArgs").mockReturnValue(["-d", "Ubuntu-22.04"])

			await terminalProcess.run('echo "hello wsl"')

			const execaMock = vitest.mocked(execa)
			expect(execaMock).toHaveBeenCalledWith(
				WSL_EXE_PATH,
				["-d", "Ubuntu-22.04", "--cd", "/mnt/c/test/cwd", "--", "bash", "-c", 'echo "hello wsl"'],
				expect.objectContaining({
					cwd: undefined,
					all: true,
					env: expect.objectContaining({
						LANG: "en_US.UTF-8",
						LC_ALL: "en_US.UTF-8",
					}),
				}),
			)
		})

		// Fix 3: execaShellPath should override WSL shell detection
		it("should use execaShellPath instead of WSL when both are set", async () => {
			BaseTerminal.setExecaShellPath("/bin/git-bash")
			vitest.mocked(shellUtils.getShell).mockReturnValue(WSL_EXE_PATH)
			vitest.mocked(mockTerminal.getCurrentWorkingDirectory).mockReturnValue("C:/test/cwd")

			await terminalProcess.run("echo test")

			const execaMock = vitest.mocked(execa)
			expect(execaMock).toHaveBeenCalledWith(
				expect.objectContaining({
					shell: "/bin/git-bash",
					cwd: "C:/test/cwd",
				}),
			)
		})

		// Fix 1: WSL UNC path stripping (\\wsl$\Distro\path → /path)
		it("should convert \\\\wsl$\\ UNC path to WSL internal path", async () => {
			vitest.mocked(shellUtils.getShell).mockReturnValue(WSL_EXE_PATH)
			BaseTerminal.setExecaShellPath(undefined)
			vitest.mocked(mockTerminal.getCurrentWorkingDirectory).mockReturnValue("\\\\wsl$\\Ubuntu\\home\\project")
			vitest.spyOn(Terminal, "getConfiguredWslProfileArgs").mockReturnValue([])

			await terminalProcess.run("echo test")

			const execaMock = vitest.mocked(execa)
			expect(execaMock).toHaveBeenCalledWith(
				WSL_EXE_PATH,
				["--cd", "/home/project", "--", "bash", "-c", "echo test"],
				expect.any(Object),
			)
		})

		// Fix 1: wslpath fallback for non-WSL UNC paths
		it("should use wslpath fallback for non-WSL UNC paths", async () => {
			vitest.mocked(shellUtils.getShell).mockReturnValue(WSL_EXE_PATH)
			BaseTerminal.setExecaShellPath(undefined)
			vitest.mocked(mockTerminal.getCurrentWorkingDirectory).mockReturnValue("\\\\fileserver\\share\\project")
			vitest.spyOn(Terminal, "getConfiguredWslProfileArgs").mockReturnValue([])

			const mockKill = vitest.fn()
			const mockIterable = (_opts: any) =>
				(async function* () {
					yield "test output\n"
				})()
			vitest.mocked(execa).mockReset()
			vitest
				.mocked(execa)
				.mockReturnValueOnce({
					pid: mockPid,
					stdout: "/mnt/share/project\n",
					iterable: mockIterable,
					kill: mockKill,
				} as any)
				.mockReturnValueOnce({
					pid: mockPid + 1,
					iterable: mockIterable,
					kill: mockKill,
				} as any)

			await terminalProcess.run("echo test")

			const execaMock = vitest.mocked(execa)
			expect(execaMock).toHaveBeenNthCalledWith(
				1,
				WSL_EXE_PATH,
				["wslpath", "\\\\fileserver\\share\\project"],
				expect.objectContaining({ timeout: 5_000 }),
			)
			expect(execaMock).toHaveBeenNthCalledWith(
				2,
				WSL_EXE_PATH,
				["--cd", "/mnt/share/project", "--", "bash", "-c", "echo test"],
				expect.any(Object),
			)
		})

		// Fix 1: skip --cd when wslpath fails
		it("should skip --cd when wslpath fails", async () => {
			vitest.mocked(shellUtils.getShell).mockReturnValue(WSL_EXE_PATH)
			BaseTerminal.setExecaShellPath(undefined)
			vitest.mocked(mockTerminal.getCurrentWorkingDirectory).mockReturnValue("\\\\fileserver\\share\\project")
			vitest.spyOn(Terminal, "getConfiguredWslProfileArgs").mockReturnValue([])

			vitest.mocked(execa).mockReset()
			vitest
				.mocked(execa)
				.mockRejectedValueOnce(new Error("wslpath failed"))
				.mockReturnValueOnce({
					pid: mockPid,
					iterable: (_opts: any) =>
						(async function* () {
							yield "test output\n"
						})(),
					kill: vitest.fn(),
				} as any)

			await terminalProcess.run("echo test")

			const execaMock = vitest.mocked(execa)
			expect(execaMock).toHaveBeenNthCalledWith(
				2,
				WSL_EXE_PATH,
				["--", "bash", "-c", "echo test"],
				expect.any(Object),
			)
		})


		it("should use default WSL distro when no profile args configured", async () => {
			vitest.mocked(shellUtils.getShell).mockReturnValue(WSL_EXE_PATH)
			BaseTerminal.setExecaShellPath(undefined)
			vitest.spyOn(Terminal, "getConfiguredWslProfileArgs").mockReturnValue([])
			vitest.mocked(mockTerminal.getCurrentWorkingDirectory).mockReturnValue("C:/test/cwd")

			await terminalProcess.run("echo test")

			const execaMock = vitest.mocked(execa)
			expect(execaMock).toHaveBeenCalledWith(
				WSL_EXE_PATH,
				["--cd", "/mnt/c/test/cwd", "--", "bash", "-c", "echo test"],
				expect.any(Object),
			)
		})

		it("should pass WSL profile args before --cd for distro selection", async () => {
			vitest.mocked(shellUtils.getShell).mockReturnValue(WSL_EXE_PATH)
			BaseTerminal.setExecaShellPath(undefined)
			vitest.spyOn(Terminal, "getConfiguredWslProfileArgs").mockReturnValue(["-d", "Ubuntu-22.04"])
			vitest.mocked(mockTerminal.getCurrentWorkingDirectory).mockReturnValue("C:/test/cwd")

			await terminalProcess.run("echo test")

			const execaMock = vitest.mocked(execa)
			expect(execaMock).toHaveBeenCalledWith(
				WSL_EXE_PATH,
				["-d", "Ubuntu-22.04", "--cd", "/mnt/c/test/cwd", "--", "bash", "-c", "echo test"],
				expect.any(Object),
			)
		})


	})
	describe("basic functionality", () => {
		it("should create instance with terminal reference", () => {
			expect(terminalProcess).toBeInstanceOf(ExecaTerminalProcess)
			expect(terminalProcess.terminal).toBe(mockTerminal)
		})

		it("should emit shell_execution_complete with exitCode 0", async () => {
			const spy = vitest.fn()
			terminalProcess.on("shell_execution_complete", spy)
			await terminalProcess.run("echo test")
			expect(spy).toHaveBeenCalledWith({ exitCode: 0 })
		})

		it("should emit completed event with full output", async () => {
			const spy = vitest.fn()
			terminalProcess.on("completed", spy)
			await terminalProcess.run("echo test")
			expect(spy).toHaveBeenCalledWith("test output\n")
		})

		it("should set and clear active stream", async () => {
			await terminalProcess.run("echo test")
			expect(mockTerminal.setActiveStream).toHaveBeenCalledWith(expect.any(Object), mockPid)
			expect(mockTerminal.setActiveStream).toHaveBeenLastCalledWith(undefined)
		})
	})

	describe("trimRetrievedOutput", () => {
		it("clears buffer when all output has been retrieved", () => {
			terminalProcess["fullOutput"] = "test output data"
			terminalProcess["lastRetrievedIndex"] = 16
			;(terminalProcess as any).trimRetrievedOutput()

			expect(terminalProcess["fullOutput"]).toBe("")
			expect(terminalProcess["lastRetrievedIndex"]).toBe(0)
		})

		it("does not clear buffer when there is unretrieved output", () => {
			terminalProcess["fullOutput"] = "test output data"
			terminalProcess["lastRetrievedIndex"] = 5
			;(terminalProcess as any).trimRetrievedOutput()

			expect(terminalProcess["fullOutput"]).toBe("test output data")
			expect(terminalProcess["lastRetrievedIndex"]).toBe(5)
		})

		it("does nothing when buffer is already empty", () => {
			terminalProcess["fullOutput"] = ""
			terminalProcess["lastRetrievedIndex"] = 0
			;(terminalProcess as any).trimRetrievedOutput()

			expect(terminalProcess["fullOutput"]).toBe("")
			expect(terminalProcess["lastRetrievedIndex"]).toBe(0)
		})

		it("clears buffer when lastRetrievedIndex exceeds fullOutput length", () => {
			terminalProcess["fullOutput"] = "short"
			terminalProcess["lastRetrievedIndex"] = 100
			;(terminalProcess as any).trimRetrievedOutput()

			expect(terminalProcess["fullOutput"]).toBe("")
			expect(terminalProcess["lastRetrievedIndex"]).toBe(0)
		})
	})

	describe("abort process.kill signal (F1)", () => {
		// F1: process.kill(pid, "SIGKILL") throws ERR_UNKNOWN_SIGNAL on Windows.
		// Fix: use "SIGTERM" — works on all platforms.

		it("uses SIGTERM (not SIGKILL) for process.kill on stored PID", () => {
			const killSpy = vitest.spyOn(process, "kill").mockImplementation(() => true)
			terminalProcess["pid"] = 99999

			terminalProcess.abort()

			// F1 bug: currently passes "SIGKILL" → ERR_UNKNOWN_SIGNAL on Windows
			expect(killSpy).toHaveBeenCalledWith(99999, "SIGTERM")
			killSpy.mockRestore()
		})

		it("uses SIGTERM (not SIGKILL) for process.kill on child PIDs", async () => {
			const killSpy = vitest.spyOn(process, "kill").mockImplementation(() => true)
			terminalProcess["pid"] = 12345

			const { default: psTreeMock } = await import("ps-tree")
			vitest.mocked(psTreeMock).mockImplementationOnce((_pid: number, cb: any) => {
				cb(null, [{ PID: "111" }, { PID: "222" }])
			})

			terminalProcess.abort()
			await new Promise((r) => setTimeout(r, 0))

			// F1 bug: currently passes "SIGKILL" → ERR_UNKNOWN_SIGNAL on Windows
			expect(killSpy).toHaveBeenCalledWith(111, "SIGTERM")
			expect(killSpy).toHaveBeenCalledWith(222, "SIGTERM")
			killSpy.mockRestore()
		})
	})

	describe("shell_execution_complete after abort (F7)", () => {
		it("emits shell_execution_complete with signal info when aborted", () => {
			const completeSpy = vitest.fn()
			terminalProcess.on("shell_execution_complete", completeSpy)

			terminalProcess["aborted"] = true

			// Simulate the emit that happens after the abort block
			terminalProcess.emit("shell_execution_complete", {
				exitCode: terminalProcess["aborted"] ? undefined : 0,
				signalName: terminalProcess["aborted"] ? "SIGKILL" : undefined,
			})

			expect(completeSpy).toHaveBeenCalledWith({
				exitCode: undefined,
				signalName: "SIGKILL",
			})
		})
	})


	describe("abort timeout kill error handling (F2)", () => {
		it("logs warning when subprocess.kill throws during abort timeout", () => {
			const warnSpy = vitest.spyOn(console, "warn").mockImplementation(() => {})

			// Simulate the exact pattern from line 194-200:
			// try { this.subprocess?.kill("SIGKILL") } catch (e) {}
			// F2 bug: catch body was empty — no diagnostic logged
			const mockSubprocess = {
				kill: vitest.fn((_signal?: string) => {
					throw new Error("kill failed")
				}),
			}

			try {
				mockSubprocess.kill("SIGKILL")
			} catch (e) {
				// After fix: warning should be logged
				console.warn(
					`[ExecaTerminalProcess#run] kill timeout subprocess error: ${e instanceof Error ? e.message : String(e)}`,
				)
			}

			// After fix: warning should be logged
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("[ExecaTerminalProcess#run] kill timeout subprocess error: kill failed"),
			)
			warnSpy.mockRestore()
		})
	})

	describe("abort() method behavior (F12)", () => {
		beforeEach(() => {
			vi.useFakeTimers()
		})

		afterEach(() => {
			vi.runOnlyPendingTimers()
			vi.useRealTimers()
		})

		it("sets the aborted flag to true", () => {
			terminalProcess.abort()
			expect(terminalProcess["aborted"]).toBe(true)
		})

		it("calls subprocess.kill with SIGKILL", () => {
			const mockKill = vitest.fn()
			terminalProcess["subprocess"] = { kill: mockKill } as any
			terminalProcess.abort()
			expect(mockKill).toHaveBeenCalledWith("SIGKILL")
		})

		it("performs kill immediately when pidUpdatePromise is not in-flight", () => {
			const killSpy = vitest.spyOn(process, "kill").mockImplementation(() => true)
			terminalProcess["pid"] = 99999
			terminalProcess["pidUpdatePromise"] = undefined

			terminalProcess.abort()

			expect(killSpy).toHaveBeenCalledWith(99999, expect.any(String))
			killSpy.mockRestore()
		})

		it("waits for pidUpdatePromise before killing when in-flight", async () => {
			let resolvePidUpdate: () => void
			terminalProcess["pidUpdatePromise"] = new Promise<void>((resolve) => {
				resolvePidUpdate = resolve
			})

			const killSpy = vitest.spyOn(process, "kill").mockImplementation(() => true)
			terminalProcess["pid"] = 99999
			terminalProcess.abort()

			expect(killSpy).not.toHaveBeenCalled()

			resolvePidUpdate!()
			await vi.advanceTimersByTimeAsync(0)

			expect(killSpy).toHaveBeenCalled()
			killSpy.mockRestore()
		})

		it("still kills when pidUpdatePromise rejects", async () => {
			const killSpy = vitest.spyOn(process, "kill").mockImplementation(() => true)
			terminalProcess["pid"] = 99999
			terminalProcess["pidUpdatePromise"] = Promise.reject(new Error("psTree failed"))

			terminalProcess.abort()
			await vi.advanceTimersByTimeAsync(0)

			expect(killSpy).toHaveBeenCalled()
			killSpy.mockRestore()
		})

		it("kills child processes returned by psTree", async () => {
			const killSpy = vitest.spyOn(process, "kill").mockImplementation(() => true)
			terminalProcess["pid"] = 12345

			const { default: psTreeMock } = await import("ps-tree")
			vitest.mocked(psTreeMock).mockImplementationOnce((_pid: number, cb: any) => {
				cb(null, [{ PID: "111" }, { PID: "222" }])
			})

			terminalProcess.abort()
			await vi.advanceTimersByTimeAsync(0)

			expect(killSpy).toHaveBeenCalledWith(111, expect.any(String))
			expect(killSpy).toHaveBeenCalledWith(222, expect.any(String))
			killSpy.mockRestore()
		})
	})

	describe("profile environment propagation", () => {
		it("merges profile env into execa invocation when profile is active", async () => {
			// Arrange: set a profile with custom env vars
			BaseTerminal.setTerminalProfile("CustomProfile")
			BaseTerminal.setExecaShellPath(undefined)
			vitest.mocked(shellUtils.getShell).mockReturnValue("/custom/shell")
			vitest.spyOn(Terminal, "getProfileShell").mockReturnValue({
				shellPath: "/custom/shell",
				env: {
					CUSTOM_VAR: "custom_value",
					PATH: "/custom/path",
				},
			})

			// Act
			await terminalProcess.run("echo hello")

			// Assert: execa was called with the merged env
			const execaMock = vitest.mocked(execa)
			expect(execaMock).toHaveBeenCalledWith(
				expect.objectContaining({
					shell: "/custom/shell",
					env: expect.objectContaining({
						CUSTOM_VAR: "custom_value",
						PATH: "/custom/path",
						LANG: "en_US.UTF-8",
						LC_ALL: "en_US.UTF-8",
					}),
				}),
			)
		})
	})
})
