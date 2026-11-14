import { createDemoChat } from "./demoChat";
import { createDemoExecution } from "./demoExecution";
import { createDemoGuardian } from "./demoGuardian";
import { createDemoPosition } from "./demoPosition";
import { createDemoSession } from "./demoSession";
import type { ConsultationSource } from "./types";

/** One consultation owns one in-memory domain; no singleton leaks between mounts. */
export function createDemoSource(): ConsultationSource {
  const session = createDemoSession();
  const position = createDemoPosition(() => session.port.getSnapshot().walletBalance);
  const execution = createDemoExecution(session, position);
  const guardian = createDemoGuardian(session, execution);
  const chat = createDemoChat(
    (value) => ({
      position: position.port.getSnapshot(),
      advice: position.port.advice(value),
      guardian: guardian.port.getSnapshot(),
      receipts: execution.port.getSnapshot().receipts,
    }),
    position.rememberCard,
  );
  return {
    session: session.port,
    position: position.port,
    execution: execution.port,
    guardian: guardian.port,
    chat,
    reset() {
      session.resetBalance();
      position.reset();
      execution.reset();
      guardian.reset();
    },
  };
}
