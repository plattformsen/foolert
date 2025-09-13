import { app } from "./app.ts";
import { addShutdownListener, exitOnSignals } from "./shutdown.ts";

const server = Deno.serve({
  onListen: ({ hostname, port }) => {
    console.debug(`debug: listening on http://${hostname}:${port}`);
  },
}, app);

addShutdownListener(async () => {
  await server.shutdown();
  await server.finished;
});

exitOnSignals();
