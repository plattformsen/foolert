import { addShutdownListener } from "./shutdown.ts";

let kv: Deno.Kv | undefined;

export function setKv(db: Deno.Kv) {
  if (kv) {
    throw new Error("kv is already set");
  }
  kv = db;
}

export async function getKv(): Promise<Deno.Kv> {
  if (!kv) {
    kv = await Deno.openKv();
  }
  return kv;
}

export function closeKv() {
  if (kv) {
    kv.close();
    kv = undefined;
  }
}

addShutdownListener(() => {
  closeKv();
});
