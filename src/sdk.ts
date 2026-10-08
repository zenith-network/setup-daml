import * as exec from "@actions/exec";
import { parseSdkVersion } from "./versions";

export async function installSdk(
  version: string,
  dpmDirectory: string,
): Promise<string> {
  const { stdout, stderr } = await exec.getExecOutput(
    "./dpm",
    ["install", "--", version],
    { cwd: dpmDirectory },
  );
  return parseSdkVersion(`${stdout}\n${stderr}`);
}
