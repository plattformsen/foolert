import { authenticateRequest } from "./auth.ts";
import routes from "./routes/mod.ts";

export async function app(
  request: Request,
  info: Deno.ServeHandlerInfo<Deno.NetAddr>,
): Promise<Response> {
  const auth = await authenticateRequest(info.remoteAddr.hostname);

  if (!auth) {
    return new Response("Forbidden: Untrusted", { status: 403 });
  }

  return routes({ auth }, request, info);
}
