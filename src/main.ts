import * as core from "@actions/core";
import { setup } from "./setup";

void setup().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
