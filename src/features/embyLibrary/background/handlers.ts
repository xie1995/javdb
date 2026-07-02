import { STORAGE_KEYS } from '../../../utils/config';
import {
    getLibraryIndex,
    saveLibraryIndex,
    clearLibraryIndex,
    syncLibrary,
    testConnection,
    fetchLibraryFromServer,
    listLibraryFolders,
    getWatchedData,
    clearWatchedData,
    fetchWatchedCodesFromServer,
    mergeWatchedCodes,
} from '../domain/libraryIndex';
import { matchCode } from '../domain/matcher';
import { normalizeCode } from '../domain/matcher';
import type { EmbyLibraryConfig, EmbyServerConfig, LibraryIndex } from '../domain/types';
import { DEFAULT_EMBY_LIBRARY_CONFIG } from '../domain/types';

async function getConfig(): Promise<EmbyLibraryConfig> {
    try {
        const result = await new Promise<Record<string, EmbyLibraryConfig>>((resolve) => {
            chrome.storage.local.get([STORAGE_KEYS.EMBY_LIBRARY_CONFIG], (data) => {
                resolve(data as Record<string, EmbyLibraryConfig>);
            });
        });
        if (result[STORAGE_KEYS.EMBY_LIBRARY_CONFIG]) {
            return result[STORAGE_KEYS.EMBY_LIBRARY_CONFIG];
        }
    } catch (e) {
        console.error('[EmbyLibrary] Failed to get config:', e);
    }
    return { ...DEFAULT_EMBY_LIBRARY_CONFIG };
}

async function saveConfig(config: EmbyLibraryConfig): Promise<void> {
    await new Promise<void>((resolve) => {
        chrome.storage.local.set({
            [STORAGE_KEYS.EMBY_LIBRARY_CONFIG]: config,
        }, () => resolve());
    });

    if (config.sync.autoScheduledSync && config.sync.scheduledIntervalMinutes) {
        scheduleLibrarySync(config.sync.scheduledIntervalMinutes);
    } else {
        cancelLibrarySync();
    }
}

export function handleEmbySyncRequest(sendResponse: (response: any) => void): boolean {
    getConfig().then((config) => {
        if (!config.server.enabled || !config.server.url || !config.server.apiKey) {
            sendResponse({ success: false, error: '服务器未配置或未启用' });
            return;
        }
        syncLibrary(config.server, config.sync.enrichJavdbMetadata, (progress) => {
            // 广播抓取进度给 Dashboard UI
            try {
                chrome.runtime.sendMessage({
                    type: 'EMBY_LIBRARY_ENRICH_PROGRESS',
                    progress,
                }).catch(() => {});
            } catch {}
        })
            .then(({ index, totalFetched, matchedLibraryName, watchedCount }) => sendResponse({ success: true, index, totalFetched, count: index.totalCount, matchedLibraryName, watchedCount }))
            .catch((error: Error) => sendResponse({ success: false, error: error.message }));
    }).catch((error: Error) => {
        sendResponse({ success: false, error: `获取配置失败: ${error.message}` });
    });
    return true;
}

export function handleEmbyGetIndex(sendResponse: (response: any) => void): boolean {
    getLibraryIndex()
        .then((index) => sendResponse({ success: true, index }))
        .catch((error: Error) => sendResponse({ success: false, error: error.message }));
    return true;
}

export function handleEmbyCheckCode(message: any, sendResponse: (response: any) => void): boolean {
    const { videoId } = message;
    if (!videoId) {
        sendResponse({ success: false, matched: false });
        return false;
    }

    getConfig().then(async (config) => {
        if (config.sync.realtimeOnJavdb && config.server.enabled && config.server.url && config.server.apiKey) {
            try {
                const { entries } = await fetchLibraryFromServer(config.server);
                const tempIndex: LibraryIndex = {
                    entries,
                    lastSyncTime: Date.now(),
                    totalCount: entries.length,
                };
                const matched = matchCode(videoId, tempIndex);
                sendResponse({ success: true, matched });
            } catch (e) {
                const index = await getLibraryIndex();
                sendResponse({ success: true, matched: matchCode(videoId, index) });
            }
        } else {
            const index = await getLibraryIndex();
            sendResponse({ success: true, matched: matchCode(videoId, index) });
        }
    }).catch((e: Error) => {
        console.error('[EmbyLibrary] handleEmbyCheckCode failed:', e);
        sendResponse({ success: false, matched: false, error: e.message });
    });
    return true;
}

export function handleEmbyClearIndex(sendResponse: (response: any) => void): boolean {
    clearLibraryIndex()
        .then(() => sendResponse({ success: true }))
        .catch((error: Error) => sendResponse({ success: false, error: error.message }));
    return true;
}

export function handleEmbyTestConnection(message: any, sendResponse: (response: any) => void): boolean {
    const { config } = message;
    if (!config) {
        sendResponse({ success: false, message: '缺少配置' });
        return false;
    }
    testConnection(config as EmbyServerConfig)
        .then((result) => sendResponse(result))
        .catch((error: Error) => sendResponse({ success: false, message: error.message }));
    return true;
}

export function handleEmbyUpdateConfig(message: any, sendResponse: (response: any) => void): boolean {
    const { config } = message;
    if (!config) {
        sendResponse({ success: false, error: '缺少配置' });
        return false;
    }
    saveConfig(config as EmbyLibraryConfig)
        .then(() => sendResponse({ success: true }))
        .catch((error: Error) => sendResponse({ success: false, error: error.message }));
    return true;
}

export function handleEmbyGetConfig(sendResponse: (response: any) => void): boolean {
    getConfig()
        .then((config) => sendResponse({ success: true, config }))
        .catch((error: Error) => sendResponse({ success: false, error: error.message }));
    return true;
}

export function handleEmbyListFolders(sendResponse: (response: any) => void): boolean {
    getConfig()
        .then((config) => listLibraryFolders(config.server))
        .then((folders) => sendResponse({ success: true, folders }))
        .catch((error: Error) => sendResponse({ success: false, error: error.message, folders: [] }));
    return true;
}

export function handleEmbyGetWatched(sendResponse: (response: any) => void): boolean {
    getWatchedData()
        .then((data) => sendResponse({ success: true, data }))
        .catch((error: Error) => sendResponse({ success: false, error: error.message }));
    return true;
}

export function handleEmbyCheckWatched(message: any, sendResponse: (response: any) => void): boolean {
    const { videoId } = message;
    if (!videoId) {
        sendResponse({ success: false, matched: false });
        return false;
    }
    getWatchedData()
        .then((data) => {
            const normalized = normalizeCode(videoId);
            const matched = data.codes.includes(normalized);
            sendResponse({ success: true, matched });
        })
        .catch((error: Error) => sendResponse({ success: false, error: error.message }));
    return true;
}

export function handleEmbyClearWatched(sendResponse: (response: any) => void): boolean {
    clearWatchedData()
        .then(() => sendResponse({ success: true }))
        .catch((error: Error) => sendResponse({ success: false, error: error.message }));
    return true;
}

export function handleEmbySyncWatched(sendResponse: (response: any) => void): boolean {
    const NOW = Date.now();
    const MIN_INTERVAL = 5 * 60 * 1000;
    if (_lastWatchedSyncTime && NOW - _lastWatchedSyncTime < MIN_INTERVAL) {
        // 5 分钟内已同步过，跳过
        sendResponse({ success: true, totalWatched: 0, newCodes: 0, addedCount: 0, skipped: true });
        return false;
    }
    _lastWatchedSyncTime = NOW;
    console.log('[EmbyLibrary] Starting watched-only sync...');
    getConfig().then(async (config) => {
        if (!config.server.url || !config.server.apiKey) {
            sendResponse({ success: false, error: '服务器未配置' });
            return;
        }
        try {
            const newCodes = await fetchWatchedCodesFromServer(config.server);
            const addedCount = await mergeWatchedCodes(newCodes);
            const data = await getWatchedData();
            sendResponse({ success: true, totalWatched: data.codes.length, newCodes: newCodes.length, addedCount });
        } catch (e) {
            const err = e as Error;
            console.error('[EmbyLibrary] Watched sync failed:', err);
            sendResponse({ success: false, error: err.message || String(e) });
        }
    }).catch((err) => {
        sendResponse({ success: false, error: String(err) });
    });
    return true;
}

async function handleEmbyPlaybackStart(
    message: { type: string; codes: string[]; name?: string },
    sendResponse: (response: any) => void
): Promise<boolean> {
    const { codes, name } = message;
    if (!codes || !Array.isArray(codes) || codes.length === 0) {
        sendResponse({ success: true, addedCount: 0, skipped: true });
        return false;
    }

    try {
        const addedCount = await mergeWatchedCodes(codes);
        console.log(`[EmbyLibrary] PlaybackStart: "${name}" → ${codes.join(', ')} → added ${addedCount} new codes`);
        sendResponse({ success: true, addedCount });
    } catch (e) {
        console.error('[EmbyLibrary] PlaybackStart handler error:', e);
        sendResponse({ success: false, error: String(e) });
    }
    return false;
}

const ALARM_NAME = 'emby_library_sync';

let _lastWatchedSyncTime = 0;

export function scheduleLibrarySync(intervalMinutes: number): void {
    try {
        chrome.alarms.clear(ALARM_NAME);
        const periodInMinutes = Math.max(1, intervalMinutes);
        chrome.alarms.create(ALARM_NAME, {
            delayInMinutes: periodInMinutes,
            periodInMinutes: periodInMinutes,
        });
        console.log(`[EmbyLibrary] Scheduled sync every ${periodInMinutes} minutes`);
    } catch (e) {
        console.error('[EmbyLibrary] Failed to schedule alarm:', e);
    }
}

export function cancelLibrarySync(): void {
    try {
        chrome.alarms.clear(ALARM_NAME);
    } catch (e) {
        console.error('[EmbyLibrary] Failed to cancel alarm:', e);
    }
}

export async function handleScheduledSync(): Promise<void> {
    try {
        const config = await getConfig();
        if (!config.server.enabled || !config.server.url || !config.server.apiKey) return;
        const { totalFetched } = await syncLibrary(config.server, config.sync.enrichJavdbMetadata);
        console.log(`[EmbyLibrary] Scheduled sync completed (${totalFetched} items)`);
    } catch (e) {
        console.error('[EmbyLibrary] Scheduled sync failed:', e);
    }
}

async function handleEnrichControl(
    message: { type: string },
    sendResponse: (response: any) => void
): Promise<void> {
    const ENRICH_CONTROL_KEY = 'emby_enrich_control';
    const typeMap: Record<string, string> = {
        'EMBY_ENRICH_PAUSE': 'paused',
        'EMBY_ENRICH_RESUME': 'running',
        'EMBY_ENRICH_STOP': 'stopped',
    };
    const value = typeMap[message.type];
    if (value) {
        await chrome.storage.local.set({ [ENRICH_CONTROL_KEY]: value });
        sendResponse({ success: true, control: value });
    } else {
        sendResponse({ success: false, error: 'unknown control' });
    }
}

export function registerEmbyBackgroundHandlers(): void {
    try {
        chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse): boolean | void => {
            if (!message || typeof message !== 'object') return false;
            switch (message.type) {
                case 'EMBY_LIBRARY_SYNC':
                    return handleEmbySyncRequest(sendResponse);
                case 'EMBY_LIBRARY_GET_INDEX':
                    return handleEmbyGetIndex(sendResponse);
                case 'EMBY_LIBRARY_CHECK_CODE':
                    return handleEmbyCheckCode(message, sendResponse);
                case 'EMBY_LIBRARY_CLEAR_INDEX':
                    return handleEmbyClearIndex(sendResponse);
                case 'EMBY_LIBRARY_TEST_CONNECTION':
                    return handleEmbyTestConnection(message, sendResponse);
                case 'EMBY_LIBRARY_UPDATE_CONFIG':
                    return handleEmbyUpdateConfig(message, sendResponse);
                case 'EMBY_LIBRARY_GET_CONFIG':
                    return handleEmbyGetConfig(sendResponse);
                case 'EMBY_LIBRARY_LIST_FOLDERS':
                    return handleEmbyListFolders(sendResponse);
                case 'EMBY_WATCHED_GET':
                    return handleEmbyGetWatched(sendResponse);
                case 'EMBY_WATCHED_CHECK':
                    return handleEmbyCheckWatched(message, sendResponse);
                case 'EMBY_WATCHED_CLEAR':
                    return handleEmbyClearWatched(sendResponse);
                case 'EMBY_LIBRARY_SYNC_WATCHED':
                    return handleEmbySyncWatched(sendResponse);
                case 'EMBY_PLAYBACK_START':
                    handleEmbyPlaybackStart(message, sendResponse);
                    return true;
                case 'EMBY_ENRICH_PAUSE':
                case 'EMBY_ENRICH_RESUME':
                case 'EMBY_ENRICH_STOP':
                    handleEnrichControl(message, sendResponse);
                    return false;
                default:
                    return false;
            }
        });

        getConfig().then((config) => {
            if (config.sync.autoScheduledSync && config.sync.scheduledIntervalMinutes) {
                scheduleLibrarySync(config.sync.scheduledIntervalMinutes);
            }
        }).catch((e) => {
            console.error('[EmbyLibrary] Failed to initialize scheduled sync:', e);
        });

        try {
            chrome.alarms.onAlarm.addListener((alarm) => {
                if (alarm.name === ALARM_NAME) {
                    handleScheduledSync().catch((e) => {
                        console.error('[EmbyLibrary] Scheduled sync error in listener:', e);
                    });
                }
            });
        } catch (e) {
            console.error('[EmbyLibrary] Failed to add alarm listener:', e);
        }
    } catch (e) {
        console.error('[EmbyLibrary] Failed to register background handlers:', e);
    }
}
