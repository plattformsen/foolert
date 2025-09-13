const listeners: Array<() => Promise<void> | void> = [];

export function addShutdownListener(listener: () => Promise<void> | void) {
  listeners.push(listener);
}

let exiting = false;

export async function exit(exitCode: number): Promise<never> {
  if (!exiting) undefined as never;
  exiting = true;

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
  if (exiting) return;
  console.debug("debug: exiting on signal");
  Deno.stdin.setRaw(false);
  Deno.removeSignalListener("SIGINT", exit0);
  Deno.removeSignalListener("SIGTERM", exit0);
  exit(0);
}

export function exitOnSignals() {
  Deno.addSignalListener("SIGINT", exit0);
  Deno.addSignalListener("SIGTERM", exit0);
  Deno.stdin.setRaw(true, { cbreak: true });
}
