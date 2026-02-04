/**
 * Unit tests for config loading.
 */

import { loadConfig } from "../../../src/config";

describe("loadConfig", () => {
  it("returns config with default pipeline values", () => {
    const config = loadConfig();
    // Avoid asserting exact defaults because loadConfig reads from process.env/.env.local.
    expect(config.pipeline.vadSilenceMs).toBeGreaterThan(0);
    expect(config.pipeline.maxTurnsInMemory).toBeGreaterThan(0);
  });
  it("returns podium urls", () => {
    const config = loadConfig();
    expect(config.podium.apiUrl).toBeDefined();
    expect(config.podium.wsAddress).toBeDefined();
    expect(config.podium.outpostServer).toBeDefined();
  });
});
