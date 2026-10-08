import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DpmRelease, resolveDpmVersion, verifyChecksum } from "../src/dpm";

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

describe("release resolution", () => {
  beforeEach(() => vi.resetAllMocks());

  function release(tagName: string): DpmRelease {
    const data = {
      tag_name: tagName,
      assets: [
        {
          name: `dpm-${tagName}-linux-amd64.tar.gz`,
          browser_download_url: "https://github.com/downloads/archive.tar.gz",
        },
      ],
    };
    apiFetch.mockResolvedValue(
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    return data;
  }

  it("resolves an explicit version with its release assets", async () => {
    const data = release("1.0.22");
    expect(await resolveDpmVersion("1.0.22", "test-token")).toEqual(data);
    expect(apiFetch).toHaveBeenCalledOnce();
    expect(apiFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/digital-asset/dpm/releases/tags/1.0.22",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("resolves latest using the supplied token", async () => {
    const data = release("1.0.22");
    expect(await resolveDpmVersion("latest", "test-token")).toEqual(data);
    expect(apiFetch).toHaveBeenCalledOnce();
    expect(apiFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/digital-asset/dpm/releases/latest",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ authorization: "token test-token" }),
      }),
    );
  });

  it("uses the same API without authentication when the token is empty", async () => {
    const data = release("1.0.22");
    expect(await resolveDpmVersion("latest", "")).toEqual(data);
    expect(apiFetch).toHaveBeenCalledOnce();
    expect(apiFetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
      "authorization",
    );
  });

  it.each(["latest", "v1.0.22", "1.0.22\n", "../1.0.22"])(
    "rejects invalid release tag %s",
    async (tagName) => {
      release(tagName);
      await expect(resolveDpmVersion("latest", "")).rejects.toThrow(
        "Invalid DPM release version",
      );
    },
  );

  it.each([401, 403, 404, 429, 500])(
    "propagates API failure %s",
    async (status) => {
      apiFetch.mockResolvedValue(
        new Response(JSON.stringify({ message: "GitHub API failure" }), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
      await expect(resolveDpmVersion("latest", "test-token")).rejects.toThrow(
        "GitHub API failure",
      );
      expect(apiFetch).toHaveBeenCalledOnce();
    },
  );

  it("propagates network failure", async () => {
    apiFetch.mockRejectedValue(new Error("network unavailable"));
    await expect(resolveDpmVersion("latest", "")).rejects.toThrow(
      "network unavailable",
    );
  });
});

describe("checksum verification", () => {
  let directory: string;
  let archive: string;
  let checksums: string;
  const name = "dpm-1.0.22-linux-amd64.tar.gz";
  const digest = createHash("sha256").update("archive bytes").digest("hex");

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "setup-daml-checksum-"));
    archive = path.join(directory, name);
    checksums = path.join(directory, "checksums.txt");
    await writeFile(archive, "archive bytes");
  });
  afterEach(async () => rm(directory, { recursive: true, force: true }));

  it.each([`${digest}  ${name}\n`, `${digest.toUpperCase()} *${name}\r\n`])(
    "accepts a matching SHA-256 entry",
    async (content) => {
      await writeFile(checksums, `${digest}  other-archive.tar.gz\n${content}`);
      await expect(verifyChecksum(checksums)).resolves.toBeUndefined();
    },
  );

  it.each([
    `${"0".repeat(64)}  ${name}`,
    `invalid  ${name}`,
    `${digest}  another-file.tar.gz`,
    `${digest}  ${name}\nmalformed line\n`,
    "",
  ])("rejects incorrect, missing or malformed checksums", async (content) => {
    await writeFile(checksums, content);
    await expect(verifyChecksum(checksums)).rejects.toThrow("exit code 1");
  });
});
