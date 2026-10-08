import { describe, expect, it } from "vitest";
import { parseDpmVersion, parseSdkVersion } from "../src/versions";

describe("installed versions", () => {
  it("reads DPM version metadata", () => {
    expect(parseDpmVersion("version: 1.0.22\r\nbuild: abc\r\n")).toBe("1.0.22");
  });

  it.each(["", "build: abc", "version: unknown"])(
    "rejects missing or invalid DPM metadata: %s",
    (output) => {
      expect(() => parseDpmVersion(output)).toThrow();
    },
  );

  it("prefers SDK completion over resolution across both output streams", () => {
    expect(
      parseSdkVersion(
        "Successfully installed SDK 3.5.9\r\n\nresolved to 3.5.8\r\n",
      ),
    ).toBe("3.5.9");
  });

  it("reads resolution-only output from older DPM releases", () => {
    expect(
      parseSdkVersion("resolving sdk version...\nresolved to 3.5.9-rc.1\n"),
    ).toBe("3.5.9-rc.1");
  });

  it("uses the final completion message", () => {
    expect(
      parseSdkVersion(
        "Successfully installed SDK 3.5.8\nSuccessfully installed SDK 3.5.9\n",
      ),
    ).toBe("3.5.9");
  });

  it.each(["download complete", "Successfully installed SDK unknown"])(
    "rejects missing or invalid SDK output: %s",
    (output) => {
      expect(() => parseSdkVersion(output)).toThrow();
    },
  );
});
