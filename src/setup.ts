import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import * as core from "@actions/core";
import {
  downloadDpm,
  placeDpm,
  resolveDpmVersion,
  verifyDpmVersion,
} from "./dpm";
import { loadInputs } from "./inputs";
import { installSdk } from "./sdk";

export async function setup(): Promise<void> {
  const inputs = loadInputs();
  const release = await resolveDpmVersion(
    inputs.dpmVersion,
    inputs.githubToken,
  );
  const version = release.tag_name;
  const home = path.join(inputs.runnerTemp, "dpm");
  const binary = path.join(home, "bin", "dpm");
  core.exportVariable("DPM_HOME", home);
  if (inputs.dpmRegistry) {
    core.exportVariable("DPM_REGISTRY", inputs.dpmRegistry);
  }
  core.addPath(path.dirname(binary));

  const temporary = await mkdtemp(path.join(inputs.runnerTemp, "setup-daml-"));
  try {
    core.info(`Installing DPM ${version} (linux-${inputs.architecture})`);
    const pristine = await downloadDpm(release, inputs.architecture, temporary);

    let sdkVersion = "";
    try {
      if (inputs.sdkVersion) {
        sdkVersion = await installSdk(inputs.sdkVersion, temporary);
      }
    } finally {
      // Replace any SDK-created symlink, even if SDK installation failed.
      await placeDpm(pristine, binary);
    }
    await verifyDpmVersion(version);

    core.setOutput("dpm-version", version);
    core.setOutput("sdk-version", sdkVersion);
    core.info(`DPM: ${version}\nDaml SDK: ${sdkVersion || "not installed"}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
