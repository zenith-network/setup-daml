import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DpmRelease, downloadDpm } from "../src/dpm";
import { setup } from "../src/setup";

const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn<typeof fetch>(),
}));
vi.mock("@actions/github/lib/utils", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@actions/github/lib/utils")>();
  return {
    ...original,
    GitHub: original.GitHub.defaults({ request: { fetch: apiFetch } }),
  };
});
vi.mock("@actions/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@actions/core")>()),
  exportVariable: vi.fn((name: string, value: string) =>
    vi.stubEnv(name, value),
  ),
  addPath: vi.fn((directory: string) =>
    vi.stubEnv(
      "PATH",
      `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
    ),
  ),
  setOutput: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("@actions/tool-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@actions/tool-cache")>()),
  downloadTool: vi.fn(),
}));

const fakeDpm = String.raw`#!/bin/sh
set -eu
if [ "$1" = --version ]; then
  printf '%s\n' "$0" >> "$DPM_HOME/version-checks"
  version="$FAKE_DPM_VERSION"
  if [ -z "$version" ]; then version=1.0.22; fi
  printf 'version: %s\n' "$version"
elif [ "$1" = install ] && [ "$2" = -- ]; then
  mkdir -p "$DPM_HOME/bin"
  if [ -e "$DPM_HOME/bin/dpm" ]; then
    printf 'DPM was placed before SDK installation\n' >&2
    exit 8
  fi
  printf '%s' "$0" > "$DPM_HOME/install-executable"
  printf '["%s","%s","%s"]' "$1" "$2" "$3" > "$DPM_HOME/install-args.json"
  printf 'SDK-owned DPM 9.9.9' > "$DPM_HOME/sdk-dpm"
  rm -f "$DPM_HOME/bin/dpm"
  ln -s "$DPM_HOME/sdk-dpm" "$DPM_HOME/bin/dpm"
  if [ "$3" = broken ]; then
    printf 'SDK installation failed\n' >&2
    exit 7
  fi
  if [ "$3" != no-version ]; then
    printf 'resolved to 3.5.9\r\n' >&2
    printf 'Successfully installed SDK 3.5.9\r\n'
  fi
else
  exit 2
fi
`;

describe("setup with real archives and executable fixtures", () => {
  let directory: string;
  let runnerTemp: string;
  let archive: string;
  let home: string;
  let release: DpmRelease;
  const download = vi.mocked(tc.downloadTool);

  beforeEach(async () => {
    vi.clearAllMocks();
    directory = await mkdtemp(path.join(os.tmpdir(), "setup-daml tests "));
    runnerTemp = path.join(directory, "runner temp");
    home = path.join(runnerTemp, "dpm");
    await mkdir(runnerTemp);
    vi.stubEnv("RUNNER_TEMP", runnerTemp);
    vi.stubEnv("INPUT_DPM-VERSION", "1.0.22");
    vi.stubEnv("INPUT_SDK-VERSION", "");
    vi.stubEnv("INPUT_DPM-REGISTRY", "");
    vi.stubEnv("INPUT_GITHUB-TOKEN", "");
    vi.stubEnv("FAKE_DPM_VERSION", "");
    release = {
      tag_name: "1.0.22",
      assets: [
        "dpm-1.0.22-linux-amd64.tar.gz",
        "dpm-1.0.22-linux-arm64.tar.gz",
        "dpm-1.0.22-checksums.txt",
      ].map((name) => ({
        name,
        browser_download_url: `https://github.com/digital-asset/dpm/releases/download/fixture/${name}`,
      })),
    };
    apiFetch.mockImplementation(
      async () =>
        new Response(JSON.stringify(release), {
          headers: { "content-type": "application/json" },
        }),
    );
    await writeFile(path.join(directory, "dpm"), fakeDpm);
    archive = path.join(directory, "fixture.tar.gz");
    await promisify(execFile)("tar", ["-czf", archive, "-C", directory, "dpm"]);
    download.mockImplementation(async (url, destination) => {
      if (!destination) throw new Error("Expected a download destination");
      if (url.endsWith("checksums.txt")) {
        const digest = createHash("sha256")
          .update(await readFile(archive))
          .digest("hex");
        await writeFile(
          destination,
          ["linux-amd64", "linux-arm64", "darwin-amd64"]
            .map((platform) => `${digest}  dpm-1.0.22-${platform}.tar.gz\n`)
            .join(""),
        );
      } else {
        await copyFile(archive, destination);
      }
      return destination;
    });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  async function expectRestored(): Promise<void> {
    const binary = path.join(home, "bin", "dpm");
    expect((await lstat(binary)).isFile()).toBe(true);
    expect(await readFile(binary, "utf8")).toBe(fakeDpm);
    expect((await lstat(binary)).mode & 0o777).toBe(0o755);
    expect(await readFile(path.join(home, "sdk-dpm"), "utf8")).toBe(
      "SDK-owned DPM 9.9.9",
    );
    expect(await readdir(path.join(home, "bin"))).toEqual(["dpm"]);
    expect(await readdir(runnerTemp)).toEqual(["dpm"]);
  }

  it("installs only DPM and preserves an inherited registry", async () => {
    vi.stubEnv("DPM_REGISTRY", "existing.example/registry");
    await setup();
    expect(core.exportVariable).toHaveBeenCalledWith("DPM_HOME", home);
    expect(core.addPath).toHaveBeenCalledWith(path.join(home, "bin"));
    expect(process.env.DPM_REGISTRY).toBe("existing.example/registry");
    expect(core.setOutput).toHaveBeenCalledWith("dpm-version", "1.0.22");
    expect(core.setOutput).toHaveBeenCalledWith("sdk-version", "");
    expect(await readFile(path.join(home, "version-checks"), "utf8")).toBe(
      `${path.join(home, "bin", "dpm")}\n`,
    );
    expect(await readdir(runnerTemp)).toEqual(["dpm"]);
    expect(download.mock.calls[0]?.[0]).toBe(
      `https://github.com/digital-asset/dpm/releases/download/fixture/dpm-1.0.22-linux-${process.arch === "arm64" ? "arm64" : "amd64"}.tar.gz`,
    );
  });

  it.each(["amd64", "arm64"] as const)(
    "downloads the %s archive and checksums from their browser URLs",
    async (architecture) => {
      const destination = await mkdtemp(path.join(runnerTemp, "downloads-"));
      await downloadDpm(release, architecture, destination);
      expect(download.mock.calls).toEqual([
        [
          `https://github.com/digital-asset/dpm/releases/download/fixture/dpm-1.0.22-linux-${architecture}.tar.gz`,
          path.join(destination, `dpm-1.0.22-linux-${architecture}.tar.gz`),
        ],
        [
          "https://github.com/digital-asset/dpm/releases/download/fixture/dpm-1.0.22-checksums.txt",
          path.join(destination, "dpm-1.0.22-checksums.txt"),
        ],
      ]);
    },
  );

  it("fails before downloading when the required archive is absent", async () => {
    release.assets = release.assets.filter((asset) =>
      asset.name.endsWith(".txt"),
    );
    await expect(setup()).rejects.toThrow("does not provide dpm-1.0.22-linux-");
    expect(download).not.toHaveBeenCalled();
    expect(core.setOutput).not.toHaveBeenCalled();
    expect(await readdir(runnerTemp)).toEqual([]);
  });

  it("warns before downloading when the release has no checksum asset", async () => {
    release.assets = release.assets.filter(
      (asset) => !asset.name.endsWith(".txt"),
    );
    await setup();
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("without checksum verification"),
    );
    expect(vi.mocked(core.warning).mock.invocationCallOrder[0]).toBeLessThan(
      download.mock.invocationCallOrder[0] ?? 0,
    );
    expect(download).toHaveBeenCalledOnce();
    expect(core.setOutput).toHaveBeenCalledWith("dpm-version", "1.0.22");
  });

  it.each([
    "3.5.9",
    "3.5.9-rc.1",
    "3.5.0-snapshot.20260408.13716.0.vb941c9f0",
    "latest",
    "mainnet",
    "testnet",
    "--literal-tag",
  ])("restores pinned DPM after installing SDK request %s", async (request) => {
    vi.stubEnv("INPUT_SDK-VERSION", request);
    vi.stubEnv("INPUT_DPM-REGISTRY", "ghcr.io/custom");
    await setup();
    expect(process.env.DPM_REGISTRY).toBe("ghcr.io/custom");
    expect(core.setOutput).toHaveBeenCalledWith("sdk-version", "3.5.9");
    expect(await readFile(path.join(home, "version-checks"), "utf8")).toBe(
      `${path.join(home, "bin", "dpm")}\n`,
    );
    const executable = await readFile(
      path.join(home, "install-executable"),
      "utf8",
    );
    expect(executable).toMatch(/^.*\/setup-daml-[^/]+\/dpm$/);
    expect(path.dirname(path.dirname(executable))).toBe(runnerTemp);
    expect(
      JSON.parse(await readFile(path.join(home, "install-args.json"), "utf8")),
    ).toEqual(["install", "--", request]);
    await expectRestored();
  });

  it("restores pinned DPM and removes temporary files when SDK installation fails", async () => {
    vi.stubEnv("INPUT_SDK-VERSION", "broken");
    await expect(setup()).rejects.toThrow("exit code 7");
    expect(core.setOutput).not.toHaveBeenCalled();
    await expectRestored();
  });

  it("restores pinned DPM when SDK version output is missing", async () => {
    vi.stubEnv("INPUT_SDK-VERSION", "no-version");
    await expect(setup()).rejects.toThrow(
      "Could not determine the installed Daml SDK version",
    );
    await expectRestored();
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it("warns and proceeds only for a checksum-file HTTP 404", async () => {
    const normalDownload = download.getMockImplementation();
    download.mockImplementation(async (...args) => {
      if (args[0].endsWith("checksums.txt")) throw new tc.HTTPError(404);
      if (!normalDownload) throw new Error("Missing download fixture");
      return normalDownload(...args);
    });
    await setup();
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("without checksum verification"),
    );
    expect(core.setOutput).toHaveBeenCalledWith("dpm-version", "1.0.22");
  });

  it.each([
    new tc.HTTPError(403),
    new tc.HTTPError(500),
    new Error("network unavailable"),
  ])("fails on other checksum download errors", async (error) => {
    const normalDownload = download.getMockImplementation();
    download.mockImplementation(async (...args) => {
      if (args[0].endsWith("checksums.txt")) throw error;
      if (!normalDownload) throw new Error("Missing download fixture");
      return normalDownload(...args);
    });
    await expect(setup()).rejects.toThrow(error.message);
    expect(core.warning).not.toHaveBeenCalled();
    expect(core.setOutput).not.toHaveBeenCalled();
    expect(await readdir(runnerTemp)).toEqual([]);
  });

  it("does not execute an archive with a mismatched checksum", async () => {
    const normalDownload = download.getMockImplementation();
    download.mockImplementation(async (...args) => {
      const result = await normalDownload?.(...args);
      if (!result) throw new Error("Missing download fixture");
      if (args[0].endsWith("checksums.txt")) {
        await writeFile(
          result,
          `${"0".repeat(64)}  dpm-1.0.22-linux-${process.arch === "arm64" ? "arm64" : "amd64"}.tar.gz`,
        );
      }
      return result;
    });
    await expect(setup()).rejects.toThrow("exit code 1");
    expect(await readdir(runnerTemp)).toEqual([]);
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it("fails and cleans up a corrupt archive", async () => {
    await writeFile(archive, "not a tar archive");
    await expect(setup()).rejects.toThrow();
    expect(await readdir(runnerTemp)).toEqual([]);
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it("rejects an unexpected installed DPM version", async () => {
    vi.stubEnv("FAKE_DPM_VERSION", "9.9.9");
    await expect(setup()).rejects.toThrow(
      "Expected DPM 1.0.22, but installed DPM reports 9.9.9",
    );
    expect(core.setOutput).not.toHaveBeenCalled();
    expect(await readdir(runnerTemp)).toEqual(["dpm"]);
  });
});
