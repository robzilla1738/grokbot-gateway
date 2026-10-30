import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BoxError, boxList, boxReadFile, parseFile, parseListing, type SshResult, type SshRunner } from "../src/box.js";
import { GrokBotClient, createMockTransport } from "../src/client/index.js";
import { dispatchTool } from "../src/gateway.js";
import { actorFromToken, createToken, parseScopes } from "../src/security/tokens.js";
import { READONLY_SCOPES } from "../src/types.js";

function result(partial: Partial<SshResult>): SshResult {
  return { code: 0, stdout: Buffer.alloc(0), stderr: "", timedOut: false, ...partial };
}

describe("box over SSH", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "gbgt-box-"));
    process.env.GROKBOT_GATEWAY_HOME = home;
    process.env.GROKBOT_BOX_HOST = "test-box";
    process.env.GROKBOT_BOX_USER = "tester";
  });

  afterEach(() => {
    delete process.env.GROKBOT_GATEWAY_HOME;
    delete process.env.GROKBOT_BOX_HOST;
    delete process.env.GROKBOT_BOX_USER;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("sends the path on stdin, never in the remote command", async () => {
    const calls: Array<{ target: string; command: string; stdin: string }> = [];
    const run: SshRunner = async (target, command, stdin) => {
      calls.push({ target, command, stdin });
      return result({ stdout: Buffer.from("/home/tester/x\n") });
    };
    const evil = "~/x'; touch /tmp/pwned; echo '";
    await boxList(evil, run);
    await boxList("/etc", run);
    expect(calls[0]?.target).toBe("tester@test-box");
    expect(calls[0]?.stdin).toBe(`${evil}\n`);
    expect(calls[0]?.command).not.toContain("pwned");
    expect(calls[0]?.command).toBe(calls[1]?.command);
  });

  it("rejects paths with newlines or null bytes before connecting", async () => {
    const run: SshRunner = async () => {
      throw new Error("should not connect");
    };
    await expect(boxList("a\nb", run)).rejects.toBeInstanceOf(BoxError);
    await expect(boxReadFile("a\0b", 10, run)).rejects.toBeInstanceOf(BoxError);
    await expect(boxReadFile("a", 0, run)).rejects.toThrow(/maxBytes/);
  });

  it("turns a Tailscale SSH check into a clear error with the URL", async () => {
    const run: SshRunner = async () =>
      result({
        code: null,
        timedOut: true,
        stderr: "# Tailscale SSH requires an additional check.\n# To authenticate, visit: https://login.tailscale.com/a/abc123\n"
      });
    await expect(boxList("~", run)).rejects.toThrow(/browser check.*https:\/\/login\.tailscale\.com\/a\/abc123/);
  });

  it("reports remote errors and unreachable hosts", async () => {
    await expect(boxReadFile("~/nope", 10, async () => result({ code: 2, stderr: "not a regular file: /home/tester/nope\n" }))).rejects.toThrow(
      "not a regular file: /home/tester/nope"
    );
    await expect(boxList("~", async () => result({ code: 255, stderr: "ssh: connect to host test-box port 22: Connection refused\n" }))).rejects.toThrow(
      /Cannot reach test-box over SSH: .*Connection refused/
    );
  });

  it("parses listings with dirs first", () => {
    const out = Buffer.from("/home/tester\nf\t12\t1700000000.5\tb.txt\0d\t4096\t1700000000\tsrc\0l\t9\t1700000000\tlink\0");
    const listing = parseListing("test-box", out);
    expect(listing.path).toBe("/home/tester");
    expect(listing.entries.map((e) => [e.name, e.type])).toEqual([
      ["src", "dir"],
      ["b.txt", "file"],
      ["link", "link"]
    ]);
    expect(listing.entries[1]?.modifiedAt).toBe(new Date(1_700_000_000_500).toISOString());
  });

  it("parses files, truncation, and binary content", () => {
    const text = parseFile("test-box", Buffer.concat([Buffer.from("/a.txt\0" + "11\0"), Buffer.from("hello")]), 5);
    expect(text).toMatchObject({ path: "/a.txt", size: 11, truncated: true, binary: false, text: "hello" });
    const bin = parseFile("test-box", Buffer.concat([Buffer.from("/b\0" + "3\0"), Buffer.from([1, 0, 2])]), 10);
    expect(bin).toMatchObject({ binary: true, text: null, truncated: false });
  });

  it("needs the box:read scope, which read-only tokens do not get", async () => {
    expect(READONLY_SCOPES).not.toContain("box:read");
    const rec = createToken("reader", parseScopes("readonly"));
    const gateway = { client: new GrokBotClient(createMockTransport()), actor: actorFromToken(rec) };
    const denied = await dispatchTool(gateway, "box_list", {});
    expect(denied.isError).toBe(true);
    expect(denied.content[0]?.text).toMatch(/missing scope box:read/);
  });

  // The remote scripts use GNU find/stat, so run them for real only on Linux.
  describe.skipIf(process.platform !== "linux")("against a local shell", () => {
    let boxHome: string;
    let fakeBin: string;
    const saved = { HOME: process.env.HOME, PATH: process.env.PATH };

    beforeEach(() => {
      boxHome = fs.mkdtempSync(path.join(os.tmpdir(), "gbgt-boxhome-"));
      fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "gbgt-fakessh-"));
      fs.mkdirSync(path.join(boxHome, "workspace"));
      fs.writeFileSync(path.join(boxHome, "workspace", "notes.md"), "hello box\n");
      fs.writeFileSync(path.join(fakeBin, "ssh"), '#!/bin/sh\nfor last; do :; done\ncd "$HOME" && exec sh -c "$last"\n', { mode: 0o755 });
      process.env.HOME = boxHome;
      process.env.PATH = `${fakeBin}:${saved.PATH}`;
    });

    afterEach(() => {
      process.env.HOME = saved.HOME;
      process.env.PATH = saved.PATH;
      fs.rmSync(boxHome, { recursive: true, force: true });
      fs.rmSync(fakeBin, { recursive: true, force: true });
    });

    it("lists and reads through the real remote scripts", async () => {
      const listing = await boxList("~");
      expect(listing.path).toBe(fs.realpathSync(boxHome));
      expect(listing.entries).toEqual([expect.objectContaining({ name: "workspace", type: "dir" })]);
      const file = await boxReadFile("~/workspace/notes.md");
      expect(file).toMatchObject({ size: 10, truncated: false, binary: false, text: "hello box\n" });
      const relative = await boxReadFile("workspace/notes.md", 5);
      expect(relative).toMatchObject({ truncated: true, text: "hello" });
      await expect(boxList("~/$(touch pwned)")).rejects.toThrow(/not a directory/);
      expect(fs.existsSync(path.join(boxHome, "pwned"))).toBe(false);
    });
  });
});
