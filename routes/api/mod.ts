import { defineGroup, defineRoute } from "../../web_util.ts";

import get from "./get.ts";

const helloRoute = defineRoute("", {
  get,
});

export default defineGroup("/api", [
  // TODO: Add more API endpoints here
  helloRoute,
]);
