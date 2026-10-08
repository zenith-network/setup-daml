import { rm } from "node:fs/promises";
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/setup.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node24",
  legalComments: "eof",
});

await rm("dist/main.js", { force: true });
