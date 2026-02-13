import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetGlobalHookRunner } from "./hook-runner-global.js";
import { loadOpenClawPlugins, clearPluginCaches } from "./loader.js";
import { reloadPlugins } from "./reloader.js";
import { getActivePluginRegistry } from "./runtime.js";

const EMPTY_PLUGIN_SCHEMA = { type: "object", additionalProperties: false, properties: {} };
const tempDirs: string[] = [];
const prevBundledDir = process.env.OPENCLAW_BUNDLED_PLUGINS_DIR;

function makeTempDir() {
  const dir = path.join(os.tmpdir(), `openclaw-reload-test-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function writePlugin(dir: string, id: string, body: string) {
  const file = path.join(dir, `${id}.js`);
  fs.writeFileSync(file, body, "utf-8");
  fs.writeFileSync(
    path.join(dir, "openclaw.plugin.json"),
    JSON.stringify({ id, configSchema: EMPTY_PLUGIN_SCHEMA }, null, 2),
  );
  return file;
}

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
  process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = prevBundledDir;
  resetGlobalHookRunner();
});

describe("clearPluginCaches", () => {
  it("clears the registry cache so next load is fresh", () => {
    const dir = makeTempDir();
    writePlugin(dir, "test-clear", `module.exports = { register() {} };`);
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = "";

    const reg1 = loadOpenClawPlugins({
      config: { plugins: { loadPaths: [dir] } },
      cache: true,
    });

    // Same call with cache=true should return same reference
    const reg2 = loadOpenClawPlugins({
      config: { plugins: { loadPaths: [dir] } },
      cache: true,
    });
    expect(reg2).toBe(reg1);

    // After clearing, should get a new registry
    clearPluginCaches();
    resetGlobalHookRunner();
    const reg3 = loadOpenClawPlugins({
      config: { plugins: { loadPaths: [dir] } },
      cache: true,
    });
    expect(reg3).not.toBe(reg1);
  });
});

describe("reloadPlugins", () => {
  it("returns ok:true and reloads plugins from scratch", () => {
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = "";

    const result = reloadPlugins({
      config: {},
      workspaceDir: os.tmpdir(),
    });

    expect(result.ok).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.pluginCount).toBe("number");
    expect(typeof result.hookCount).toBe("number");
    expect(result.registry).toBeDefined();
  });

  it("produces a fresh registry after reload (not same reference)", () => {
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = "";

    const reg1 = loadOpenClawPlugins({ config: {}, cache: false });

    const result = reloadPlugins({
      config: {},
      workspaceDir: os.tmpdir(),
    });

    expect(result.ok).toBe(true);
    expect(result.registry).not.toBe(reg1);
    expect(result.registry!.plugins.length).toBe(reg1.plugins.length);
  });

  it("succeeds with empty config", () => {
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = "";

    const result = reloadPlugins({
      config: {},
      workspaceDir: "/nonexistent-path-" + randomUUID(),
    });

    expect(result.ok).toBe(true);
    expect(typeof result.pluginCount).toBe("number");
  });

  it("updates the active global registry", () => {
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = "";

    loadOpenClawPlugins({ config: {} });
    const before = getActivePluginRegistry();

    const result = reloadPlugins({
      config: {},
      workspaceDir: os.tmpdir(),
    });

    const after = getActivePluginRegistry();
    expect(result.ok).toBe(true);
    expect(after).not.toBe(before);
    expect(after).toBe(result.registry);
  });
});
