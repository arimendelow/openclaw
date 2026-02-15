import { createRequire } from "node:module";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import type { GatewayRequestHandler } from "../gateway/server-methods/types.js";
import type { PluginLogger } from "./types.js";
import { loadOpenClawPlugins, clearPluginLoaderCache } from "./loader.js";
import { getActivePluginRegistry } from "./runtime.js";

const requireForCache = createRequire(import.meta.url);

function normalizeSource(source: string): string {
  return path.resolve(source);
}

export function clearPluginModuleCache(sources: string[]): number {
  const resolved = sources.map(normalizeSource);
  let cleared = 0;

  for (const cacheKey of Object.keys(requireForCache.cache)) {
    const normalizedKey = normalizeSource(cacheKey);
    if (resolved.some((source) => normalizedKey === source)) {
      delete requireForCache.cache[cacheKey];
      cleared += 1;
    }
  }

  return cleared;
}

export function reloadOpenClawPlugins(params: {
  config: OpenClawConfig;
  workspaceDir?: string;
  logger?: PluginLogger;
  coreGatewayHandlers?: Record<string, GatewayRequestHandler>;
}) {
  const active = getActivePluginRegistry();
  const sources = active?.plugins.map((plugin) => plugin.source) ?? [];
  const clearedModules = clearPluginModuleCache(sources);

  clearPluginLoaderCache();

  const registry = loadOpenClawPlugins({
    config: params.config,
    workspaceDir: params.workspaceDir,
    logger: params.logger,
    coreGatewayHandlers: params.coreGatewayHandlers,
    cache: false,
  });

  params.logger?.info(
    `[plugins] hot-reload complete (plugins=${registry.plugins.length}, moduleCacheCleared=${clearedModules})`,
  );

  return registry;
}
