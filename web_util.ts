import z, { type ZodType } from "zod";
import { parse as parseJsonc } from "@std/jsonc";
import {
  decode as parseMsgpack,
  encode as bytifyMsgpack,
  type ValueType as MsgpackType,
} from "@std/msgpack";
import { parse as parseToml, stringify as stringifyToml } from "@std/toml";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import {
  CborType,
  decodeCbor as parseCbor,
  encodeCbor as bytifyCbor,
} from "@std/cbor";
import json5 from "json5";
import { parseMediaType } from "@std/media-types";
import { accepts } from "@std/http";

type Awaitable<T> = T | Promise<T>;

export type MethodLowercase = "get" | "post" | "put" | "delete" | "patch";
export type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export type ParamsBase = {
  [key in string]?: string;
};

export type Handler<
  // deno-lint-ignore no-explicit-any
  Context extends unknown = any,
  Params extends ParamsBase = Record<
    string,
    string | undefined
  >,
> = (
  ctx: Context,
  request: Request,
  params: Params,
  info: Deno.ServeHandlerInfo<Deno.NetAddr>,
) => Awaitable<Response | void>;

export function defineHandler<
  Context extends unknown = unknown,
  Params extends ParamsBase = Record<
    string,
    string | undefined
  >,
>(
  handler: Handler<Context, Params>,
): Handler<Context, Params> {
  return handler;
}

export type MethodsHandler =
  & {
    [method in Method]?: Handler;
  }
  & {
    [method in MethodLowercase]?: Handler;
  };

export type Route = Handler | MethodsHandler;

export function defineRoute(
  pathname: string,
  route: Route,
): Routes {
  return { [pathname]: route };
}

export interface Routes {
  [key: string]: Route | Routes[];
}

export function defineRoutes(routes: Routes): Routes {
  return routes;
}

export function defineGroup(prefix: string, group: Routes | Routes[]): Routes {
  const prefixedRoutes: Routes = {};

  if (!Array.isArray(group)) {
    group = [group];
  }

  for (const routes of group) {
    for (const [path, route] of Object.entries(routes)) {
      prefixedRoutes[`${prefix}${path}`] = route;
    }
  }

  return prefixedRoutes;
}

export function buildMethodsHandler(handlers: Route): Handler {
  if (typeof handlers === "function") {
    return handlers;
  }

  const GET = handlers.GET || handlers.get;
  const POST = handlers.POST || handlers.post;
  const PUT = handlers.PUT || handlers.put;
  const DELETE = handlers.DELETE || handlers.delete;
  const PATCH = handlers.PATCH || handlers.patch;

  return (ctx, request, params, info) => {
    const method = request.method as Method;

    switch (method) {
      case "GET":
        if (GET) return GET(ctx, request, params, info);
        break;
      case "POST":
        if (POST) return POST(ctx, request, params, info);
        break;
      case "PUT":
        if (PUT) return PUT(ctx, request, params, info);
        break;
      case "DELETE":
        if (DELETE) return DELETE(ctx, request, params, info);
        break;
      case "PATCH":
        if (PATCH) return PATCH(ctx, request, params, info);
        break;
    }

    return Response.json({ error: "method not allowed" }, { status: 405 });
  };
}

export function flattenRoutes(routes: Routes, parentPath: string = ""): Routes {
  const flatRoutes: Routes = {};

  for (const [path, route] of Object.entries(routes)) {
    const fullPath = `${parentPath}${path}`;

    if (Array.isArray(route)) {
      for (const subRoutes of route) {
        const nestedFlatRoutes = flattenRoutes(subRoutes, fullPath);
        Object.assign(flatRoutes, nestedFlatRoutes);
      }
    } else {
      flatRoutes[fullPath] = route;
    }
  }

  return flatRoutes;
}

export function compileRoutes(routes: Routes): Map<URLPattern, Handler> {
  const map = new Map<URLPattern, Handler>();
  const flatRoutes = flattenRoutes(routes);
  for (const [key, handler] of Object.entries(flatRoutes)) {
    const pattern = new URLPattern({ pathname: key });
    console.debug(
      "debug: registering route for '%s' with %s",
      key,
      typeof handler === "function"
        ? "ALL"
        : Object.keys(handler).map((s) => s.toUpperCase()).join(", "),
    );
    map.set(
      pattern,
      buildMethodsHandler(handler as Route),
    );
  }
  return map;
}

class ReadNBytesSource {
  #remaining: number;
  #source: ReadableStream<Uint8Array>;
  #reader?: ReadableStreamDefaultReader<Uint8Array>;

  constructor(n: number, source: ReadableStream<Uint8Array>) {
    this.#remaining = n;
    this.#source = source;
  }

  async pull(controller: ReadableStreamDefaultController<Uint8Array>) {
    if (this.#remaining <= 0) {
      controller.close();
      return;
    }

    if (this.#reader === undefined) {
      this.#reader = this.#source.getReader();
    }

    const { done, value } = await this.#reader.read();

    if (done) {
      controller.close();
      this.#reader.releaseLock();
      this.#reader = undefined;
      return;
    }

    if (value) {
      if (value.length <= this.#remaining) {
        controller.enqueue(value);
        this.#remaining -= value.length;
      } else {
        controller.enqueue(value.subarray(0, this.#remaining));
        this.#remaining = 0;
        this.#reader.releaseLock();
        this.#reader = undefined;
      }
    }
  }
}

function readAtMostNBytes(
  stream: ReadableStream<Uint8Array>,
  n: number,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>(new ReadNBytesSource(n, stream));
}

function streamOfRequestBody(
  request: Request,
): ReadableStream<Uint8Array> | undefined {
  if (!request.body) {
    console.debug("debug: request has no body");
    return undefined;
  }

  if (request.headers.has("content-length")) {
    const contentLength = parseInt(request.headers.get("content-length")!, 10);
    if (Number.isNaN(contentLength) || !Number.isSafeInteger(contentLength)) {
      console.debug("debug: request has no body");
      return undefined;
    }
    return readAtMostNBytes(request.body, contentLength);
  }

  return request.body;
}

export class ResponseError extends Error {
  constructor(
    public readonly response: Response,
    message?: string,
  ) {
    super(message);
  }
}
ResponseError.prototype.name = "ResponseError";

const decoders = new Map<
  string,
  (stream: ReadableStream<Uint8Array>) => Awaitable<unknown>
>();
const textDecoder = new TextDecoder();

async function decodeJson(
  stream: ReadableStream<Uint8Array>,
): Promise<unknown> {
  let bytes: Uint8Array = new Uint8Array(0);
  for await (const chunk of stream) {
    const newBytes = new Uint8Array(bytes.length + chunk.length);
    newBytes.set(bytes);
    newBytes.set(chunk, bytes.length);
    bytes = newBytes;
  }
  const text = textDecoder.decode(bytes);
  return JSON.parse(text);
}

async function decodeJsonc(
  stream: ReadableStream<Uint8Array>,
): Promise<unknown> {
  let bytes: Uint8Array = new Uint8Array(0);
  for await (const chunk of stream) {
    const newBytes = new Uint8Array(bytes.length + chunk.length);
    newBytes.set(bytes);
    newBytes.set(chunk, bytes.length);
    bytes = newBytes;
  }
  const text = textDecoder.decode(bytes);
  return parseJsonc(text);
}

async function decodeMsgpack(
  stream: ReadableStream<Uint8Array>,
): Promise<unknown> {
  let bytes: Uint8Array = new Uint8Array(0);
  for await (const chunk of stream) {
    const newBytes = new Uint8Array(bytes.length + chunk.length);
    newBytes.set(bytes);
    newBytes.set(chunk, bytes.length);
    bytes = newBytes;
  }
  return parseMsgpack(bytes);
}

async function decodeToml(
  stream: ReadableStream<Uint8Array>,
): Promise<unknown> {
  let bytes: Uint8Array = new Uint8Array(0);
  for await (const chunk of stream) {
    const newBytes = new Uint8Array(bytes.length + chunk.length);
    newBytes.set(bytes);
    newBytes.set(chunk, bytes.length);
    bytes = newBytes;
  }
  const text = textDecoder.decode(bytes);
  return parseToml(text);
}

async function decodeYaml(
  stream: ReadableStream<Uint8Array>,
): Promise<unknown> {
  let bytes: Uint8Array = new Uint8Array(0);
  for await (const chunk of stream) {
    const newBytes = new Uint8Array(bytes.length + chunk.length);
    newBytes.set(bytes);
    newBytes.set(chunk, bytes.length);
    bytes = newBytes;
  }
  const text = textDecoder.decode(bytes);
  return parseYaml(text);
}

async function decodeCbor(
  stream: ReadableStream<Uint8Array>,
): Promise<unknown> {
  let bytes: Uint8Array = new Uint8Array(0);
  for await (const chunk of stream) {
    const newBytes = new Uint8Array(bytes.length + chunk.length);
    newBytes.set(bytes);
    newBytes.set(chunk, bytes.length);
    bytes = newBytes;
  }
  return parseCbor(bytes);
}

async function decodeJson5(
  stream: ReadableStream<Uint8Array>,
): Promise<unknown> {
  let bytes: Uint8Array = new Uint8Array(0);
  for await (const chunk of stream) {
    const newBytes = new Uint8Array(bytes.length + chunk.length);
    newBytes.set(bytes);
    newBytes.set(chunk, bytes.length);
    bytes = newBytes;
  }
  const text = textDecoder.decode(bytes);
  return json5.parse(text);
}

decoders.set("application/json", decodeJson);
decoders.set("application/jsonc", decodeJsonc);
decoders.set("application/msgpack", decodeMsgpack);
decoders.set("application/toml", decodeToml);
decoders.set("application/x-toml", decodeToml);
decoders.set("application/yaml", decodeYaml);
decoders.set("application/x-yaml", decodeYaml);
decoders.set("application/cbor", decodeCbor);
decoders.set("application/x-cbor", decodeCbor);
decoders.set("application/json5", decodeJson5);
decoders.set("application/x-json5", decodeJson5);

export async function receive<Schema extends ZodType>(
  request: Request,
  schema?: Schema,
): Promise<z.infer<Schema>> {
  const body = streamOfRequestBody(request);

  if (!body) {
    throw new ResponseError(
      Response.json({ error: "missing body" }, { status: 400 }),
      "missing body",
    );
  }

  const [contentType, contentTypeOptions] = parseMediaType(
    request.headers.get("content-type") || "",
  );

  const { charset } = contentTypeOptions || {};

  if (!contentType) {
    throw new ResponseError(
      Response.json({ error: "missing content-type" }, { status: 400 }),
      "missing content-type",
    );
  }

  if (charset !== undefined && charset.toLowerCase() !== "utf-8") {
    throw new ResponseError(
      Response.json(
        { error: `unsupported charset: ${charset}` },
        { status: 415 },
      ),
      `unsupported charset: ${charset}`,
    );
  }

  const decoder = decoders.get(contentType.toLowerCase());

  if (!decoder) {
    throw new ResponseError(
      Response.json(
        { error: `unsupported content-type: ${contentType}` },
        { status: 415 },
      ),
      `unsupported content-type: ${contentType}`,
    );
  }

  const parsedData = await decoder(body);

  if (!schema) {
    return parsedData as z.infer<Schema>;
  }

  const result = schema.safeParse(parsedData);

  if (!result.success) {
    console.debug(
      "debug: validation errors on request payload: %o, errors: %o",
      parsedData,
      result.error.issues,
    );
    throw new ResponseError(
      Response.json(
        { error: "invalid request payload", details: result.error.issues },
        { status: 400 },
      ),
      "invalid request payload",
    );
  }

  return result.data;
}

const encoders = new Map<
  string,
  (
    // deno-lint-ignore no-explicit-any
    data: any,
  ) => ReadableStream<Uint8Array> | Blob | string | Uint8Array
>();

export function encodeJson(data: unknown): string {
  return JSON.stringify(data);
}

export function encodeMsgpack(data: MsgpackType): Uint8Array {
  return new Uint8Array(bytifyMsgpack(data));
}

export function encodeToml(data: Record<string, unknown>): string {
  return stringifyToml(data);
}

export function encodeYaml(data: unknown): string {
  return stringifyYaml(data);
}

export function encodeCbor(data: CborType): Uint8Array {
  return new Uint8Array(bytifyCbor(data));
}

export function encodeJson5(data: unknown): string {
  return json5.stringify(data);
}

encoders.set("application/json", encodeJson);
encoders.set("application/msgpack", encodeMsgpack);
encoders.set("application/x-msgpack", encodeMsgpack);
encoders.set("application/toml", encodeToml);
encoders.set("application/x-toml", encodeToml);
encoders.set("application/yaml", encodeYaml);
encoders.set("application/x-yaml", encodeYaml);
encoders.set("application/cbor", encodeCbor);
encoders.set("application/x-cbor", encodeCbor);
encoders.set("application/json5", encodeJson5);
encoders.set("application/x-json5", encodeJson5);

const acceptsSymbol = Symbol("accepts");

export function assertAcceptsSupported(
  request: Request,
): void {
  const contentType = accepts(request, ...Array.from(encoders.keys()));
  if (!contentType) {
    throw new ResponseError(
      Response.json(
        { error: "no acceptable content-type found" },
        { status: 406 },
      ),
      "no acceptable content-type found",
    );
  }
  // deno-lint-ignore no-explicit-any
  (request as any)[acceptsSymbol] = contentType;
}

export function send(
  request: Request,
  // deno-lint-ignore no-explicit-any
  data: any,
  responseInit?: ResponseInit,
): Response {
  // deno-lint-ignore no-explicit-any
  const contentType = (request as any)[acceptsSymbol] ||
    accepts(request, ...Array.from(encoders.keys()));

  if (!contentType) {
    throw new ResponseError(
      Response.json(
        { error: "no acceptable content-type found" },
        { status: 406 },
      ),
      "no acceptable content-type found",
    );
  }

  const encoder = encoders.get(contentType.toLowerCase())!;

  const headers = new Headers(responseInit?.headers);
  headers.set("Content-Type", contentType);

  return new Response(encoder(data), {
    status: responseInit?.status ?? 200,
    statusText: responseInit?.statusText,
    headers,
  });
}

export function none(responseInit?: ResponseInit): Response {
  return new Response(null, {
    status: responseInit?.status ?? 204,
    statusText: responseInit?.statusText,
    headers: responseInit?.headers,
  });
}

export function createRouter(
  routes: Routes,
): (
  ctx: Record<string, unknown>,
  request: Request,
  info: Deno.ServeHandlerInfo<Deno.NetAddr>,
) => Promise<Response> {
  const map = compileRoutes(routes);
  return async (ctx, request, info) => await router(map, request, info, ctx);
}

async function router(
  map: Map<URLPattern, Handler>,
  request: Request,
  info: Deno.ServeHandlerInfo<Deno.NetAddr>,
  ctx?: unknown,
): Promise<Response> {
  if (request.headers.has("Accept")) {
    try {
      assertAcceptsSupported(request);
    } catch (error) {
      return (error as ResponseError).response;
    }
  }

  const url = new URL(request.url);

  console.debug("debug: routing request for '%s'", url.pathname);

  for (const [pattern, handler] of map) {
    console.debug("debug:     testing pattern '%s'", pattern.pathname);
    if (!pattern.test(url)) continue;

    const result = pattern.exec(url);
    if (!result) continue;

    const params = result.pathname.groups;
    try {
      return await handler(ctx, request, params, info) || none();
    } catch (error) {
      if (error instanceof Response) {
        return error;
      } else if (error instanceof ResponseError) {
        return error.response;
      }

      throw error;
    }
  }

  return Response.json({ error: "not found" }, { status: 404 });
}
