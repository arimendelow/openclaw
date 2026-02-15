import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  loadOpenClawPlugins: vi.fn(),
  clearPluginLoaderCache: vi.fn(),
  getActivePluginRegistry: vi.fn(),
}));

vi.mock("./loader.js", () => ({
  loadOpenClawPlugins: hoisted.loadOpenClawPlugins,
  clearPluginLoaderCache: hoisted.clearPluginLoaderCache,
}));

vi.mock("./runtime.js", () => ({
  getActivePluginRegistry: hoisted.getActivePluginRegistry,
}));

import { reloadOpenClawPlugins } from "./reloader.js";

describe("reloadOpenClawPlugins", () => {
  beforeEach(() => {
    hoisted.loadOpenClawPlugins.mockReset();
    hoisted.clearPluginLoaderCache.mockReset();
    hoisted.getActivePluginRegistry.mockReset();
  });

  it("clears loader cache and forces non-cached plugin load", () => {
    hoisted.getActivePluginRegistry.mockReturnValue({ plugins: [] });
    hoisted.loadOpenClawPlugins.mockReturnValue({ plugins: [], gatewayHandlers: {} });

    reloadOpenClawPlugins({
      config: {},
      workspaceDir: "/tmp/ws",
      coreGatewayHandlers: {},
    });

    expect(hoisted.clearPluginLoaderCache).toHaveBeenCalledTimes(1);
    expect(hoisted.loadOpenClawPlugins).toHaveBeenCalledWith(
      expect.objectContaining({
        cache: false,
        workspaceDir: "/tmp/ws",
      }),
    );
  });
});
