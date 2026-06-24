# Emby 联动功能设计文档

**日期**: 2026-06-21
**功能名称**: Emby联动
**状态**: 待实现

---

## 1. 功能概述

实时监测 Emby/Jellyfin 媒体库中的影片，在浏览 JAVDB 网站时，如果 Emby 库中存在该影片，则在影片封面右上角用绿色字体显示"已入库"标记。

---

## 2. 需求规格

| 项目 | 规格 |
|------|------|
| 功能名称 | Emby联动 |
| 服务器连接 | 手动配置（服务器地址 + API Key） |
| 匹配逻辑 | 智能匹配：精确匹配优先，找不到时自动尝试模糊匹配（忽略大小写、去除分隔符等） |
| 同步策略 | 同时支持三种模式：一次性手动同步、定时自动同步、实时查询 |
| 服务器数量 | 单服务器（仅支持配置一个 Emby 或 Jellyfin 服务器） |
| 设置位置 | Dashboard 独立设置页（新增"Emby联动"标签页） |

---

## 3. 架构设计

### 3.1 模块结构

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
├── index.ts                  # 注册入口
└── emby.html                 # 设置页面模板

src/dashboard/styles/05-pages/settings/
└── emby.css                  # 设置页样式
```

### 3.2 数据流

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Dashboard 设置页                            │
│  用户配置：服务器地址、API Key、同步模式、定时间隔                    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ chrome.storage.local
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Background Service                          │
│  - 接收同步请求                                                      │
│  - 定时调度同步任务                                                  │
│  - 调用 Emby/Jellyfin API 获取媒体库数据                            │
│  - 存储库索引到 chrome.storage.local                                │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ chrome.runtime.sendMessage
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Content Script                              │
│  - 列表页：遍历影片卡片，匹配番号，渲染封面标记                       │
│  - 详情页：匹配当前影片番号，渲染封面标记                            │
│  - 实时查询模式：直接向 Emby API 查询                               │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Emby/Jellyfin Server                        │
│  API: /Items?Fields=ProviderIds&Filters=IsNotFolder                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. 核心组件设计

### 4.1 类型定义 (domain/types.ts)

```typescript
// 服务器类型
type ServerType = 'emby' | 'jellyfin';

// 服务器配置
interface EmbyServerConfig {
  type: ServerType;
  url: string;           // 服务器地址，如 http://192.168.1.100:8096
  apiKey: string;        // API Key
  enabled: boolean;      // 是否启用
}

// 同步模式
type SyncMode = 'manual' | 'scheduled' | 'realtime';

// 同步配置
interface EmbySyncConfig {
  mode: SyncMode;                    // 同步模式
  scheduledIntervalMinutes: number;  // 定时同步间隔（分钟），默认 60
}

// 库索引条目
interface LibraryIndexEntry {
  id: string;            // Emby/Jellyfin 媒体项 ID
  name: string;          // 原始名称
  providerIds: {         // 外部提供商 ID
    jav?: string;        // JAV 番号
    [key: string]: string | undefined;
  };
  normalizedCodes: string[];  // 标准化后的番号列表（用于模糊匹配）
}

// 库索引
interface LibraryIndex {
  entries: LibraryIndexEntry[];
  lastSyncTime: number;  // 上次同步时间戳
  totalCount: number;    // 总条目数
}

// 功能总配置
interface EmbyLibraryConfig {
  server: EmbyServerConfig;
  sync: EmbySyncConfig;
  libraryStatus: {
    enabled: boolean;    // 是否启用库状态显示
    showOnList: boolean; // 列表页显示
    showOnDetail: boolean; // 详情页显示
  };
}
```

### 4.2 番号匹配器 (domain/matcher.ts)

**匹配策略**：

1. **精确匹配**: 直接比较番号字符串（忽略大小写）
2. **模糊匹配**: 去除分隔符 `-`，比较纯字母数字组合

```typescript
// 示例匹配逻辑
function matchCode(videoId: string, index: LibraryIndex): LibraryIndexEntry | null {
  const normalizedVideoId = normalizeCode(videoId);

  // 精确匹配
  for (const entry of index.entries) {
    if (entry.providerIds.jav?.toLowerCase() === videoId.toLowerCase()) {
      return entry;
    }
  }

  // 模糊匹配
  for (const entry of index.entries) {
    for (const code of entry.normalizedCodes) {
      if (code === normalizedVideoId) {
        return entry;
      }
    }
  }

  return null;
}

function normalizeCode(code: string): string {
  return code.toLowerCase().replace(/[-_\s]/g, '');
}
```

### 4.3 库索引管理 (domain/libraryIndex.ts)

**职责**：
- 从 Emby/Jellyfin API 获取媒体库数据
- 构建本地索引缓存
- 提供番号查询接口

**Emby API 调用**：
```
GET {serverUrl}/Items
  ?api_key={apiKey}
  &Fields=ProviderIds
  &Filters=IsNotFolder
  &IncludeItemTypes=Movie
  &Recursive=true
```

### 4.4 后台处理器 (background/handlers.ts)

**处理的消息类型**：

| 消息类型 | 说明 |
|---------|------|
| `EMBY_LIBRARY_SYNC` | 手动触发同步 |
| `EMBY_LIBRARY_GET_INDEX` | 获取库索引 |
| `EMBY_LIBRARY_CHECK_CODE` | 实时查询单个番号 |
| `EMBY_LIBRARY_CLEAR_INDEX` | 清除本地索引 |

### 4.5 定时调度器 (background/scheduler.ts)

**职责**：
- 根据 `sync.scheduledIntervalMinutes` 设置定时任务
- 使用 `chrome.alarms` API 实现定时触发
- 定时触发时调用同步逻辑更新索引

### 4.6 封面标记渲染 (content/statusBadges.ts)

**渲染位置**：
- 列表页：影片卡片封面右上角
- 详情页：主封面右上角

**样式规格**：
```css
.emby-library-cover-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  background: rgba(34, 197, 94, 0.92);  /* 绿色背景 */
  color: white;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 12px;
  z-index: 10;
  pointer-events: none;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}
```

**渲染函数**：
```typescript
function renderLibraryStatusCoverBadge(item: HTMLElement, videoId: string): void {
  // 1. 检查功能是否启用
  // 2. 查询番号是否在库中（根据同步模式选择查询方式）
  // 3. 如果存在，创建标记元素并定位到封面右上角
}
```

### 4.7 实时查询 (content/realtimeCheck.ts)

**职责**：
- 当同步模式为 `realtime` 时，直接向 Emby/Jellyfin API 查询番号
- 使用队列管理请求，避免频繁请求
- 支持请求超时和错误处理

---

## 5. 设置页面设计

### 5.1 页面布局

```
┌─────────────────────────────────────────────────────────────────┐
│  Emby联动                                                        │
├─────────────────────────────────────────────────────────────────┤
│  [开关] 启用 Emby 联动功能                                        │
├─────────────────────────────────────────────────────────────────┤
│  服务器配置                                                       │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 服务器类型: [Emby ▼] / [Jellyfin ▼]                         ││
│  │ 服务器地址: [http://192.168.1.100:8096        ]             ││
│  │ API Key:    [xxxxxxxxxxxxxxxx                 ]             ││
│  │ [测试连接]  连接状态: ✓ 已连接 / ✗ 连接失败                  ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│  同步设置                                                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 同步模式:                                                    ││
│  │   ○ 手动同步 - 用户手动触发同步                              ││
│  │   ○ 定时同步 - 自动定时更新库数据                            ││
│  │   ○ 实时查询 - 每次浏览时实时查询服务器                      ││
│  │                                                              ││
│  │ 定时同步间隔（分钟）: [60 ▼]  (仅定时同步模式有效)           ││
│  │                                                              ││
│  │ [立即同步]  上次同步: 2026-06-21 15:30  共 1,234 条          ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│  显示设置                                                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ [✓] 在列表页显示"已入库"标记                                 ││
│  │ [✓] 在详情页显示"已入库"标记                                 ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│  [保存设置]                                                       │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 设置项说明

| 设置项 | 类型 | 默认值 | 说明 |
|-------|------|-------|------|
| 启用功能 | boolean | false | 总开关 |
| 服务器类型 | enum | 'emby' | Emby 或 Jellyfin |
| 服务器地址 | string | '' | 服务器 URL |
| API Key | string | '' | 认证密钥 |
| 同步模式 | enum | 'manual' | 手动/定时/实时 |
| 定时间隔 | number | 60 | 分钟，范围 10-1440 |
| 列表页显示 | boolean | true | 是否在列表页显示标记 |
| 详情页显示 | boolean | true | 是否在详情页显示标记 |

---

## 6. 存储设计

### 6.1 存储键

```typescript
// config.ts 中新增
STORAGE_KEYS: {
  EMBY_LIBRARY_CONFIG: 'emby_library_config',   // 功能配置
  EMBY_LIBRARY_INDEX: 'emby_library_index',     // 库索引缓存
}
```

### 6.2 默认配置

```typescript
// config.ts 中新增
const DEFAULT_EMBY_LIBRARY_CONFIG: EmbyLibraryConfig = {
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

---

## 7. 错误处理

| 场景 | 处理方式 |
|------|---------|
| 服务器连接失败 | 显示错误提示，不阻止用户保存配置 |
| API Key 无效 | 测试连接时返回错误，提示用户检查 |
| 同步超时 | 30秒超时，显示"同步失败"提示 |
| 实时查询失败 | 静默失败，不显示标记 |
| 库索引为空 | 提示用户先同步数据 |

---

## 8. 与现有功能的集成点

| 集成点 | 说明 |
|-------|------|
| `itemProcessor.ts` | 列表页处理时调用 `renderLibraryStatusCoverBadge` |
| `pageHandler.ts` | 详情页处理时调用封面标记渲染 |
| `settings/index.ts` | 注册 Emby 设置面板 |
| `resources.ts` | 注册 emby.html 资源 |
| `settings-index.html` | 添加"Emby联动"导航卡片 |
| `bootstrap.ts` | 初始化时加载库索引状态 |
| `contentMessageRouter.ts` | 处理 Emby 相关消息 |

---

## 9. 实现优先级

1. **P0 - 核心功能**
   - 类型定义
   - 番号匹配器
   - 库索引管理
   - 后台处理器
   - 封面标记渲染

2. **P1 - 设置页面**
   - 设置面板逻辑
   - 设置页面模板
   - 设置页样式

3. **P2 - 定时同步**
   - 定时调度器

4. **P3 - 实时查询**
   - 实时查询逻辑

---

## 10. 测试要点

- 连接测试：正确/错误的服务器地址和 API Key
- 匹配测试：精确匹配、模糊匹配、无匹配
- 同步测试：手动同步、定时同步、实时查询
- 显示测试：列表页、详情页、开关控制
- 性能测试：大量库数据时的匹配性能