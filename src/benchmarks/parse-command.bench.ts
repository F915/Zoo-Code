import { bench, describe } from "vitest"

import { parseCommand } from "../shared/parse-command"

const simpleCommand = "echo hello"
const chainedCommand = "npm install && npm run build && npm test"
const complexCommand = 'cd /workspace && git status && echo "$(date)" | tee log.txt; cat log.txt 2>&1 | grep -i error'
const multiLineCommand = `#!/bin/bash
set -e
echo "Starting build"
npm install --production
npm run build
npm run test -- --coverage
echo "Build complete"
`
const shellVariablesCommand = "export NODE_ENV=production && echo $NODE_ENV && echo ${HOME:-/root} && echo $((1 + 2))"

describe("parseCommand", () => {
	bench("simple command", () => {
		parseCommand(simpleCommand)
	})

	bench("chained commands (&&)", () => {
		parseCommand(chainedCommand)
	})

	bench("complex command (pipes, redirections, subshells)", () => {
		parseCommand(complexCommand)
	})

	bench("multi-line script", () => {
		parseCommand(multiLineCommand)
	})

	bench("shell variables and expansions", () => {
		parseCommand(shellVariablesCommand)
	})
})
