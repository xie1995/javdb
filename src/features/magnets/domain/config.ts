import type { MagnetSearchConfig } from './types';

export const DEFAULT_MAGNET_SEARCH_CONFIG: MagnetSearchConfig = {
  enabled: false,
  showInlineResults: true,
  showFloatingButton: true,
  autoSearch: false,
  blockMojContent: true,
  sources: {
    sukebei: true,
    btdig: true,
    btsow: true,
    torrentz2: false,
    javbus: false,
    custom: [],
  },
  maxResults: 15,
  timeout: 6000,
};

/**
 * 磁力资源搜索设置（存储级别，包含并发控制等不属于 MagnetSearchConfig 的字段）
 */
export interface MagnetSearchSettings {
  sources: {
    sukebei: boolean;
    btdig: boolean;
    btsow: boolean;
    torrentz2: boolean;
    javbus: boolean;
    custom: string[];
  };
  autoSearch: boolean;
  blockMojContent: boolean;
  maxResults: number;
  timeoutMs: number;
  concurrency: {
    pageMaxConcurrentRequests: number;
    bgGlobalMaxConcurrent: number;
    bgPerHostMaxConcurrent: number;
    bgPerHostRateLimitPerMin: number;
  };
}

export const DEFAULT_MAGNET_SEARCH_SETTINGS: MagnetSearchSettings = {
  sources: {
    sukebei: true,
    btdig: true,
    btsow: true,
    torrentz2: false,
    javbus: false,
    custom: [],
  },
  autoSearch: false,
  blockMojContent: true,
  maxResults: 15,
  timeoutMs: 6000,
  concurrency: {
    pageMaxConcurrentRequests: 2,
    bgGlobalMaxConcurrent: 4,
    bgPerHostMaxConcurrent: 1,
    bgPerHostRateLimitPerMin: 12,
  },
};