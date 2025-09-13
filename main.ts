import { app } from "./app.ts";
import { closeKv } from "./kv.ts";

const ac = new AbortController();

Deno.addSignalListener("SIGINT", () => {
  console.debug("debug: caught SIGINT, shutting down...");
  ac.abort();
});

Deno.addSignalListener("SIGTERM", () => {
  console.debug("debug: caught SIGTERM, shutting down...");
  ac.abort();
});

ac.signal.addEventListener("abort", closeKv);

const server = Deno.serve({
  onListen: ({ hostname, port }) => {
    console.debug(`debug: listening on http://${hostname}:${port}`);
  },
  signal: ac.signal,
}, app);

await server.finished;
