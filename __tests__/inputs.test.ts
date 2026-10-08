import * as core from "@actions/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getArchitecture, loadInputs } from "../src/inputs";

vi.mock("@actions/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@actions/core")>()),
  setSecret: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RUNNER_TEMP", "/tmp/setup-daml");
  for (const name of [
    "DPM-VERSION",
    "SDK-VERSION",
    "DPM-REGISTRY",
    "GITHUB-TOKEN",
  ]) {
    vi.stubEnv(`INPUT_${name}`, "");
  }
});

afterEach(() => vi.unstubAllEnvs());

describe("runner support", () => {
  it.each([
    ["x64", "amd64"],
    ["arm64", "arm64"],
  ])("maps Linux %s to %s", (arch, expected) => {
    expect(getArchitecture("linux", arch)).toBe(expected);
  });

  it.each(["darwin", "win32"])("rejects %s", (platform) => {
    expect(() => getArchitecture(platform, "x64")).toThrow(
      "only supported on Linux",
    );
  });

  it("rejects unsupported architectures", () => {
    expect(() => getArchitecture("linux", "ia32")).toThrow(
      "Unsupported architecture: ia32",
    );
  });
});

describe("inputs", () => {
  it("defaults to latest DPM without an SDK or registry override", () => {
    expect(loadInputs()).toMatchObject({
      dpmVersion: "latest",
      sdkVersion: "",
      dpmRegistry: "",
      githubToken: "",
    });
  });

  it("reads and masks an optional GitHub token", () => {
    vi.stubEnv("INPUT_GITHUB-TOKEN", " test-token ");
    expect(loadInputs().githubToken).toBe("test-token");
    expect(core.setSecret).toHaveBeenCalledWith("test-token");
  });

  it("accepts a prerelease, SDK tag and registry", () => {
    vi.stubEnv("INPUT_DPM-VERSION", " 1.0.22-rc.1+build.7 ");
    vi.stubEnv("INPUT_SDK-VERSION", " latest ");
    vi.stubEnv("INPUT_DPM-REGISTRY", " ghcr.io/example ");
    expect(loadInputs()).toMatchObject({
      dpmVersion: "1.0.22-rc.1+build.7",
      sdkVersion: "latest",
      dpmRegistry: "ghcr.io/example",
    });
  });

  it.each(["v1.0.22", "1.0", "../1.0.22", "1.0.22;echo bad"])(
    "rejects DPM release %s",
    (version) => {
      vi.stubEnv("INPUT_DPM-VERSION", version);
      expect(() => loadInputs()).toThrow("Invalid DPM release version");
    },
  );

  it.each(["DPM-VERSION", "SDK-VERSION", "DPM-REGISTRY", "GITHUB-TOKEN"])(
    "rejects multiline INPUT_%s before trimming",
    (name) => {
      vi.stubEnv(`INPUT_${name}`, "latest\n");
      expect(() => loadInputs()).toThrow(
        "must not contain newline or null characters",
      );
    },
  );

  it.each([undefined, "", "relative/path", "/tmp/bad\rpath"])(
    "rejects invalid RUNNER_TEMP %s",
    (directory) => {
      vi.stubEnv("RUNNER_TEMP", directory);
      expect(() => loadInputs()).toThrow("RUNNER_TEMP");
    },
  );
});
