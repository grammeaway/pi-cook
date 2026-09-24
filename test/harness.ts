import { EventEmitter } from "node:events";
import { createCookMode } from "../index.ts";

export class FakeChild extends EventEmitter {
  alive = true;
  cmd: string;
  args: string[];
  constructor(cmd: string, args: string[]) {
    super();
    this.cmd = cmd;
    this.args = args;
  }
  unref() {}
  // Synchronous exit: stricter than reality, catches "kill before clearing ref" bugs.
  kill() {
    if (!this.alive) return;
    this.alive = false;
    this.emit("exit", null, "SIGTERM");
  }
  crash() {
    this.alive = false;
    this.emit("exit", 1, null);
  }
}

export function harness(opts: { platform?: string; spawn?: (cmd: string, args: string[]) => any } = {}) {
  const handlers: Record<string, (e: any, ctx: any) => unknown> = {};
  const commands: Record<string, { handler: (args: string, ctx: any) => unknown }> = {};
  const entries: any[] = [];
  const children: FakeChild[] = [];
  const notes: { msg: string; level: string }[] = [];
  let status = "";

  const pi = {
    on: (event: string, fn: any) => void (handlers[event] = fn),
    registerCommand: (name: string, cmd: any) => void (commands[name] = cmd),
    appendEntry: (customType: string, data: unknown) => void entries.push({ type: "custom", customType, data }),
  };
  const ctx = {
    ui: {
      setStatus: (_key: string, text: string) => void (status = text),
      notify: (msg: string, level: string) => void notes.push({ msg, level }),
    },
    sessionManager: { getBranch: () => entries },
  };
  const spawn =
    opts.spawn ??
    ((cmd: string, args: string[]) => {
      const c = new FakeChild(cmd, args);
      children.push(c);
      return c;
    });

  createCookMode({ platform: opts.platform ?? "linux", pid: 4242, spawn })(pi as any);

  return {
    entries,
    children,
    notes,
    get status() {
      return status;
    },
    live: () => children.filter((c) => c.alive),
    emit: (event: string) => handlers[event]?.({ type: event }, ctx),
    cook: (args = "") => commands.cook.handler(args, ctx),
  };
}
