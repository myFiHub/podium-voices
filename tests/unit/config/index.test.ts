/**
 * Unit tests for config loading.
 */

import { loadConfig } from "../../../src/config";

describe("loadConfig", () => {
  it("returns config with default pipeline values", () => {
    const config = loadConfig();
    expect(config.pipeline.vadSilenceMs).toBeGreaterThanOrEqual(500);
    expect(config.pipeline.maxTurnsInMemory).toBeGreaterThanOrEqual(50);
  });
  it("returns podium urls", () => {
    const config = loadConfig();
    expect(config.podium.apiUrl).toBeDefined();
    expect(config.podium.wsAddress).toBeDefined();
    expect(config.podium.outpostServer).toBeDefined();
  });
});
