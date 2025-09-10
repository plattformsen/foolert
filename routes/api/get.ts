import type { AuthenticationContext } from "../../auth.ts";
import { defineHandler } from "../../web_util.ts";

export default defineHandler<HelloContext>((ctx, _r) => {
  return new Response(`Hello, ${ctx.auth.hostnames[0]}!`);
});

export interface HelloContext {
  auth: AuthenticationContext;
}
