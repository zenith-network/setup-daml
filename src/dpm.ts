import { randomUUID } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { GitHub } from "@actions/github/lib/utils";
import * as tc from "@actions/tool-cache";
import type { Architecture } from "./inputs";
import { parseDpmVersion, validateVersion } from "./versions";

export interface DpmRelease {
  tag_name: string;
  assets: { name: string; browser_download_url: string }[];
}

export async function resolveDpmVersion(
  request: string,
  githubToken: string,
): Promise<DpmRelease> {
  const client = new GitHub({
    auth: githubToken || undefined,
    baseUrl: "https://api.github.com",
    userAgent: "setup-daml",
  });
  const repository = {
    owner: "digital-asset",
    repo: "dpm",
  };
  const { data } =
    request === "latest"
      ? await client.rest.repos.getLatestRelease(repository)
      : await client.rest.repos.getReleaseByTag({
          ...repository,
          tag: request,
        });
  validateVersion(data.tag_name, "DPM release");
  return data;
}

export async function verifyChecksum(checksumsPath: string): Promise<void> {
  await exec.exec(
    "sha256sum",
    [
      "--check",
      "--strict",
      "--quiet",
      "--ignore-missing",
      path.basename(checksumsPath),
    ],
    { cwd: path.dirname(checksumsPath) },
  );
}

export async function downloadDpm(
  release: DpmRelease,
  architecture: Architecture,
  directory: string,
): Promise<string> {
  const { tag_name: version, assets } = release;
  const archiveName = `dpm-${version}-linux-${architecture}.tar.gz`;
  const checksumName = `dpm-${version}-checksums.txt`;
  const archive = assets.find((asset) => asset.name === archiveName);
  if (!archive) {
    throw new Error(`DPM ${version} does not provide ${archiveName}`);
  }
  const checksums = assets.find((asset) => asset.name === checksumName);
  const checksumWarning = `DPM ${version} does not provide a checksum file; proceeding without checksum verification`;
  if (!checksums) core.warning(checksumWarning);

  const archivePath = await tc.downloadTool(
    archive.browser_download_url,
    path.join(directory, archiveName),
  );
  if (checksums) {
    try {
      const checksumsPath = await tc.downloadTool(
        checksums.browser_download_url,
        path.join(directory, checksumName),
      );
      await verifyChecksum(checksumsPath);
    } catch (error: unknown) {
      if (!(error instanceof tc.HTTPError) || error.httpStatusCode !== 404) {
        throw error;
      }
      core.warning(checksumWarning);
    }
  }

  // Extract only the executable, preserving a pristine copy for SDK installation.
  await exec.exec("tar", ["-xzf", archivePath, "-C", directory, "dpm"]);
  const binary = path.join(directory, "dpm");
  if (!(await lstat(binary)).isFile()) {
    throw new Error("The DPM archive did not contain a regular dpm executable");
  }
  await chmod(binary, 0o755);
  return binary;
}

export async function placeDpm(
  source: string,
  destination: string,
): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const staged = path.join(path.dirname(destination), `.dpm-${randomUUID()}`);
  try {
    await copyFile(source, staged);
    await chmod(staged, 0o755);
    // Rename replaces the SDK-created symlink rather than writing through it.
    await rename(staged, destination);
  } finally {
    await rm(staged, { force: true });
  }
}

// check that dpm --version actually shows expected version
export async function verifyDpmVersion(expected: string): Promise<string> {
  const { stdout, stderr } = await exec.getExecOutput("dpm", ["--version"], {
    silent: true,
  });
  const actual = parseDpmVersion(`${stdout}\n${stderr}`);
  if (actual !== expected) {
    throw new Error(
      `Expected DPM ${expected}, but installed DPM reports ${actual}`,
    );
  }
  return actual;
}
