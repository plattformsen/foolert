import { createRouter, defineGroup } from "../web_util.ts";

import api from "./api/mod.ts";

export default createRouter(defineGroup("", [api]));
