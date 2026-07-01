export type ServerType = 'emby' | 'jellyfin';

export interface EmbyServerConfig {
    type: ServerType;
    url: string;
    apiKey: string;
    enabled: boolean;
    libraryName?: string;
}

export type SyncMode = 'manual' | 'scheduled' | 'realtime';

export interface EmbySyncConfig {
    mode: SyncMode;
    scheduledIntervalMinutes: number;
    lastSyncTime?: number;
    /** JavDB 网页端实时查询（浏览列表/详情时实时查 Emby） */
    realtimeOnJavdb?: boolean;
    /** 定时自动同步番号库（后台定时拉取 Emby 数据到本地缓存） */
    autoScheduledSync?: boolean;
    /** 同步后自动从 JavDB 抓取封面和标题等元数据 */
    enrichJavdbMetadata?: boolean;
}

export interface LibraryIndexEntry {
    id: string;
    name: string;
    providerIds: {
        jav?: string;
        extracted?: string;
        [key: string]: string | undefined;
    };
    normalizedCodes: string[];
    /** Emby/Jellyfin 服务器地址（用于构建详情页跳转链接） */
    serverUrl?: string;
    /** 服务器类型: emby 或 jellyfin */
    serverType?: ServerType;
    /** 服务器 ID（用于构建 Emby 的 item 详情 URL，如 caabb0f42b534a81a93cabae238dd69b） */
    serverId?: string;
    /** @deprecated internal debug field */
    _matchedSource?: 'ProviderIds' | 'Genres' | 'Title' | 'Overview';
}

export interface LibraryIndex {
    entries: LibraryIndexEntry[];
    lastSyncTime: number;
    totalCount: number;
}

export interface EmbyLibraryConfig {
    server: EmbyServerConfig;
    sync: EmbySyncConfig;
    libraryStatus: {
        enabled: boolean;
        showOnList: boolean;
        showOnDetail: boolean;
    };
}

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

export const EMPTY_LIBRARY_INDEX: LibraryIndex = {
    entries: [],
    lastSyncTime: 0,
    totalCount: 0,
};

export interface EmbyWatchedData {
    codes: string[];
    lastSyncTime: number;
}

export const EMPTY_WATCHED_DATA: EmbyWatchedData = {
    codes: [],
    lastSyncTime: 0,
};
