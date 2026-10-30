#!/usr/bin/env node
import { runCli } from "../cli/index.js";

runCli().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
});
