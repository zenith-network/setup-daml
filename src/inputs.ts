import path from "node:path";
import * as core from "@actions/core";
import { validateVersion } from "./versions";

// Currently only ADM64 and ARM64 are supported
export type Architecture = "amd64" | "arm64";

export interface SetupInputs {
  dpmVersion: string;
  sdkVersion: string;
  dpmRegistry: string;
  githubToken: string;
  runnerTemp: string;
  architecture: Architecture;
}

export function getArchitecture(platform: string, arch: string): Architecture {
  if (platform !== "linux") {
    throw new Error(
      `DPM installation is only supported on Linux (received ${platform})`,
    );
  }
  switch (arch) {
    case "x64":
      return "amd64";
    case "arm64":
      return "arm64";
    default:
      throw new Error(`Unsupported architecture: ${arch}`);
  }
}

// validate that value doesn't contain newlines or NULs
function singleLine(value: string, name: string): string {
  if (/[\r\n\0]/.test(value)) {
    throw new Error(`${name} must not contain newline or null characters`);
  }
  return value;
}

function input(name: string): string {
  return singleLine(
    core.getInput(name, { trimWhitespace: false }),
    name,
  ).trim();
}

export function loadInputs(): SetupInputs {
  const architecture = getArchitecture(process.platform, process.arch);
  const dpmVersion = input("dpm-version") || "latest";
  const sdkVersion = input("sdk-version");
  const dpmRegistry = input("dpm-registry");
  const githubToken = input("github-token");
  if (githubToken) {
    core.setSecret(githubToken);
  }
  const runnerTemp = singleLine(process.env.RUNNER_TEMP ?? "", "RUNNER_TEMP");

  if (!runnerTemp || !path.isAbsolute(runnerTemp)) {
    throw new Error("RUNNER_TEMP must be set to an absolute directory path");
  }
  if (dpmVersion !== "latest") {
    validateVersion(dpmVersion, "DPM release");
  }

  return {
    dpmVersion,
    sdkVersion,
    dpmRegistry,
    githubToken,
    runnerTemp,
    architecture,
  };
}
