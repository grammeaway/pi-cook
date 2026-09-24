import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { inhibitCommand, parseMode, restoreMode, ENTRY_TYPE, createCookMode } from "../index.ts";
import { harness } from "./harness.ts";

test("parseMode: bare toggles between off and on, agent toggles to off", () => {
  assert.equal(parseMode("", "off"), "on");
  assert.equal(parseMode("", "on"), "off");
  assert.equal(parseMode("  ", "agent"), "off");
  assert.equal(parseMode(" AGENT ", "off"), "agent");
  assert.equal(parseMode("bogus", "on"), undefined);
});

test("inhibitCommand ties the lock to the Pi pid per platform", () => {
  assert.deepEqual(inhibitCommand("linux", 7)?.[1].slice(-4), ["tail", "--pid=7", "-f", "/dev/null"]);
  assert.deepEqual(inhibitCommand("darwin", 7), ["caffeinate", ["-d", "-i", "-w", "7"]]);
  assert.equal(inhibitCommand("win32", 7), undefined);
});

test("restoreMode: last valid entry on the branch wins, junk ignored", () => {
  const e = (customType: string, data: unknown) => ({ type: "custom", customType, data });
  assert.equal(restoreMode([]), "off");
  assert.equal(restoreMode([e(ENTRY_TYPE, { mode: "on" }), e("other", { mode: "off" })]), "on");
  assert.equal(restoreMode([e(ENTRY_TYPE, { mode: "agent" }), e(ENTRY_TYPE, { mode: "nope" }), e(ENTRY_TYPE, null)]), "agent");
});

test("/cook on holds one inhibitor; repeating it is idempotent", async () => {
  const h = harness();
  h.emit("session_start");
  await h.cook("on");
  await h.cook("on");
  assert.equal(h.live().length, 1);
  assert.equal(h.children[0].cmd, "systemd-inhibit");
  assert.equal(h.entries.length, 1);
  assert.equal(h.status, "♨ cook");
  await h.cook("off");
  assert.equal(h.live().length, 0);
  assert.equal(h.status, "");
});

test("agent mode only holds the lock while the agent works", async () => {
  const h = harness();
  h.emit("session_start");
  await h.cook("agent");
  assert.equal(h.live().length, 0);
  h.emit("agent_start");
  assert.equal(h.live().length, 1);
  h.emit("agent_settled");
  assert.equal(h.live().length, 0);
  assert.equal(h.status, "♨ cook (agent)");
});

test("/cook mid-run takes effect immediately", async () => {
  const h = harness();
  h.emit("session_start");
  h.emit("agent_start");
  await h.cook("agent");
  assert.equal(h.live().length, 1);
});

test("resume restores the mode from the session", async () => {
  const h = harness();
  h.emit("session_start");
  await h.cook("on");
  h.emit("session_shutdown");
  assert.equal(h.live().length, 0);
  h.emit("session_start");
  assert.equal(h.live().length, 1);
  assert.equal(h.status, "♨ cook");
});

test("inhibitor crash turns cook mode off and says so", async () => {
  const h = harness();
  h.emit("session_start");
  await h.cook("on");
  h.children[0].crash();
  assert.equal(h.status, "");
  assert.equal(restoreMode(h.entries), "off");
  assert.equal(h.notes.at(-1)?.level, "error");
});

test("missing binary (spawn error) turns cook mode off", async () => {
  const h = harness({
    spawn: () => {
      const c: any = new EventEmitter();
      c.unref = () => {};
      c.kill = () => {};
      queueMicrotask(() => (c.emit("error", new Error("spawn ENOENT")), c.emit("exit", -2)));
      return c;
    },
  });
  h.emit("session_start");
  await h.cook("on");
  await new Promise((r) => setImmediate(r));
  assert.equal(h.status, "");
  assert.equal(h.notes.filter((n) => n.level === "error").length, 1);
});

test("unsupported platform reports an error and stays off", async () => {
  const h = harness({ platform: "win32" });
  h.emit("session_start");
  await h.cook("on");
  assert.equal(h.children.length, 0);
  assert.equal(h.status, "");
  assert.match(h.notes.at(-1)!.msg, /unsupported platform/);
});

test("unknown argument shows usage and changes nothing", async () => {
  const h = harness();
  h.emit("session_start");
  await h.cook("sometimes");
  assert.equal(h.entries.length, 0);
  assert.equal(h.notes.at(-1)?.level, "warning");
});

const listInhibitors = () => spawnSync("systemd-inhibit", ["--list", "--no-pager"], { encoding: "utf8" });
const hasSystemd = process.platform === "linux" && listInhibitors().status === 0;

test("real systemd-inhibit lock is taken and released", { skip: !hasSystemd && "needs systemd-inhibit" }, async () => {
  const handlers: Record<string, any> = {};
  let cmd: any;
  const pi: any = { on: (e: string, f: any) => (handlers[e] = f), registerCommand: (_: string, c: any) => (cmd = c), appendEntry() {} };
  const ctx = { ui: { setStatus() {}, notify() {} }, sessionManager: { getBranch: () => [] } };
  createCookMode()(pi);
  handlers.session_start({}, ctx);
  const held = () => listInhibitors().stdout.includes("cook mode");
  const waitFor = async (want: boolean) => {
    for (let i = 0; i < 50 && held() !== want; i++) await new Promise((r) => setTimeout(r, 100));
    return held();
  };
  try {
    await cmd.handler("on", ctx);
    assert.equal(await waitFor(true), true);
    await cmd.handler("off", ctx);
    assert.equal(await waitFor(false), false);
  } finally {
    handlers.session_shutdown({}, ctx);
  }
});
