const listeners: Array<() => Promise<void> | void> = [];

export function addShutdownListener(listener: () => Promise<void> | void) {
  listeners.push(listener);
}

export async function exit(exitCode: number): Promise<never> {
  for (const listener of listeners) {
    try {
      await listener();
    } catch (e) {
      console.error("error: shutdown listener %s failed, %s", listener.name, e);
    }
  }
  Deno.exit(exitCode);
}

function exit0() {
  Deno.removeSignalListener("SIGINT", exit0);
  Deno.removeSignalListener("SIGTERM", exit0);
  exit(0);
}

export function exitOnSignals() {
  Deno.addSignalListener("SIGINT", exit0);
  Deno.addSignalListener("SIGTERM", exit0);
}
