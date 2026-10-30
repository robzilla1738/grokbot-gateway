export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function printHuman(lines: string[]): void {
  process.stdout.write(lines.join("\n") + "\n");
}

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

export function fail(err: unknown, json: boolean): never {
  const message = err instanceof Error ? err.message : String(err);
  if (json) printJson({ ok: false, error: message });
  else process.stderr.write(`error: ${message}\n`);
  process.exitCode = 1;
  throw new CliError(message);
}
