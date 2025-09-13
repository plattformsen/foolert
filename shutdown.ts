const listeners: Array<() => Promise<void> | void> = [];

export function addShutdownListener(listener: () => Promise<void> | void) {
  listeners.unshift(listener);
}

let exiting: PromiseLike<never> | undefined = undefined;

export async function exit(exitCode: number): Promise<never> {
  if (exiting) return await exiting;

  const deferred = Promise.withResolvers<never>();
  exiting = deferred.promise;
  // we never call resolve on this, because we want to exit
  // the process after all listeners have been called, this
  // is simply just a way to halt execution for those that
  // await exit()

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
  if (Deno.stdin.isTerminal()) {
    Deno.stdin.setRaw(false);
  }
  Deno.removeSignalListener("SIGINT", exit0);
  Deno.removeSignalListener("SIGTERM", exit0);
  exit(0);
}

export function exitOnSignals() {
  Deno.addSignalListener("SIGINT", exit0);
  Deno.addSignalListener("SIGTERM", exit0);
  if (Deno.stdin.isTerminal()) {
    Deno.stdin.setRaw(true, { cbreak: true });
  }
}
