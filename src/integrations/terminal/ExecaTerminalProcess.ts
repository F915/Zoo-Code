import { execa, ExecaError } from "execa"
import psTree from "ps-tree"
import process from "process"

import type { RooTerminal } from "./types"
import { BaseTerminal } from "./BaseTerminal"
import { BaseTerminalProcess } from "./BaseTerminalProcess"
import { getShell, WSL_EXE_PATH } from "../../utils/shell"
import { Terminal } from "./Terminal"

// Matches \\wsl$\Distro\... and \\wsl.localhost\Distro\...
const WSL_UNC_PREFIX = /^\/\/wsl(?:\$|\.localhost)\/([^\/]+)\/?(.*)$/i

/** Timeout for wsl.exe wslpath calls — path conversion should be near-instant. */
const WSLPATH_TIMEOUT_MS = 5_000

/** Timeout for the WSL internal kill command in abort().
 *  The kill itself is near-instant (~50 ms) when the WSL VM is
 *  responsive — the command runs inside an already-running distro.
 *  This timeout exists only as a safety net for edge cases where
 *  the VM is hung. Fire-and-forget: subprocess.kill() is the
 *  fallback regardless. */
const WSL_KILL_TIMEOUT_MS = 3_000

/** Cache of Windows→WSL path conversions, keyed by (path, profileArgs).
 *  Profile args (e.g. `-d Ubuntu-22.04`) are included in the composite key
 *  so switching distros mid-session does not return a stale cached path from
 *  a different distribution with potentially different mount points.
 *  Bounded by unique (CWD × distro) combinations a user visits; no TTL
 *  needed since mount points don't change within a session. */
const wslPathCache = new Map<string, string>()

/** Clear the wslpath cache. Exported for test isolation. */
export function clearWslPathCache(): void {
	wslPathCache.clear()
}

async function convertWindowsPathToWsl(windowsPath: string, profileArgs?: string[]): Promise<string | null> {
	const forward = windowsPath.replace(/\\/g, "/")

	// Already a POSIX/WSL path — no Windows-to-WSL conversion needed.
	// This guard avoids an unnecessary wsl.exe wslpath call (≤5 s timeout)
	// for paths that don't need conversion. In production,
	// getCurrentWorkingDirectory() always returns Windows-style paths when
	// isWslShell is true, so this is a defensive measure for future callers.
	if (forward.startsWith("/") && !forward.startsWith("//")) {
		return forward
	}

	// Tier 1: Drive-letter → /mnt/<drive>/
	const driveMatch = forward.match(/^([A-Za-z]):\/(.*)/)
	if (driveMatch) {
		return `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`
	}

	// Tier 2: WSL UNC → strip prefix
	const uncMatch = forward.match(WSL_UNC_PREFIX)
	if (uncMatch) {
		const subPath = uncMatch[2] || ""
		return subPath.startsWith("/") ? subPath : `/${subPath}`
	}

	// Tier 3: Arbitrary UNC → wslpath fallback.
	// Cache results — spawning wsl.exe on every run() is unnecessary
	// when the (CWD, distro) pair doesn't change between commands.
	// Include profileArgs in the composite key so switching WSL distros
	// mid-session (e.g. Ubuntu → Debian) does not return a stale path.
	const cacheKey = profileArgs?.length ? `${windowsPath}::${profileArgs.join(",")}` : windowsPath
	const cached = wslPathCache.get(cacheKey)
	if (cached !== undefined) {
		return cached
	}

	// Pass the configured WSL distro args so wslpath runs in the correct
	// distro — the system default may have different mount points.
	try {
		const wslpathArgs = [...(profileArgs ?? []), "wslpath", windowsPath]
		const { stdout } = await execa(WSL_EXE_PATH, wslpathArgs, {
			timeout: WSLPATH_TIMEOUT_MS,
			stdin: "ignore",
		})
		const wslPath = stdout.trim()
		if (wslPath) {
			wslPathCache.set(cacheKey, wslPath)
		}
		return wslPath || null
	} catch {
		// Don't cache failures — a transient WSL issue shouldn't
		// permanently prevent path conversion for this directory.
		console.warn(`[ExecaTerminalProcess] wslpath failed for "${windowsPath}"`)
		return null
	}
}

export class ExecaTerminalProcess extends BaseTerminalProcess {
	private terminalRef: WeakRef<RooTerminal>
	private aborted = false
	private pid?: number
	private subprocess?: ReturnType<typeof execa>
	private pidUpdatePromise?: Promise<void>
	private isWslShell = false

	/** PID marker file path — written in run(), read in abort() to send
	 *  SIGKILL to the exact process group from inside WSL. */
	private wslCommandMarkerFile?: string

	/** Cached profile args (distro selection, etc.) for the abort() kill call. */
	private wslProfileArgs?: string[]

	constructor(terminal: RooTerminal) {
		super()

		this.terminalRef = new WeakRef(terminal)

		this.once("completed", () => {
			try {
				this.terminal.busy = false
			} catch {
				// Terminal has been garbage collected — nothing to clean up.
			}
		})
	}

	public get terminal(): RooTerminal {
		const terminal = this.terminalRef.deref()

		if (!terminal) {
			throw new Error("Unable to dereference terminal")
		}

		return terminal
	}

	public override async run(command: string) {
		this.command = command

		try {
			this.isHot = true

			const execaShellPath = BaseTerminal.getExecaShellPath()
			const resolvedShell = execaShellPath || getShell()

			// Resolve the profile shell for env propagation. Even in the execa fallback
			// path, profile-specific environment variables (locale, PATH, etc.) should be
			// honored. getShell() already handles the profile shell path; here we need the
			// env portion of the profile definition.
			const profileShell = execaShellPath ? undefined : Terminal.getProfileShell()

			// WSL detection only applies when the user has NOT set an explicit execa shell.
			this.isWslShell = execaShellPath ? false : resolvedShell === WSL_EXE_PATH

			if (this.isWslShell) {
				// Spawn wsl.exe directly (not through cmd.exe) to avoid nested-quoting issues.
				// execa(file, args, options) passes args as an array — no shell interpretation.
				//
				// WSL detection is two-tier:
				//   Tier 1 — getShell() via getProfileShell() (authoritative):
				//     decides whether we enter the WSL path at all
				//   Tier 2 — profile override args, falling back to VS Code default:
				//     supplements with user-configured profile args (e.g. distro selection).
				//     When a Zoo Code terminalProfile override is active, use its shellArgs
				//     directly. Otherwise fall back to the VS Code default WSL profile args.
				const profileArgs = profileShell?.shellArgs?.length
					? profileShell.shellArgs
					: (Terminal.getConfiguredWslProfileArgs() ?? [])
				const windowsCwd = this.terminal.getCurrentWorkingDirectory()
				const wslCwd = await convertWindowsPathToWsl(windowsCwd, profileArgs)

				const wslArgs: string[] = [...profileArgs]

				if (wslCwd) {
					wslArgs.push("--cd", wslCwd)
				} else {
					console.warn(
						`[ExecaTerminalProcess] Could not convert Windows path to WSL: "${windowsCwd}". ` +
							`Command will run in WSL home directory instead of expected CWD.`,
					)
				}

				// Generate a unique PID marker file for abort() to
				// send SIGKILL to the exact process group from inside WSL.
				// $$ = the bash process PID (process group leader).
				// Trailing rm -f cleans up on normal exit; abort path
				// cleans up via its own kill command.
				const markerId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
				const markerFile = `/tmp/zoo-cmd-${markerId}.pid`
				this.wslCommandMarkerFile = markerFile
				this.wslProfileArgs = profileArgs

				const wrappedCommand = `echo $$ > '${markerFile}'; ${command}; rm -f '${markerFile}'`
				wslArgs.push("--", "bash", "-c", wrappedCommand)

				this.subprocess = execa(WSL_EXE_PATH, wslArgs, {
					cwd: undefined,
					all: true,
					stdin: "ignore",
					env: {
						...process.env,
						...profileShell?.env,
						LANG: "en_US.UTF-8",
						LC_ALL: "en_US.UTF-8",
					},
				})
			} else {
				this.subprocess = execa({
					shell: resolvedShell,
					cwd: this.terminal.getCurrentWorkingDirectory(),
					all: true,
					stdin: "ignore",
					env: {
						...process.env,
						// Profile-specific environment variables (e.g. locale, custom PATH).
						// Already sanitized by getProfileShell() — dangerous keys like
						// ZDOTDIR, LD_PRELOAD are filtered.
						...profileShell?.env,
						LANG: "en_US.UTF-8",
						LC_ALL: "en_US.UTF-8",
					},
				})`${command}`
			}

			this.pid = this.subprocess.pid

			// When using shell: true, the PID is for the shell, not the actual command.
			// Find the actual command PID after a small delay. Skip under WSL — the
			// process tree inside the Linux VM is invisible to Windows psTree.
			if (this.pid && !this.isWslShell) {
				this.pidUpdatePromise = new Promise<void>((resolve) => {
					setTimeout(() => {
						psTree(this.pid!, (err, children) => {
							if (!err && children.length > 0) {
								// Update PID to the first child (the actual command)
								const actualPid = parseInt(children[0].PID)
								if (!isNaN(actualPid)) {
									this.pid = actualPid
								}
							}
							resolve()
						})
					}, 100)
				})
			}

			const rawStream = this.subprocess.iterable({ from: "all", preserveNewlines: true })

			const decoder = new TextDecoder()

			// Wrap the stream to ensure all chunks are strings.
			// A single TextDecoder with { stream: true } handles multi-byte UTF-8
			// characters split across chunk boundaries — a fresh decoder per chunk
			// would produce U+FFFD replacement characters for partial sequences.
			const stream = (async function* () {
				for await (const chunk of rawStream) {
					yield typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true })
				}
				// Flush any remaining bytes buffered in the decoder.
				// Without this call, an incomplete multi-byte UTF-8
				// sequence at the very end of the stream would be
				// silently dropped.
				const final = decoder.decode()
				if (final) {
					yield final
				}
			})()

			this.terminal.setActiveStream(stream, this.pid)

			for await (const line of stream) {
				if (this.aborted) {
					break
				}

				this.fullOutput += line

				const now = Date.now()

				if (this.isListening && (now - this.lastEmitTime_ms > 500 || this.lastEmitTime_ms === 0)) {
					this.emitRemainingBufferIfListening()
					this.lastEmitTime_ms = now
				}

				this.startHotTimer(line)
			}

			// Clear marker state — the WSL-side rm -f already ran (normal
			// exit) or the abort path consumed it. Leaving it set would cause
			// a wasted wsl.exe spawn on any post-completion abort() call.
			this.wslCommandMarkerFile = undefined
			this.wslProfileArgs = undefined

			if (this.aborted) {
				let timeoutId: NodeJS.Timeout | undefined

				const kill = new Promise<void>((resolve) => {
					console.log(`[ExecaTerminalProcess#run] SIGKILL -> ${this.pid}`)

					timeoutId = setTimeout(() => {
						try {
							this.subprocess?.kill("SIGKILL")
						} catch (e) {
							console.warn(
								`[ExecaTerminalProcess#run] kill timeout subprocess error: ${e instanceof Error ? e.message : String(e)}`,
							)
						}

						resolve()
					}, 5_000)
				})

				try {
					await Promise.race([this.subprocess, kill])
				} catch (error) {
					console.log(
						`[ExecaTerminalProcess#run] subprocess termination error: ${error instanceof Error ? error.message : String(error)}`,
					)
				}

				if (timeoutId) {
					clearTimeout(timeoutId)
				}
			}

			// Capture real exit code from the execa subprocess.
			// execa v9's iterable() does not throw on process failure — the
			// for-await loop exits cleanly regardless of exit code.  Await the
			// subprocess promise (already settled by now — the stream has
			// ended) to get the actual exitCode and signalName.
			let emitExitCode: number | undefined
			let emitSignal: string | undefined

			// Always attempt to read the real exit code.  If the subprocess already
			// settled (stream ended), this gives us the actual result.  If it hasn't
			// settled yet (abort killed it mid-stream), proceed to the abort signal path.
			try {
				const result = await this.subprocess
				emitExitCode = result.exitCode
				emitSignal = result.signal
			} catch (error) {
				if (error instanceof ExecaError) {
					emitExitCode = error.exitCode
					emitSignal = error.signal
				} else {
					// Unexpected error — re-throw to outer catch
					throw error
				}
			}

			if (this.aborted) {
				// Subprocess was signalled but may have already exited normally
				// before the abort flag was set.  Preserve the real exit code and
				// signal if available.  Only default to SIGKILL when the process
				// was killed mid-flight (no exit code available).
				if (emitSignal === undefined && emitExitCode === undefined) {
					emitSignal = "SIGKILL"
				}
			}

			this.emit("shell_execution_complete", {
				exitCode: emitExitCode,
				signalName: emitSignal,
			})
		} catch (error) {
			if (error instanceof ExecaError) {
				console.error(`[ExecaTerminalProcess#run] shell execution error: ${error.message}`)
				this.emit("shell_execution_complete", { exitCode: error.exitCode, signalName: error.signal })
			} else {
				console.error(
					`[ExecaTerminalProcess#run] shell execution error: ${error instanceof Error ? error.message : String(error)}`,
				)

				this.emit("shell_execution_complete", { exitCode: 1 })
			}
			this.subprocess = undefined
		}

		try {
			this.terminal.setActiveStream(undefined)
			this.terminal.running = false
		} catch {
			// Terminal has been garbage collected — nothing to clean up.
		}

		this.emitRemainingBufferIfListening()
		this.stopHotTimer()
		this.emit("completed", this.fullOutput)
		this.emit("continue")
		this.subprocess = undefined
	}

	public override continue() {
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	public override abort() {
		this.aborted = true

		// When running under WSL, killing wsl.exe does not guarantee
		// the Linux process terminates — wslhost.exe may take over
		// the session (WSL technical docs).  Send SIGKILL directly
		// from inside WSL to the process group identified by the
		// PID marker file.  Fire-and-forget: subprocess.kill() below
		// is the fallback.
		if (this.isWslShell && this.wslCommandMarkerFile) {
			const profileArgs = this.wslProfileArgs ?? []
			const markerFile = this.wslCommandMarkerFile

			// Single wsl.exe call: read PID → kill process group → clean up.
			// kill -9 -$PID (negative PID = process group) ensures child
			// processes are also terminated.
			const killCmd =
				`PID=$(cat '${markerFile}' 2>/dev/null) && ` +
				`[ -n "$PID" ] && kill -9 -$PID 2>/dev/null; ` +
				`rm -f '${markerFile}'`

			execa(WSL_EXE_PATH, [...profileArgs, "--", "bash", "-c", killCmd], {
				timeout: WSL_KILL_TIMEOUT_MS,
				stdin: "ignore",
			}).catch((e) => {
				// Fire-and-forget — subprocess.kill() is the fallback.
				console.warn(
					`[ExecaTerminalProcess#abort] WSL internal kill failed: ${e instanceof Error ? e.message : String(e)}`,
				)
			})
		}

		// Function to perform the kill operations
		const performKill = () => {
			// Try to kill using the subprocess object
			if (this.subprocess) {
				try {
					this.subprocess.kill("SIGKILL")
				} catch (e) {
					console.warn(
						`[ExecaTerminalProcess#abort] Failed to kill subprocess: ${e instanceof Error ? e.message : String(e)}`,
					)
				}
			}

			// Kill the stored PID (which should be the actual command after our update)
			if (this.pid) {
				try {
					process.kill(this.pid, "SIGTERM")
				} catch (e) {
					console.warn(
						`[ExecaTerminalProcess#abort] Failed to kill process ${this.pid}: ${e instanceof Error ? e.message : String(e)}`,
					)
				}
			}
		}

		// If PID update is in progress, wait for it before killing
		if (this.pidUpdatePromise) {
			this.pidUpdatePromise.then(performKill).catch(() => performKill())
		} else {
			performKill()
		}

		// psTree walks the Windows process tree, which cannot see
		// Linux processes inside the WSL VM.  Process termination
		// for WSL is handled above via kill -9 -$PID from inside
		// WSL, with subprocess.kill() as fallback.
		if (this.pid && !this.isWslShell) {
			// Also check for any child processes
			psTree(this.pid, async (err, children) => {
				if (!err) {
					const pids = children.map((p) => parseInt(p.PID))

					for (const pid of pids) {
						try {
							process.kill(pid, "SIGTERM")
						} catch (e) {
							console.warn(
								`[ExecaTerminalProcess#abort] Failed to send SIGTERM to child PID ${pid}: ${e instanceof Error ? e.message : String(e)}`,
							)
						}
					}
				} else {
					console.error(
						`[ExecaTerminalProcess#abort] Failed to get process tree for PID ${this.pid}: ${err.message}`,
					)
				}
			})
		}
	}

	public override hasUnretrievedOutput() {
		return this.lastRetrievedIndex < this.fullOutput.length
	}

	public override getUnretrievedOutput() {
		let output = this.fullOutput.slice(this.lastRetrievedIndex)
		let index = output.lastIndexOf("\n")

		if (index === -1) {
			return ""
		}

		index++
		this.lastRetrievedIndex += index

		// console.log(
		// 	`[ExecaTerminalProcess#getUnretrievedOutput] fullOutput.length=${this.fullOutput.length} lastRetrievedIndex=${this.lastRetrievedIndex}`,
		// 	output.slice(0, index),
		// )

		return output.slice(0, index)
	}

	private emitRemainingBufferIfListening() {
		if (!this.isListening) {
			return
		}

		const output = this.getUnretrievedOutput()

		if (output !== "") {
			this.emit("line", output)
		}
	}
}
