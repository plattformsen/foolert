import { app } from "./app.ts";

const server = Deno.serve({
  onListen: ({ hostname, port }) => {
    console.debug(`debug: listening on http://${hostname}:${port}`);
  },
}, app);

await server.finished;
