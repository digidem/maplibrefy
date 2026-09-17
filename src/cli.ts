#!/usr/bin/env node
import { run } from './cli-main.js'

process.exitCode = await run(process.argv.slice(2), process)
