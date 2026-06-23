# Emby 联动功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Emby 联动功能，在浏览 JAVDB 网站时检测影片是否在 Emby/Jellyfin 库中，并显示"已入库"标记

**Architecture:** 采用分层模块化架构，分为 domain（领域层）、background（后台服务）、content（内容脚本）三层，支持手动同步、定时同步、实时查询三种模式

**Tech Stack:** TypeScript + Chrome Extension MV3 + chrome.storage.local + chrome.alarms

---

## 文件结构

```
src/features/embyLibrary/
├── domain/
│   ├── types.ts              # 类型定义
│   ├── matcher.ts            # 番号匹配逻辑
│   └── libraryIndex.ts       # 库索引管理（本地缓存）
├── background/
│   ├── handlers.ts           # 后台消息处理器
│   └── scheduler.ts          # 定时同步调度器
├── content/
│   ├── statusBadges.ts       # 封面标记渲染
│   └── realtimeCheck.ts      # 实时查询逻辑
└── index.ts                  # 模块入口

src/dashboard/tabs/settings/emby/
├── EmbySettings.ts           # 设置面板逻辑
└── index.ts                  # 注册入口

src/dashboard/partials/tabs/settings-emby.html   # 设置页面模板（新建）
src/dashboard/styles/05-pages/settings/emby.css   # 设置页样式（新建）
```

**修改文件**：
- `src/utils/config.ts` — 新增存储键和默认配置
- `src/utils/storage.ts` — 新增配置合并逻辑
- `src/dashboard/partials/tabs/settings-index.html` — 添加导航卡片
- `src/dashboard/tabs/resources.ts` — 注册 emby.html 资源
- `src/dashboard/tabs/settings/index.ts` — 注册 Emby 设置面板
- `src/dashboard/styles/05-pages/settings/index.css` — import emby.css
- `src/features/contentState/index.ts` — 新增 STATE.embyLibraryState
- `src/apps/content/bootstrap.ts` — 初始化时加载库状态
- `src/apps/content/contentMessageRouter.ts` — 处理 Emby 消息
- `src/apps/background/bootstrap.ts` — 注册后台处理器
- `src/apps/background/alarmRouter.ts` — 处理定时同步 alarm
- `src/apps/background/miscMessageRouter.ts` — 处理 Emby 消息路由
- `src/features/listEnhancement/content/itemProcessor.ts` — 调用封面标记渲染
- `src/features/videoDetail/pageHandler.ts` — 调用封面标记渲染
- `src/features/telemetry/domain/featureCatalog.ts` — 新增 telemetry 条目
- `src/features/telemetry/domain/types.ts` — 新增功能配置类型
- `src/features/settingsSearch/domain/aliases.ts` — 新增搜索别名
- `src/dashboard/tabs/settings/advanced/AdvancedSettings.ts` — 新增高级设置映射

---

## 实现任务

### Task 1: 类型定义和配置

**Files:**
- Create: `src/features/embyLibrary/domain/types.ts`
- Modify: `src/utils/config.ts`

- [ ] **Step 1: 创建类型定义文件**

```typescript
// src/features/embyLibrary/domain/types.ts

// 服务器类型
export type ServerType = 'emby' | 'jellyfin';

// 服务器配置
export interface EmbyServerConfig {
  type: ServerType;
  url: string;
  apiKey: string;
  enabled: boolean;
}

// 同步模式
export type SyncMode = 'manual' | 'scheduled' | 'realtime';

// 同步配置
export interface EmbySyncConfig {
  mode: SyncMode;
  scheduledIntervalMinutes: number;
}

// 库索引条目
export interface LibraryIndexEntry {
  id: string;
  name: string;
  providerIds: {
    jav?: string;
    [key: string]: string | undefined;
  };
  normalizedCodes: string[];
}

// 库索引
export interface LibraryIndex {
  entries: LibraryIndexEntry[];
  lastSyncTime: number;
  totalCount: number;
}

// 功能总配置
export interface EmbyLibraryConfig {
  server: EmbyServerConfig;
  sync: EmbySyncConfig;
  libraryStatus: {
    enabled: boolean;
    showOnList: boolean;
    showOnDetail: boolean;
  };
}

// 匹配结果
export interface MatchResult {
  matched: boolean;
  entries: LibraryIndexEntry[];
}

// 默认配置
export const DEFAULT_EMBY_LIBRARY_CONFIG: EmbyLibraryConfig = {
  server: {
    type: 'emby',
    url: '',
    apiKey: '',
    enabled: false,
  },
  sync: {
    mode: 'manual',
    scheduledIntervalMinutes: 60,
  },
  libraryStatus: {
    enabled: false,
    showOnList: true,
    showOnDetail: true,
  },
};
```

- [ ] **Step 2: 修改 config.ts 添加存储键**

在 `src/utils/config.ts` 中添加：
```typescript
// 在 STORAGE_KEYS 对象中添加
EMBY_LIBRARY_CONFIG: 'emby_library_config',
EMBY_LIBRARY_INDEX: 'emby_library_index',
```

添加默认配置：
```typescript
import type { EmbyLibraryConfig } from '../features/embyLibrary/domain/types';
import { DEFAULT_EMBY_LIBRARY_CONFIG } from '../features/embyLibrary/domain/types';

export const DEFAULT_EMBY_LIBRARY_SETTINGS: EmbyLibraryConfig = DEFAULT_EMBY_LIBRARY_CONFIG;
```

- [ ] **Step 3: 修改 storage.ts 添加配置合并**

在 `src/utils/storage.ts` 中找到 `mergeDeep` 函数调用处，添加：
```typescript
if (savedSettings.embyLibrary) {
  merged.embyLibrary = { ...DEFAULT_EMBY_LIBRARY_SETTINGS, ...savedSettings.embyLibrary };
}
```

---

### Task 2: 番号匹配器

**Files:**
- Create: `src/features/embyLibrary/domain/matcher.ts`

- [ ] **Step 1: 创建 matcher.ts**

```typescript
// src/features/embyLibrary/domain/matcher.ts

import type { LibraryIndex, LibraryIndexEntry } from './types';

/**
 * 标准化番号：转小写，去除分隔符
 */
export function normalizeCode(code: string): string {
  return code.toLowerCase().replace(/[-_\s\.]/g, '');
}

/**
 * 提取番号变体：生成所有可能的标准化变体
 */
export function generateCodeVariants(code: string): string[] {
  const variants: string[] = [];
  const normalized = normalizeCode(code);
  variants.push(normalized);
  
  // 去除所有非字母数字
  const alphanumeric = normalized.replace(/[^a-z0-9]/g, '');
  if (alphanumeric !== normalized) {
    variants.push(alphanumeric);
  }
  
  return [...new Set(variants)];
}

/**
 * 智能匹配：精确匹配优先，找不到时模糊匹配
 */
export function matchCode(videoId: string, index: LibraryIndex): LibraryIndexEntry | null {
  if (!index.entries || index.entries.length === 0) {
    return null;
  }

  const normalizedVideoId = normalizeCode(videoId);
  const videoVariants = generateCodeVariants(videoId);

  // 第一轮：精确匹配
  for (const entry of index.entries) {
    const javCode = entry.providerIds.jav;
    if (javCode && normalizeCode(javCode) === normalizedVideoId) {
      return entry;
    }
  }

  // 第二轮：模糊匹配（对比所有标准化变体）
  for (const entry of index.entries) {
    const entryVariants = entry.normalizedCodes || [];
    for (const videoVariant of videoVariants) {
      if (entryVariants.includes(videoVariant)) {
        return entry;
      }
    }
  }

  return null;
}

/**
 * 批量匹配
 */
export function matchCodes(videoIds: string[], index: LibraryIndex): Map<string, LibraryIndexEntry> {
  const results = new Map<string, LibraryIndexEntry>();
  
  for (const videoId of videoIds) {
    const match = matchCode(videoId, index);
    if (match) {
      results.set(videoId, match);
    }
  }
  
  return results;
}
```

---

### Task 3: 库索引管理

**Files:**
- Create: `src/features/embyLibrary/domain/libraryIndex.ts`

- [ ] **Step 1: 创建 libraryIndex.ts**

```typescript
// src/features/embyLibrary/domain/libraryIndex.ts

import { STORAGE_KEYS } from '../../../utils/config';
import { storageManager } from '../../../platform/storage';
import type { LibraryIndex, LibraryIndexEntry, EmbyServerConfig } from './types';
import { normalizeCode } from './matcher';

const EMPTY_INDEX: LibraryIndex = {
  entries: [],
  lastSyncTime: 0,
  totalCount: 0,
};

/**
 * 获取本地库索引
 */
export async function getLibraryIndex(): Promise<LibraryIndex> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEYS.EMBY_LIBRARY_INDEX);
    if (data[STORAGE_KEYS.EMBY_LIBRARY_INDEX]) {
      return data[STORAGE_KEYS.EMBY_LIBRARY_INDEX] as LibraryIndex;
    }
  } catch (e) {
    console.error('[EmbyLibrary] Failed to get index:', e);
  }
  return { ...EMPTY_INDEX };
}

/**
 * 保存库索引到本地
 */
export async function saveLibraryIndex(index: LibraryIndex): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.EMBY_LIBRARY_INDEX]: index,
  });
}

/**
 * 清除本地库索引
 */
export async function clearLibraryIndex(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.EMBY_LIBRARY_INDEX);
}

/**
 * 从 Emby/Jellyfin API 获取媒体库数据
 */
export async function fetchLibraryFromServer(config: EmbyServerConfig): Promise<LibraryIndexEntry[]> {
  if (!config.url || !config.apiKey) {
    throw new Error('服务器配置不完整');
  }

  const baseUrl = config.url.replace(/\/$/, '');
  const apiKey = config.apiKey;
  const entries: LibraryIndexEntry[] = [];
  
  let startIndex = 0;
  const pageSize = 200;
  let hasMore = true;

  while (hasMore) {
    const url = `${baseUrl}/Items?api_key=${apiKey}&Fields=ProviderIds&Filters=IsNotFolder&IncludeItemTypes=Movie&Recursive=true&startIndex=${startIndex}&limit=${pageSize}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('API Key 无效或已过期');
      }
      throw new Error(`服务器返回错误: ${response.status}`);
    }

    const data = await response.json();
    const items = data.Items || [];
    
    for (const item of items) {
      const providerIds = item.ProviderIds || {};
      // 只保留有 JAV 番号的条目
      if (providerIds.Jav || providerIds.jav) {
        const javCode = providerIds.Jav || providerIds.jav;
        entries.push({
          id: item.Id,
          name: item.Name,
          providerIds: {
            jav: javCode,
          },
          normalizedCodes: [normalizeCode(javCode)],
        });
      }
    }

    startIndex += items.length;
    hasMore = items.length === pageSize;
  }

  return entries;
}

/**
 * 执行同步：从服务器获取数据并更新本地索引
 */
export async function syncLibrary(config: EmbyServerConfig): Promise<LibraryIndex> {
  const entries = await fetchLibraryFromServer(config);
  
  const index: LibraryIndex = {
    entries,
    lastSyncTime: Date.now(),
    totalCount: entries.length,
  };

  await saveLibraryIndex(index);
  return index;
}

/**
 * 测试服务器连接
 */
export async function testConnection(config: EmbyServerConfig): Promise<{ success: boolean; message: string; serverName?: string }> {
  if (!config.url || !config.apiKey) {
    return { success: false, message: '服务器地址和 API Key 不能为空' };
  }

  try {
    const baseUrl = config.url.replace(/\/$/, '');
    const url = `${baseUrl}/System/Info?api_key=${config.apiKey}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { success: false, message: 'API Key 无效或已过期' };
      }
      return { success: false, message: `服务器返回错误: ${response.status}` };
    }

    const data = await response.json();
    return {
      success: true,
      message: '连接成功',
      serverName: data.ServerName || data serverName || 'Unknown',
    };
  } catch (e) {
    const error = e as Error;
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      return { success: false, message: '无法连接到服务器，请检查地址是否正确' };
    }
    return { success: false, message: error.message || '连接失败' };
  }
}
```

---

### Task 4: 后台消息处理器

**Files:**
- Create: `src/features/embyLibrary/background/handlers.ts`
- Create: `src/features/embyLibrary/background/scheduler.ts`
- Modify: `src/apps/background/bootstrap.ts`
- Modify: `src/apps/background/miscMessageRouter.ts`
- Modify: `src/apps/background/alarmRouter.ts`

- [ ] **Step 1: 创建后台消息处理器**

```typescript
// src/features/embyLibrary/background/handlers.ts

import { STORAGE_KEYS } from '../../../utils/config';
import { storageManager } from '../../../platform/storage';
import { getLibraryIndex, syncLibrary, clearLibraryIndex, testConnection } from '../domain/libraryIndex';
import { matchCode } from '../domain/matcher';
import type { EmbyLibraryConfig, LibraryIndex, EmbyServerConfig } from '../domain/types';
import { DEFAULT_EMBY_LIBRARY_CONFIG } from '../domain/types';
import { scheduleLibrarySync, cancelLibrarySync } from './scheduler';

const ALARM_NAME = 'emby_library_sync';

/**
 * 获取功能配置
 */
async function getConfig(): Promise<EmbyLibraryConfig> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.EMBY_LIBRARY_CONFIG);
  if (result[STORAGE_KEYS.EMBY_LIBRARY_CONFIG]) {
    return result[STORAGE_KEYS.EMBY_LIBRARY_CONFIG] as EmbyLibraryConfig;
  }
  return { ...DEFAULT_EMBY_LIBRARY_CONFIG };
}

/**
 * 保存功能配置
 */
async function saveConfig(config: EmbyLibraryConfig): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.EMBY_LIBRARY_CONFIG]: config,
  });
  
  // 根据同步模式更新定时任务
  if (config.sync.mode === 'scheduled') {
    scheduleLibrarySync(ALARM_NAME, config.sync.scheduledIntervalMinutes);
  } else {
    cancelLibrarySync(ALARM_NAME);
  }
}

/**
 * 处理同步请求
 */
export async function handleSyncRequest(): Promise<{ success: boolean; index?: LibraryIndex; error?: string }> {
  try {
    const config = await getConfig();
    if (!config.server.enabled || !config.server.url || !config.server.apiKey) {
      return { success: false, error: '服务器未配置或未启用' };
    }
    
    const index = await syncLibrary(config.server);
    return { success: true, index };
  } catch (e) {
    const error = e as Error;
    return { success: false, error: error.message };
  }
}

/**
 * 处理获取索引请求
 */
export async function handleGetIndexRequest(): Promise<LibraryIndex> {
  return getLibraryIndex();
}

/**
 * 处理单个番号查询
 */
export async function handleCheckCodeRequest(videoId: string, config: EmbyLibraryConfig): Promise<{ matched: boolean; serverName?: string }> {
  const index = await getLibraryIndex();
  
  // 实时查询模式：直接从服务器查询
  if (config.sync.mode === 'realtime' && config.server.enabled) {
    try {
      // 实时查询实现（后续优化：可以考虑缓存查询结果）
      const entries = await fetchRealtime(videoId, config.server);
      if (entries.length > 0) {
        return { matched: true, serverName: config.server.type === 'emby' ? 'Emby' : 'Jellyfin' };
      }
    } catch (e) {
      // 实时查询失败，静默降级
    }
  }
  
  // 本地索引查询
  const match = matchCode(videoId, index);
  if (match) {
    return { matched: true, serverName: config.server.type === 'emby' ? 'Emby' : 'Jellyfin' };
  }
  
  return { matched: false };
}

// 实时查询辅助
async function fetchRealtime(videoId: string, serverConfig: EmbyServerConfig): Promise<any[]> {
  const baseUrl = serverConfig.url.replace(/\/$/, '');
  const searchUrl = `${baseUrl}/Items?api_key=${serverConfig.apiKey}&searchTerm=${encodeURIComponent(videoId)}&includeItemTypes=Movie&Fields=ProviderIds&limit=5`;
  
  const response = await fetch(searchUrl);
  if (!response.ok) return [];
  
  const data = await response.json();
  return (data.Items || []).filter((item: any) => {
    const providerIds = item.ProviderIds || {};
    return providerIds.Jav || providerIds.jav;
  });
}

/**
 * 处理清除索引请求
 */
export async function handleClearIndexRequest(): Promise<void> {
  await clearLibraryIndex();
}

/**
 * 处理测试连接请求
 */
export async function handleTestConnectionRequest(config: EmbyServerConfig): Promise<{ success: boolean; message: string; serverName?: string }> {
  return testConnection(config);
}

/**
 * 处理配置更新请求
 */
export async function handleUpdateConfigRequest(newConfig: Partial<EmbyLibraryConfig>): Promise<void> {
  const config = await getConfig();
  const merged = {
    server: { ...config.server, ...newConfig.server },
    sync: { ...config.sync, ...newConfig.sync },
    libraryStatus: { ...config.libraryStatus, ...newConfig.libraryStatus },
  };
  await saveConfig(merged);
}

/**
 * 获取配置
 */
export async function handleGetConfigRequest(): Promise<EmbyLibraryConfig> {
  return getConfig();
}

/**
 * 定时同步触发
 */
export async function handleScheduledSync(): Promise<void> {
  try {
    const config = await getConfig();
    if (!config.server.enabled) return;
    await syncLibrary(config.server);
    console.log('[EmbyLibrary] Scheduled sync completed');
  } catch (e) {
    console.error('[EmbyLibrary] Scheduled sync failed:', e);
  }
}
```

- [ ] **Step 2: 创建定时调度器**

```typescript
// src/features/embyLibrary/background/scheduler.ts

/**
 * 安排定时同步任务
 */
export function scheduleLibrarySync(alarmName: string, intervalMinutes: number): void {
  // 先清除已有任务
  chrome.alarms.clear(alarmName);
  
  chrome.alarms.create(alarmName, {
    delayInMinutes: intervalMinutes,
    periodInMinutes: intervalMinutes,
  });
}

/**
 * 取消定时同步任务
 */
export function cancelLibrarySync(alarmName: string): void {
  chrome.alarms.clear(alarmName);
}
```

- [ ] **Step 3: 修改 bootstrap.ts 注册后台处理器**

在 `src/apps/background/bootstrap.ts` 中添加：
```typescript
// 在 imports 部分添加
import { handleScheduledSync } from '../../features/embyLibrary/background/handlers';

// 在 startup 函数中添加
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'emby_library_sync') {
    void handleScheduledSync();
  }
});
```

- [ ] **Step 4: 修改 miscMessageRouter.ts 添加消息路由**

在 `src/apps/background/miscMessageRouter.ts` 中添加消息类型和处理：
```typescript
// 添加消息类型常量
const EMBY_LIBRARY_SYNC = 'EMBY_LIBRARY_SYNC';
const EMBY_LIBRARY_GET_INDEX = 'EMBY_LIBRARY_GET_INDEX';
const EMBY_LIBRARY_CHECK_CODE = 'EMBY_LIBRARY_CHECK_CODE';
const EMBY_LIBRARY_CLEAR_INDEX = 'EMBY_LIBRARY_CLEAR_INDEX';
const EMBY_LIBRARY_TEST_CONNECTION = 'EMBY_LIBRARY_TEST_CONNECTION';
const EMBY_LIBRARY_UPDATE_CONFIG = 'EMBY_LIBRARY_UPDATE_CONFIG';
const EMBY_LIBRARY_GET_CONFIG = 'EMBY_LIBRARY_GET_CONFIG';

// 添加导入
import {
  handleSyncRequest,
  handleGetIndexRequest,
  handleCheckCodeRequest,
  handleClearIndexRequest,
  handleTestConnectionRequest,
  handleUpdateConfigRequest,
  handleGetConfigRequest,
} from '../../features/embyLibrary/background/handlers';

// 在消息处理中添加 case 分支
case EMBY_LIBRARY_SYNC:
  sendResponse(await handleSyncRequest());
  break;

case EMBY_LIBRARY_GET_INDEX:
  sendResponse(await handleGetIndexRequest());
  break;

case EMBY_LIBRARY_CHECK_CODE: {
  const { videoId } = request;
  const config = await handleGetConfigRequest();
  sendResponse(await handleCheckCodeRequest(videoId, config));
  break;
}

case EMBY_LIBRARY_CLEAR_INDEX:
  await handleClearIndexRequest();
  sendResponse({ success: true });
  break;

case EMBY_LIBRARY_TEST_CONNECTION: {
  const { config } = request;
  sendResponse(await handleTestConnectionRequest(config));
  break;
}

case EMBY_LIBRARY_UPDATE_CONFIG: {
  const { config } = request;
  await handleUpdateConfigRequest(config);
  sendResponse({ success: true });
  break;
}

case EMBY_LIBRARY_GET_CONFIG:
  sendResponse(await handleGetConfigRequest());
  break;
```

- [ ] **Step 5: 修改 alarmRouter.ts 添加定时同步 alarm 处理**

在 `src/apps/background/alarmRouter.ts` 中添加：
```typescript
// 在 imports 部分添加（如果还没有的话）
import { handleScheduledSync } from '../../features/embyLibrary/background/handlers';

// 在 alarmRouter 函数中添加 case
case 'emby_library_sync':
  await handleScheduledSync();
  break;
```

---

### Task 5: 封面标记渲染

**Files:**
- Create: `src/features/embyLibrary/content/statusBadges.ts`
- Create: `src/features/embyLibrary/content/realtimeCheck.ts`

- [ ] **Step 1: 创建封面标记渲染模块**

```typescript
// src/features/embyLibrary/content/statusBadges.ts

import type { EmbyLibraryConfig, LibraryIndexEntry } from '../domain/types';
import { log } from '../../contentState';

/**
 * 在列表页影片封面右上角添加"已入库"标记
 */
export function renderLibraryStatusCoverBadge(item: HTMLElement, videoId: string, config: EmbyLibraryConfig): void {
  if (!item || !videoId) return;
  if (!config.libraryStatus.enabled || !config.libraryStatus.showOnList) return;

  // 清除已有封面标记
  item.querySelectorAll('.emby-library-cover-badge').forEach(el => el.remove());

  // 查找封面图像
  const coverImage = item.querySelector('img.video-cover, img');
  if (!coverImage) return;

  // 定位包含 img 的父容器
  let wrapper = coverImage.parentElement;
  while (wrapper && !wrapper.querySelector(':scope > img')) {
    wrapper = wrapper.parentElement;
  }

  const badgeHost: HTMLElement = wrapper || item;

  // 创建标记元素
  const badge = document.createElement('span');
  badge.className = 'emby-library-cover-badge';
  badge.textContent = '已入库';
  badge.style.cssText = `
    position: absolute;
    top: 8px;
    right: 8px;
    background: rgba(34, 197, 94, 0.92);
    color: white;
    font-size: 11px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 10px;
    z-index: 10;
    pointer-events: none;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  // 确保容器有相对定位
  const computedStyle = window.getComputedStyle(badgeHost);
  if (computedStyle.position === 'static') {
    badgeHost.style.position = 'relative';
  }

  badgeHost.appendChild(badge);
}

/**
 * 在详情页主封面右上角添加"已入库"标记
 */
export function renderDetailLibraryCoverBadge(videoId: string, config: EmbyLibraryConfig): void {
  if (!videoId) return;
  if (!config.libraryStatus.enabled || !config.libraryStatus.showOnDetail) return;

  // 查找封面列
  const coverColumn = document.querySelector<HTMLElement>(
    '.movie-panel-info .column:first-child, .movie-panel-info > .columns > .column:first-child'
  );
  if (!coverColumn) return;

  // 清除已有封面标记
  coverColumn.querySelectorAll('.emby-library-cover-badge').forEach(el => el.remove());

  const coverImage = coverColumn.querySelector<HTMLImageElement>('img.video-cover, img');
  if (!coverImage) return;

  const badge = document.createElement('span');
  badge.className = 'emby-library-cover-badge emby-library-detail-cover-badge';
  badge.textContent = '已入库';
  badge.style.cssText = `
    position: absolute;
    top: 12px;
    right: 12px;
    background: rgba(34, 197, 94, 0.92);
    color: white;
    font-size: 14px;
    font-weight: 600;
    padding: 6px 14px;
    border-radius: 14px;
    z-index: 10;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    letter-spacing: 1px;
  `;

  const computedStyle = window.getComputedStyle(coverColumn);
  if (computedStyle.position === 'static') {
    coverColumn.style.position = 'relative';
  }

  coverColumn.appendChild(badge);
}

/**
 * 清除列表页中所有封面标记
 */
export function clearAllCoverBadges(): void {
  document.querySelectorAll('.emby-library-cover-badge').forEach(el => el.remove());
}
```

- [ ] **Step 2: 创建实时查询模块**

```typescript
// src/features/embyLibrary/content/realtimeCheck.ts

import type { EmbyLibraryConfig } from '../domain/types';

const messageTypes = {
  SYNC: 'EMBY_LIBRARY_SYNC',
  GET_INDEX: 'EMBY_LIBRARY_GET_INDEX',
  CHECK_CODE: 'EMBY_LIBRARY_CHECK_CODE',
  CLEAR_INDEX: 'EMBY_LIBRARY_CLEAR_INDEX',
  TEST_CONNECTION: 'EMBY_LIBRARY_TEST_CONNECTION',
  UPDATE_CONFIG: 'EMBY_LIBRARY_UPDATE_CONFIG',
  GET_CONFIG: 'EMBY_LIBRARY_GET_CONFIG',
};

/**
 * 发送消息到后台
 */
function sendMessage(message: any): Promise<any> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response);
    });
  });
}

/**
 * 获取配置
 */
export async function getEmbyConfig(): Promise<EmbyLibraryConfig | null> {
  try {
    const config = await sendMessage({ type: messageTypes.GET_CONFIG });
    return config;
  } catch (e) {
    return null;
  }
}

/**
 * 获取库索引
 */
export async function getLibraryIndex(): Promise<any> {
  try {
    return await sendMessage({ type: messageTypes.GET_INDEX });
  } catch (e) {
    return null;
  }
}

/**
 * 检查单个番号是否在库中
 */
export async function checkCodeInLibrary(videoId: string, config: EmbyLibraryConfig): Promise<boolean> {
  try {
    const result = await sendMessage({
      type: messageTypes.CHECK_CODE,
      videoId,
      config,
    });
    return result?.matched || false;
  } catch (e) {
    return false;
  }
}

/**
 * 触发同步
 */
export async function triggerSync(): Promise<{ success: boolean; error?: string }> {
  try {
    return await sendMessage({ type: messageTypes.SYNC });
  } catch (e) {
    return { success: false, error: '同步失败' };
  }
}

/**
 * 测试服务器连接
 */
export async function testServerConnection(config: { url: string; apiKey: string }): Promise<{ success: boolean; message: string; serverName?: string }> {
  try {
    return await sendMessage({
      type: messageTypes.TEST_CONNECTION,
      config,
    });
  } catch (e) {
    return { success: false, message: '测试连接失败' };
  }
}

/**
 * 更新配置
 */
export async function updateEmbyConfig(config: Partial<EmbyLibraryConfig>): Promise<void> {
  await sendMessage({
    type: messageTypes.UPDATE_CONFIG,
    config,
  });
}
```

---

### Task 6: 列表页集成

**Files:**
- Modify: `src/features/listEnhancement/content/itemProcessor.ts`

- [ ] **Step 1: 修改 itemProcessor.ts 添加封面标记调用**

在文件顶部添加 import：
```typescript
import { renderLibraryStatusCoverBadge } from '../../embyLibrary/content/statusBadges';
import { getEmbyConfig, getLibraryIndex } from '../../embyLibrary/content/realtimeCheck';
import { matchCode } from '../../embyLibrary/domain/matcher';
import type { EmbyLibraryConfig } from '../../embyLibrary/domain/types';
```

在 `processItem` 函数中添加调用（需要在获取 videoId 后调用）：
```typescript
// 在 processItem 函数末尾添加封面标记渲染
// 获取 Emby 配置和索引
const embyConfig = await getEmbyConfig();
if (embyConfig?.libraryStatus?.enabled && embyConfig.libraryStatus.showOnList) {
  const index = await getLibraryIndex();
  if (index?.entries?.length > 0) {
    const match = matchCode(videoId, index);
    if (match) {
      renderLibraryStatusCoverBadge(item, videoId, embyConfig);
    }
  }
}
```

---

### Task 7: 详情页集成

**Files:**
- Modify: `src/features/videoDetail/pageHandler.ts`

- [ ] **Step 1: 修改 pageHandler.ts 添加封面标记调用**

在文件顶部添加 import：
```typescript
import { renderDetailLibraryCoverBadge } from '../embyLibrary/content/statusBadges';
import { getEmbyConfig, getLibraryIndex } from '../embyLibrary/content/realtimeCheck';
import { matchCode } from '../embyLibrary/domain/matcher';
```

在 `handleVideoDetailPage` 函数中添加调用（在获取 videoId 后）：
```typescript
// Emby 库状态封面标记
try {
  const embyConfig = await getEmbyConfig();
  if (embyConfig?.libraryStatus?.enabled && embyConfig.libraryStatus.showOnDetail) {
    const index = await getLibraryIndex();
    if (index?.entries?.length > 0) {
      const match = matchCode(videoId, index);
      if (match) {
        renderDetailLibraryCoverBadge(videoId, embyConfig);
      }
    }
  }
} catch (e) {
  log('Emby library cover badge failed:', e as any);
}
```

---

### Task 8: 设置页面

**Files:**
- Create: `src/dashboard/partials/tabs/settings-emby.html`
- Create: `src/dashboard/styles/05-pages/settings/emby.css`
- Create: `src/dashboard/tabs/settings/emby/EmbySettings.ts`
- Create: `src/dashboard/tabs/settings/emby/index.ts`

- [ ] **Step 1: 创建设置页面模板**

```html
<!-- src/dashboard/partials/tabs/settings-emby.html -->

<div class="settings-section">
  <h2 class="title is-5">Emby 联动</h2>
  <p class="mb-4">连接 Emby/Jellyfin 服务器，浏览 JAVDB 时显示影片是否已入库</p>

  <!-- 启用开关 -->
  <div class="field">
    <label class="switch">
      <input type="checkbox" id="emby-enabled">
      <span class="slider"></span>
    </label>
    <label for="emby-enabled">启用 Emby 联动功能</label>
  </div>

  <div id="emby-settings-content" class="mt-4">
    <!-- 服务器配置 -->
    <div class="box">
      <h3 class="title is-6 mb-3">服务器配置</h3>

      <div class="field">
        <label class="label">服务器类型</label>
        <div class="control">
          <div class="select">
            <select id="emby-server-type">
              <option value="emby">Emby</option>
              <option value="jellyfin">Jellyfin</option>
            </select>
          </div>
        </div>
      </div>

      <div class="field">
        <label class="label">服务器地址</label>
        <div class="control">
          <input class="input" type="text" id="emby-server-url" 
                 placeholder="http://192.168.1.100:8096">
        </div>
        <p class="help">填写 Emby/Jellyfin 服务器的地址和端口</p>
      </div>

      <div class="field">
        <label class="label">API Key</label>
        <div class="control">
          <input class="input" type="password" id="emby-api-key" 
                 placeholder="输入 API Key">
        </div>
        <p class="help">在 Emby/Jellyfin 管理面板 → API Key 中创建</p>
      </div>

      <div class="field">
        <div class="control">
          <button class="button is-info is-light" id="emby-test-connection">
            测试连接
          </button>
          <span id="emby-connection-status" class="ml-3"></span>
        </div>
      </div>
    </div>

    <!-- 同步设置 -->
    <div class="box mt-4">
      <h3 class="title is-6 mb-3">同步设置</h3>

      <div class="field">
        <label class="label">同步模式</label>
        <div class="control">
          <label class="radio">
            <input type="radio" name="emby-sync-mode" value="manual" checked>
            手动同步
          </label>
        </div>
        <div class="control">
          <label class="radio">
            <input type="radio" name="emby-sync-mode" value="scheduled">
            定时同步
          </label>
        </div>
        <div class="control">
          <label class="radio">
            <input type="radio" name="emby-sync-mode" value="realtime">
            实时查询
          </label>
        </div>
      </div>

      <div class="field" id="emby-interval-field" style="display: none;">
        <label class="label">同步间隔（分钟）</label>
        <div class="control">
          <div class="select">
            <select id="emby-sync-interval">
              <option value="10">10 分钟</option>
              <option value="30">30 分钟</option>
              <option value="60" selected>1 小时</option>
              <option value="120">2 小时</option>
              <option value="360">6 小时</option>
              <option value="720">12 小时</option>
              <option value="1440">24 小时</option>
            </select>
          </div>
        </div>
      </div>

      <div class="field">
        <div class="control">
          <button class="button is-primary" id="emby-sync-now">
            立即同步
          </button>
          <span id="emby-sync-status" class="ml-3"></span>
        </div>
        <p class="help" id="emby-last-sync"></p>
      </div>
    </div>

    <!-- 显示设置 -->
    <div class="box mt-4">
      <h3 class="title is-6 mb-3">显示设置</h3>

      <div class="field">
        <label class="switch">
          <input type="checkbox" id="emby-show-on-list" checked>
          <span class="slider"></span>
        </label>
        <label for="emby-show-on-list">在列表页显示"已入库"标记</label>
      </div>

      <div class="field">
        <label class="switch">
          <input type="checkbox" id="emby-show-on-detail" checked>
          <span class="slider"></span>
        </label>
        <label for="emby-show-on-detail">在详情页显示"已入库"标记</label>
      </div>
    </div>

    <!-- 保存按钮 -->
    <div class="field mt-5">
      <div class="control">
        <button class="button is-primary" id="emby-save">
          保存设置
        </button>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: 创建设置页逻辑**

```typescript
// src/dashboard/tabs/settings/emby/EmbySettings.ts

import { messageTypes } from '../../../apps/content/runtimeMessages';
import { showToast } from '../../../platform/browser/toast';
import type { EmbyLibraryConfig } from '../../../features/embyLibrary/domain/types';

function sendMessage(message: any): Promise<any> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response);
    });
  });
}

export async function initEmbySettings(): Promise<void> {
  const content = document.getElementById('emby-settings-content');
  if (!content) return;

  // 加载配置
  const config = await sendMessage({ type: 'EMBY_LIBRARY_GET_CONFIG' }) as EmbyLibraryConfig;
  
  // 填充表单
  const enabledCheckbox = document.getElementById('emby-enabled') as HTMLInputElement;
  const serverTypeSelect = document.getElementById('emby-server-type') as HTMLSelectElement;
  const serverUrlInput = document.getElementById('emby-server-url') as HTMLInputElement;
  const apiKeyInput = document.getElementById('emby-api-key') as HTMLInputElement;
  const showOnListCheckbox = document.getElementById('emby-show-on-list') as HTMLInputElement;
  const showOnDetailCheckbox = document.getElementById('emby-show-on-detail') as HTMLInputElement;
  const syncIntervalSelect = document.getElementById('emby-sync-interval') as HTMLSelectElement;
  const lastSyncText = document.getElementById('emby-last-sync');
  const connectionStatus = document.getElementById('emby-connection-status');
  const syncStatus = document.getElementById('emby-sync-status');

  if (enabledCheckbox) {
    enabledCheckbox.checked = config.server?.enabled || false;
    content.style.display = enabledCheckbox.checked ? 'block' : 'none';
    enabledCheckbox.addEventListener('change', () => {
      content.style.display = enabledCheckbox.checked ? 'block' : 'none';
    });
  }

  if (serverTypeSelect) serverTypeSelect.value = config.server?.type || 'emby';
  if (serverUrlInput) serverUrlInput.value = config.server?.url || '';
  if (apiKeyInput) apiKeyInput.value = config.server?.apiKey || '';
  if (showOnListCheckbox) showOnListCheckbox.checked = config.libraryStatus?.showOnList ?? true;
  if (showOnDetailCheckbox) showOnDetailCheckbox.checked = config.libraryStatus?.showOnDetail ?? true;
  if (syncIntervalSelect) syncIntervalSelect.value = String(config.sync?.scheduledIntervalMinutes || 60);

  // 同步模式切换
  const syncModeRadios = document.querySelectorAll('input[name="emby-sync-mode"]') as NodeListOf<HTMLInputElement>;
  const intervalField = document.getElementById('emby-interval-field');

  syncModeRadios.forEach(radio => {
    radio.checked = radio.value === (config.sync?.mode || 'manual');
    radio.addEventListener('change', () => {
      if (intervalField) {
        intervalField.style.display = radio.value === 'scheduled' ? 'block' : 'none';
      }
    });
  });

  // 初始化显示状态
  if (intervalField) {
    const checkedRadio = document.querySelector('input[name="emby-sync-mode"]:checked') as HTMLInputElement;
    intervalField.style.display = checkedRadio?.value === 'scheduled' ? 'block' : 'none';
  }

  // 显示上次同步信息
  if (lastSyncText) {
    if (config.server?.lastSyncTime) {
      const date = new Date(config.server.lastSyncTime);
      lastSyncText.textContent = `上次同步: ${date.toLocaleString()}`;
    }
  }

  // 测试连接按钮
  const testBtn = document.getElementById('emby-test-connection');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      if (connectionStatus) {
        connectionStatus.textContent = '测试中...';
        connectionStatus.style.color = '#666';
      }
      
      const result = await sendMessage({
        type: 'EMBY_LIBRARY_TEST_CONNECTION',
        config: {
          url: serverUrlInput?.value,
          apiKey: apiKeyInput?.value,
        },
      });

      if (connectionStatus) {
        if (result?.success) {
          connectionStatus.textContent = `✓ ${result.message}${result.serverName ? ` (${result.serverName})` : ''}`;
          connectionStatus.style.color = '#48c774';
        } else {
          connectionStatus.textContent = `✗ ${result?.message || '连接失败'}`;
          connectionStatus.style.color = '#f14668';
        }
      }
    });
  }

  // 同步按钮
  const syncBtn = document.getElementById('emby-sync-now');
  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      if (syncStatus) {
        syncStatus.textContent = '同步中...';
        syncStatus.style.color = '#666';
      }
      
      const result = await sendMessage({ type: 'EMBY_LIBRARY_SYNC' });

      if (syncStatus) {
        if (result?.success) {
          syncStatus.textContent = `✓ 同步成功，共 ${result.index?.totalCount || 0} 条`;
          syncStatus.style.color = '#48c774';
          if (lastSyncText) {
            lastSyncText.textContent = `上次同步: ${new Date().toLocaleString()}`;
          }
        } else {
          syncStatus.textContent = `✗ ${result?.error || '同步失败'}`;
          syncStatus.style.color = '#f14668';
        }
      }
    });
  }

  // 保存按钮
  const saveBtn = document.getElementById('emby-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const checkedRadio = document.querySelector('input[name="emby-sync-mode"]:checked') as HTMLInputElement;
      
      const newConfig: Partial<EmbyLibraryConfig> = {
        server: {
          type: serverTypeSelect?.value as 'emby' | 'jellyfin',
          url: serverUrlInput?.value || '',
          apiKey: apiKeyInput?.value || '',
          enabled: enabledCheckbox?.checked || false,
        },
        sync: {
          mode: checkedRadio?.value as 'manual' | 'scheduled' | 'realtime',
          scheduledIntervalMinutes: parseInt(syncIntervalSelect?.value || '60'),
        },
        libraryStatus: {
          enabled: enabledCheckbox?.checked || false,
          showOnList: showOnListCheckbox?.checked ?? true,
          showOnDetail: showOnDetailCheckbox?.checked ?? true,
        },
      };

      await sendMessage({
        type: 'EMBY_LIBRARY_UPDATE_CONFIG',
        config: newConfig,
      });

      showToast('设置已保存', 'success');
    });
  }
}
```

- [ ] **Step 3: 创建入口文件**

```typescript
// src/dashboard/tabs/settings/emby/index.ts

import { initEmbySettings } from './EmbySettings';

export function registerEmbySettings(): void {
  // 设置页面初始化时会自动调用
  window.addEventListener('load', () => {
    if (document.getElementById('emby-settings-content')) {
      void initEmbySettings();
    }
  });
}

export { EmbySettings } from './EmbySettings';
```

- [ ] **Step 4: 创建样式文件**

```css
/* src/dashboard/styles/05-pages/settings/emby.css */

/* Emby 设置页面样式 */

#emby-settings-content .box {
  background: var(--card-bg);
  border-radius: 8px;
  padding: 1.5rem;
}

#emby-settings-content .title.is-6 {
  color: var(--text-primary);
  font-weight: 600;
}

#emby-settings-content .label {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

#emby-settings-content .input {
  background: var(--input-bg);
  border-color: var(--border-color);
  color: var(--text-primary);
}

#emby-settings-content .input:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.1);
}

#emby-settings-content .input::placeholder {
  color: var(--text-muted);
}

#emby-settings-content .select select {
  background: var(--input-bg);
  border-color: var(--border-color);
  color: var(--text-primary);
}

#emby-settings-content .radio label {
  color: var(--text-primary);
}

/* 开关样式 */
#emby-settings-content .switch input:checked + .slider {
  background-color: #48c774;
}

#emby-settings-content .switch .slider {
  background-color: #dbdbdb;
}

/* 帮助文本 */
#emby-settings-content .help {
  color: var(--text-muted);
  font-size: 0.8rem;
}

/* 连接状态 */
#emby-connection-status,
#emby-sync-status {
  font-size: 0.875rem;
  vertical-align: middle;
}
```

---

### Task 9: 设置页面注册和集成

**Files:**
- Modify: `src/dashboard/partials/tabs/settings-index.html`
- Modify: `src/dashboard/tabs/resources.ts`
- Modify: `src/dashboard/tabs/settings/index.ts`
- Modify: `src/dashboard/styles/05-pages/settings/index.css`

- [ ] **Step 1: 添加导航卡片到 settings-index.html**

在设置索引页面中添加 Emby 联动导航卡片：
```html
<a href="#tab-settings/emby-settings" class="settings-nav-card">
  <div class="card-icon">
    <i class="fas fa-server"></i>
  </div>
  <div class="card-content">
    <h3>Emby 联动</h3>
    <p>Emby/Jellyfin 媒体库联动</p>
  </div>
</a>
```

- [ ] **Step 2: 修改 resources.ts 注册资源**

在 `src/dashboard/tabs/resources.ts` 中添加：
```typescript
'tab-settings-emby': {
  type: 'html' as const,
  path: 'tabs/settings-emby.html',
},
```

- [ ] **Step 3: 修改 settings/index.ts 注册设置面板**

在导入部分添加：
```typescript
import { registerEmbySettings } from './emby';
```

在 `initializeSettings` 或类似初始化函数中添加：
```typescript
// 注册 Emby 设置面板
registerEmbySettings();
```

- [ ] **Step 4: 修改 index.css 添加 import**

在 `src/dashboard/styles/05-pages/settings/index.css` 中添加：
```css
@import url('./emby.css');
```

---

### Task 10: Content Script 集成

**Files:**
- Modify: `src/apps/content/contentMessageRouter.ts`
- Modify: `src/features/contentState/index.ts`

- [ ] **Step 1: 添加 EmbyLibraryState 到 contentState**

在 `src/features/contentState/index.ts` 中添加：
```typescript
import type { LibraryIndex } from '../embyLibrary/domain/types';

export interface ContentState {
  // ... 现有字段
  embyLibraryState: LibraryIndex | null;
}
```

- [ ] **Step 2: 修改 contentMessageRouter.ts 处理库状态更新**

在消息处理中添加：
```typescript
import { LibraryIndex } from '../embyLibrary/domain/types';

// 添加消息类型
const EMBY_LIBRARY_STATE_UPDATED = 'EMBY_LIBRARY_STATE_UPDATED';

// case 处理
case EMBY_LIBRARY_STATE_UPDATED: {
  STATE.embyLibraryState = message.state as LibraryIndex;
  processVisibleItems(); // 重新处理列表项
  break;
}
```

---

### Task 11: Telemetry 和设置搜索

**Files:**
- Modify: `src/features/telemetry/domain/featureCatalog.ts`
- Modify: `src/features/telemetry/domain/types.ts`
- Modify: `src/features/settingsSearch/domain/aliases.ts`
- Modify: `src/dashboard/tabs/settings/advanced/AdvancedSettings.ts`

- [ ] **Step 1: 添加 telemetry 条目**

在 `src/features/telemetry/domain/featureCatalog.ts` 中添加：
```typescript
{
  id: 'embyLibrary',
  label: 'Emby 联动',
  category: 'enhancement',
  description: 'Emby/Jellyfin 媒体库联动',
}
```

- [ ] **Step 2: 添加设置搜索别名**

在 `src/features/settingsSearch/domain/aliases.ts` 中添加：
```typescript
{
  term: 'emby',
  aliases: ['jellyfin', '媒体库', '已入库'],
  target: 'tab-settings/emby-settings',
}
```

- [ ] **Step 3: 添加高级设置映射**

在 `src/dashboard/tabs/settings/advanced/AdvancedSettings.ts` 中添加：
```typescript
// 在搜索别名映射中添加
embyLibrary: 'Emby 联动',
```

---

### Task 12: 模块入口文件

**Files:**
- Create: `src/features/embyLibrary/index.ts`

- [ ] **Step 1: 创建模块入口**

```typescript
// src/features/embyLibrary/index.ts

// Re-export all public types and functions
export * from './domain/types';
export * from './domain/matcher';
export * from './domain/libraryIndex';
export * from './background/handlers';
export * from './background/scheduler';
export * from './content/statusBadges';
export * from './content/realtimeCheck';
```

---

## 验证步骤

1. **构建扩展**: `node node_modules/vite/bin/vite.js build`
2. **加载到 Chrome**: 打开 `chrome://extensions/`，加载 `dist` 目录
3. **测试设置页面**: 打开扩展 Dashboard，访问 Emby 联动设置页
4. **测试服务器连接**: 填写 Emby 服务器地址和 API Key，点击测试连接
5. **测试同步**: 点击立即同步，查看是否能成功同步数据
6. **测试标记显示**: 浏览 JAVDB 网站，查看影片封面是否显示"已入库"标记

---

**Spec 覆盖率检查**：

| 设计章节 | 对应任务 |
|---------|---------|
| 3.1 模块结构 | Task 1-7, 12 |
| 3.2 数据流 | Task 4, 8 |
| 4.1 类型定义 | Task 1 |
| 4.2 番号匹配器 | Task 2 |
| 4.3 库索引管理 | Task 3 |
| 4.4 后台处理器 | Task 4 |
| 4.5 定时调度器 | Task 4 |
| 4.6 封面标记渲染 | Task 5 |
| 4.7 实时查询 | Task 5 |
| 5. 设置页面设计 | Task 8 |
| 6. 存储设计 | Task 1, 4 |
| 7. 错误处理 | Task 3, 4 |
| 8. 集成点 | Task 6, 7, 9, 10, 11 |

**Plan saved to**: `docs/superpowers/plans/2026-06-21-emby-library-plan.md`