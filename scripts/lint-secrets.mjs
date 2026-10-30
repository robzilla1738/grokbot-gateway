#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const patterns = ["courson96", "@gmail.com", "BEGIN OPENSSH PRIVATE"];

function gitGrep(pat) {
  try {
    return execFileSync(
      "git",
      ["grep", "-n", "-i", "-I", "-F", "--untracked", "--exclude-standard", pat, "--", ":!pnpm-lock.yaml"],
      {
      encoding: "utf8",
      cwd: new URL("..", import.meta.url)
    });
  } catch (err) {
    if (err && typeof err === "object" && "status" in err && err.status === 1) return "";
    throw err;
  }
}

let failed = false;
for (const pat of patterns) {
  const out = gitGrep(pat);
  const lines = out
    .trim()
    .split("\n")
    .filter(
      (l) =>
        l &&
        !l.includes("security@example.com") &&
        !l.includes("someone@example.com") &&
        !l.includes("scripts/lint-secrets.mjs")
    );
  if (lines.length) {
    failed = true;
    console.error(`lint-secrets: matched ${pat}`);
    console.error(lines.join("\n"));
  }
}

if (failed) process.exit(1);
console.log("lint-secrets: ok");
