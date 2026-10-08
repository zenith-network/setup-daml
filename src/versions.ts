// semver-like
const versionPattern =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function validateVersion(value: string, label: string): string {
  if (/\s/.test(value) || !versionPattern.test(value)) {
    throw new Error(`Invalid ${label} version: ${value}`);
  }
  return value;
}

export function parseDpmVersion(output: string): string {
  const version = /^version:\s*([^\r\n]+)$/m.exec(output)?.[1]?.trim();
  if (!version) {
    throw new Error("Could not determine the installed DPM version");
  }
  return validateVersion(version, "installed DPM");
}

export function parseSdkVersion(output: string): string {
  // Prefer the completion message; some releases report only the resolution.
  const installed = [
    ...output.matchAll(/^Successfully installed SDK (\S+)\r?$/gm),
  ].at(-1)?.[1];
  const resolved = [...output.matchAll(/^resolved to (\S+)\r?$/gm)].at(-1)?.[1];
  const version = installed ?? resolved;
  if (!version) {
    throw new Error("Could not determine the installed Daml SDK version");
  }
  return validateVersion(version, "installed Daml SDK");
}
