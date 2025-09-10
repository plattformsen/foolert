import { setKv } from "./kv.ts";

const path = import.meta.resolve("./kv.db").substring(7);
console.debug("debug: Opening KV at %s", path);
setKv(await Deno.openKv(path));
