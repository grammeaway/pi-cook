/**
 * pi-cook: /cook keeps the screen awake, like "cook mode" on recipe sites.
 *
 *   /cook          toggle on/off
 *   /cook on       always awake while this session is open
 *   /cook agent    awake only while the agent is working
 *   /cook off
 *
 * Mode is per session: persisted as a session entry, so resuming restores it,
 * and other sessions aren't affected. A new or forked session (/new, /fork, or an
 * extension starting one) continues the mode of the session it replaced. Extension commands run immediately, even
 * mid-stream, so /cook never interrupts the agent.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn as nodeSpawn } from "node:child_process";

export type Mode = "off" | "on" | "agent";
const MODES: readonly Mode[] = ["off", "on", "agent"];
export const ENTRY_TYPE = "cook-mode";
const LABELS: Record<Mode, string> = { off: "", on: "♨ cook", agent: "♨ cook (agent)" };

export const parseMode = (arg: string, current: Mode): Mode | undefined => {
  const a = arg.trim().toLowerCase();
  if (a === "") return current === "off" ? "on" : "off";
  return MODES.includes(a as Mode) ? (a as Mode) : undefined;
};

export const shouldInhibit = (mode: Mode, busy: boolean) => mode === "on" || (mode === "agent" && busy);

// Both commands exit when `pid` does, so a crashed Pi can't leave the lock behind.
// ponytail: no Windows / non-systemd Linux backend; add one here if needed.
export function inhibitCommand(platform: string, pid: number): [string, string[]] | undefined {
  if (platform === "linux")
    return ["systemd-inhibit", ["--what=idle", "--who=pi", "--why=cook mode", "--mode=block", "tail", `--pid=${pid}`, "-f", "/dev/null"]];
  if (platform === "darwin") return ["caffeinate", ["-d", "-i", "-w", String(pid)]];
  return undefined;
}

export function restoreMode(entries: readonly any[]): Mode {
  let mode: Mode = "off";
  for (const e of entries)
    if (e?.type === "custom" && e.customType === ENTRY_TYPE && MODES.includes(e.data?.mode)) mode = e.data.mode;
  return mode;
}

type Child = { kill(): unknown; unref(): unknown; on(event: string, fn: (...args: any[]) => void): unknown };
type Deps = { spawn: (cmd: string, args: string[]) => Child; platform: string; pid: number };

const defaults: Deps = {
  spawn: (cmd, args) => nodeSpawn(cmd, args, { stdio: "ignore" }),
  platform: process.platform,
  pid: process.pid,
};

export function createCookMode(overrides: Partial<Deps> = {}) {
  const deps = { ...defaults, ...overrides };

  return function cookMode(pi: ExtensionAPI) {
    let mode: Mode = "off";
    let busy = false;
    let child: Child | undefined;

    const indicate = (ctx: any) => {
      // Read by custom footers that don't render setStatus.
      (globalThis as any).__piCookMode = LABELS[mode];
      ctx.ui.setStatus("cook-mode", LABELS[mode]);
    };

    const setMode = (next: Mode, ctx: any) => {
      if (next !== mode) {
        mode = next;
        pi.appendEntry(ENTRY_TYPE, { mode });
      }
      sync(ctx);
    };

    const stop = () => {
      const c = child;
      child = undefined; // cleared first so the exit handler knows this was intentional
      c?.kill();
    };

    const fail = (ctx: any, message: string) => {
      stop();
      setMode("off", ctx);
      ctx.ui.notify(`Cook mode OFF: ${message}`, "error");
    };

    const start = (ctx: any) => {
      const command = inhibitCommand(deps.platform, deps.pid);
      if (!command) return fail(ctx, `unsupported platform "${deps.platform}".`);
      const c = deps.spawn(...command);
      c.unref();
      c.on("error", (err: Error) => child === c && fail(ctx, `${command[0]} failed (${err.message}).`));
      c.on("exit", () => child === c && fail(ctx, `${command[0]} exited unexpectedly.`));
      child = c;
    };

    const sync = (ctx: any) => {
      const want = shouldInhibit(mode, busy);
      if (want && !child) start(ctx);
      else if (!want && child) stop();
      indicate(ctx);
    };

    pi.registerCommand("cook", {
      description: "Keep the screen awake. /cook [on|off|agent], no arg toggles",
      handler: async (args, ctx) => {
        const next = parseMode(args, mode);
        if (!next) return ctx.ui.notify("Usage: /cook [on|off|agent]", "warning");
        setMode(next, ctx);
        if (mode !== next) return; // start failed and already notified
        const text = { off: "Cook mode OFF.", on: "Cook mode ON, screen stays awake.", agent: "Cook mode AGENT, screen stays awake while the agent works." };
        ctx.ui.notify(text[mode], "info");
      },
    });

    pi.on("session_start", (e, ctx) => {
      stop();
      busy = false;
      mode = restoreMode(ctx.sessionManager.getBranch());
      const carried = (globalThis as any).__piCookCarry;
      if ((e.reason === "new" || e.reason === "fork") && MODES.includes(carried)) setMode(carried, ctx);
      else sync(ctx);
    });
    pi.on("agent_start", (_e, ctx) => {
      busy = true;
      sync(ctx);
    });
    pi.on("agent_settled", (_e, ctx) => {
      busy = false;
      sync(ctx);
    });
    pi.on("session_shutdown", () => {
      // Each session loads its own copy of this extension; the next one picks this up in session_start.
      (globalThis as any).__piCookCarry = mode;
      busy = false;
      stop();
    });
  };
}

export default createCookMode();
