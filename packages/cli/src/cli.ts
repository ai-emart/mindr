#!/usr/bin/env node
import { Command } from 'commander'
import { addInternalCommands } from './commands/internal.js'
import { addGenerateCommands } from './commands/generate.js'
import { addServeCommands } from './commands/serve.js'
import { addInitCommand } from './commands/init.js'
import { addRememberCommand } from './commands/remember.js'
import { addForgetCommand } from './commands/forget.js'
import { addMemoryCommands } from './commands/memory.js'
import { addStatusCommand } from './commands/status.js'
import { addConfigCommands } from './commands/config.js'
import { addMigrateCommands } from './commands/migrate.js'
import { addDecisionsCommands } from './commands/decisions.js'
import { addReplayCommands } from './commands/replay.js'
import { addBranchCommands } from './commands/branch.js'

const program = new Command()
program.name('mindr').description('Memory-augmented dev tooling').version('0.0.1')

addInitCommand(program)
addRememberCommand(program)
addForgetCommand(program)
addMemoryCommands(program)
addDecisionsCommands(program)
addReplayCommands(program)
addBranchCommands(program)
addStatusCommand(program)
addConfigCommands(program)
addMigrateCommands(program)
addGenerateCommands(program)
addServeCommands(program)
addInternalCommands(program)

program.parseAsync(process.argv)
