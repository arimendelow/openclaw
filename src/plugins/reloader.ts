/**
 * Plugin Hot-Reload Orchestrator
 *
 * Provides `reloadPlugins()` which:
 *  1. Clears all plugin caches (module cache, registry cache, global state)
 *  2. Re-discovers plugins from extension directories
 *  3. Re-loads them via jiti with fresh imports
 *  4. Resets and re-initialises the global hook runner
 *  5. Updates the global registry singleton
 *
 * Designed to be triggered by SIGUSR2 without disrupting active sessions.
 */

import type { OpenClawConfig } from "../config/config.js";
import type { GatewayRequestHandler } from "../gateway/server-methods/types.js";
import type { PluginRegistry } from "./registry.js";
import type { PluginLogger } from "./types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { clearPluginCommands } from "./commands.js";
import { discoverOpenClawPlugins } from "./discovery.js";
import { resetGlobalHookRunner } from "./hook-runner-global.js";
import { clearPluginCaches, loadOpenClawPlugins } from "./loader.js";

const log = createSubsystemLogger("plugin-reload");

export type ReloadPluginsOptions = {
  config: OpenClawConfig;
  workspaceDir: string;
  coreGatewayHandlers?: Record<string, GatewayRequestHandler>;
  logger?: PluginLogger;
};

export type ReloadResult = {
  ok: boolean;
  registry?: PluginRegistry;
  pluginCount?: number;
  hookCount?: number;
  error?: string;
  durationMs: number;
};

/**
 * Hot-reload all plugins.
 *
 * This is intentionally synchronous (matching loadOpenClawPlugins) but wrapped
 * in a function that returns a result object for the caller to log/handle.
 */
export function reloadPlugins(options: ReloadPluginsOptions): ReloadResult {
  const start = performance.now();
  const logger = options.logger ?? {
    info: (msg: string) => log.info(msg),
    warn: (msg: string) => log.warn(msg),
    error: (msg: string) => log.error(msg),
    debug: (msg: string) => log.debug(msg),
  };

  try {
    logger.info("[plugin-reload] Starting plugin hot-reload…");

    // 1. Discover current plugin source paths (for cache busting)
    const discovery = discoverOpenClawPlugins({
      workspaceDir: options.workspaceDir,
    });
    const sourcePaths = discovery.candidates.map((c) => c.rootDir);

    // 2. Clear all caches
    clearPluginCaches({ pluginSourcePaths: sourcePaths });
    clearPluginCommands();
    resetGlobalHookRunner();

    logger.info("[plugin-reload] Caches cleared, re-loading plugins…");

    // 3. Fresh load (cache=false to skip the loader's own cache check)
    const registry = loadOpenClawPlugins({
      config: options.config,
      workspaceDir: options.workspaceDir,
      logger,
      coreGatewayHandlers: options.coreGatewayHandlers,
      cache: false,
    });

    const pluginCount = registry.plugins.filter((p) => p.status === "loaded").length;
    const hookCount = registry.hooks.length;
    const durationMs = Math.round(performance.now() - start);

    logger.info(
      `[plugin-reload] Reload complete in ${durationMs}ms — ` +
        `${pluginCount} plugin(s), ${hookCount} hook(s)`,
    );

    return { ok: true, registry, pluginCount, hookCount, durationMs };
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[plugin-reload] Reload failed after ${durationMs}ms: ${message}`);
    return { ok: false, error: message, durationMs };
  }
}
