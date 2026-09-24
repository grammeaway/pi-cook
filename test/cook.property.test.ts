import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { restoreMode, type Mode } from "../index.ts";
import { harness } from "./harness.ts";

type Action =
  | { kind: "cook"; arg: string }
  | { kind: "agent_start" | "agent_settled" | "crash" | "resume" };

const action: fc.Arbitrary<Action> = fc.oneof(
  fc.constantFrom("", "on", "off", "agent", "bogus").map((arg) => ({ kind: "cook" as const, arg })),
  fc.constantFrom("agent_start", "agent_settled", "crash", "resume").map((kind) => ({ kind }) as Action),
);

// Reference model, written independently of the implementation.
function step(m: { mode: Mode; busy: boolean }, a: Action, childAlive: boolean) {
  switch (a.kind) {
    case "cook":
      if (a.arg === "") m.mode = m.mode === "off" ? "on" : "off";
      else if (a.arg !== "bogus") m.mode = a.arg as Mode;
      break;
    case "agent_start":
      m.busy = true;
      break;
    case "agent_settled":
      m.busy = false;
      break;
    case "crash":
      if (childAlive) m.mode = "off";
      break;
    case "resume":
      m.busy = false;
      break;
  }
}

test("inhibitor is held exactly when the model says so, and mode survives resume", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(action, { maxLength: 40 }), async (actions) => {
      const h = harness();
      const m = { mode: "off" as Mode, busy: false };
      h.emit("session_start");

      for (const a of actions) {
        const alive = h.live();
        step(m, a, alive.length > 0);
        if (a.kind === "cook") await h.cook(a.arg);
        else if (a.kind === "crash") alive.forEach((c) => c.crash());
        else if (a.kind === "resume") (h.emit("session_shutdown"), h.emit("session_start"));
        else h.emit(a.kind);

        const want = m.mode === "on" || (m.mode === "agent" && m.busy);
        assert.equal(h.live().length, want ? 1 : 0, `after ${JSON.stringify(a)}`);
        assert.equal(restoreMode(h.entries), m.mode);
        assert.equal(h.status !== "", m.mode !== "off");
      }

      h.emit("session_shutdown");
      assert.equal(h.live().length, 0);
    }),
  );
});
