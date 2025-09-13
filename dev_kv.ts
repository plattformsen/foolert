import { fromFileUrl } from "@std/path";
import { setKv } from "./kv.ts";

const path = fromFileUrl(import.meta.resolve("./kv.db"));
console.debug("debug: Opening KV at %s", path);
setKv(await Deno.openKv(path));
