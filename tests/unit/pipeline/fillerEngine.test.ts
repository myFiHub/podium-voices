/**
 * Unit tests for FillerEngine (chooseFiller, streamFillerClip).
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { chooseFiller, streamFillerClip } from "../../../src/pipeline/fillerEngine";

describe("chooseFiller", () => {
  it("returns null when basePath has no persona dir", () => {
    const tmp = path.join(os.tmpdir(), "filler-test-none-" + Date.now());
    const result = chooseFiller({ basePath: tmp }, "default");
    expect(result).toBeNull();
  });

  it("returns null when manifest.json is missing", () => {
    const tmp = path.join(os.tmpdir(), "filler-test-nomanifest-" + Date.now());
    fs.mkdirSync(path.join(tmp, "default"), { recursive: true });
    const result = chooseFiller({ basePath: tmp }, "default");
    expect(result).toBeNull();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null when manifest has no clips", () => {
    const tmp = path.join(os.tmpdir(), "filler-test-empty-" + Date.now());
    const defaultDir = path.join(tmp, "default");
    fs.mkdirSync(defaultDir, { recursive: true });
    fs.writeFileSync(path.join(defaultDir, "manifest.json"), JSON.stringify({ clips: [] }), "utf8");
    const result = chooseFiller({ basePath: tmp }, "default");
    expect(result).toBeNull();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null when clip file does not exist", () => {
    const tmp = path.join(os.tmpdir(), "filler-test-noclip-" + Date.now());
    const defaultDir = path.join(tmp, "default");
    fs.mkdirSync(defaultDir, { recursive: true });
    fs.writeFileSync(
      path.join(defaultDir, "manifest.json"),
      JSON.stringify({ clips: [{ id: "ack", path: "missing.wav", lengthMs: 300 }] }),
      "utf8"
    );
    const result = chooseFiller({ basePath: tmp }, "default");
    expect(result).toBeNull();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns clip choice when manifest and file exist", () => {
    const projectRoot = path.resolve(__dirname, "../../..");
    const basePath = path.join(projectRoot, "assets", "fillers");
    if (!fs.existsSync(path.join(basePath, "default", "manifest.json"))) {
      return; // skip if assets not present
    }
    const result = chooseFiller({ basePath }, "default");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("clip");
    const r = result as { type: "clip"; path: string };
    expect(r.path).toContain("ack.wav");
  });
});

describe("streamFillerClip", () => {
  it("yields file contents in chunks and respects shouldAbort", async () => {
    const tmp = path.join(os.tmpdir(), "filler-stream-" + Date.now());
    fs.mkdirSync(tmp, { recursive: true });
    const filePath = path.join(tmp, "raw.pcm");
    const data = Buffer.alloc(100, 0x12);
    fs.writeFileSync(filePath, data);

    let aborted = false;
    const chunks: Buffer[] = [];
    for await (const chunk of streamFillerClip(filePath, 30, () => aborted)) {
      chunks.push(chunk);
      if (chunks.length >= 2) aborted = true;
    }
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(Buffer.concat(chunks).length).toBeLessThanOrEqual(100);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
