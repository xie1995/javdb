import { getValue, setValue, getSettings } from '../utils/storage';
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../utils/config';
import type { ExtensionSettings, VideoRecord, LogEntry } from '../types';
import { logAsync } from './logger';
import { showMessage } from './ui/toast';
import { getDisplayVersionInfo } from '../shared/utils/versionInfo';
import { dbViewedGetAll } from './dbClient';
import type { LibraryIndex, EmbyWatchedData } from '../features/embyLibrary/domain/types';

// --- Global State & Utilities ---

export interface DashboardState {
    settings: ExtensionSettings;
    records: VideoRecord[];
    logs: LogEntry[];
    isInitialized: boolean;
    embyLibraryState?: LibraryIndex;
    embyWatchedState?: EmbyWatchedData;
}

export const STATE: DashboardState = {
    settings: DEFAULT_SETTINGS,
    records: [],
    logs: [],
    isInitialized: false,
};

export async function initializeGlobalState(): Promise<void> {
    if (STATE.isInitialized) return;

    try {
        let settings = await getSettings();

        // --- Settings Migration Logic ---
        let settingsChanged = false;

        // --- Version Sync Logic ---
        let manifestVersion = '';
        try {
            manifestVersion = chrome?.runtime?.getManifest?.().version || '';
        } catch {}
        const actualVersion = getDisplayVersionInfo({
            manifestVersion,
            env: import.meta.env,
        }).version;
        if (settings.version !== actualVersion) {
            settings.version = actualVersion;
            settingsChanged = true;
            await logAsync('INFO', `[Dashboard] 版本号已更新到: ${actualVersion}`);
        }
        // --- End Version Sync Logic ---
        if (settings.searchEngines && Array.isArray(settings.searchEngines)) {
            const migratedEngines = settings.searchEngines.map((engine: any) => {
                let currentEngine = { ...engine };
                let hasChanged = false;

                // 1. Migrate from iconUrl to icon
                if (currentEngine.iconUrl && !currentEngine.icon) {
                    currentEngine.icon = currentEngine.iconUrl;
                    delete currentEngine.iconUrl;
                    hasChanged = true;
                }

                // 2. Correct the icon path for default engines if they are using a remote URL
                // 只修复使用远程URL的图标，不要覆盖用户的自定义设置
                if (currentEngine.name === 'JavDB' && currentEngine.icon && currentEngine.icon.startsWith('http')) {
                    currentEngine.icon = 'assets/favicons/light/favicon-32x32.png';
                    hasChanged = true;
                }
                if (currentEngine.name === 'Javbus' && currentEngine.icon && currentEngine.icon.startsWith('http')) {
                    currentEngine.icon = 'assets/javbus.ico';
                    hasChanged = true;
                }

                // 3. 清理包含 example.com 的测试数据
                if (currentEngine.urlTemplate && currentEngine.urlTemplate.includes('example.com')) {
                    currentEngine.urlTemplate = 'https://www.google.com/search?q={{ID}}';
                    currentEngine.icon = chrome.runtime.getURL('assets/alternate-search.png');
                    hasChanged = true;
                }

                // 4. 修复使用 Google favicon 服务的图标
                if (currentEngine.icon && currentEngine.icon.includes('google.com/s2/favicons')) {
                    currentEngine.icon = chrome.runtime.getURL('assets/alternate-search.png');
                    hasChanged = true;
                }

                // 5. Ensure ID exists
                if (!currentEngine.id) {
                    currentEngine.id = `engine-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                    hasChanged = true;
                }

                if(hasChanged) {
                    settingsChanged = true;
                }
                return currentEngine;
            });


            if (settingsChanged) {
                settings.searchEngines = migratedEngines;
            }

            // 6. 过滤掉任何仍然包含 example.com 的搜索引擎
            const cleanEngines = settings.searchEngines.filter((engine: any) => {
                const hasExampleDomain = engine.urlTemplate && engine.urlTemplate.includes('example.com');
                const hasGoogleFavicon = engine.icon && engine.icon.includes('google.com/s2/favicons');

                if (hasExampleDomain || hasGoogleFavicon) {
                    logAsync('INFO', '[Dashboard] 移除包含测试数据的搜索引擎', { engine });
                    settingsChanged = true;
                    return false;
                }
                return true;
            });

            if (cleanEngines.length !== settings.searchEngines.length) {
                settings.searchEngines = cleanEngines;
                settingsChanged = true;
            }
        }
        // --- End Migration Logic ---

        // Save settings if any changes were made
        if (settingsChanged) {
            await setValue(STORAGE_KEYS.SETTINGS, settings);
            await logAsync('INFO', '[Dashboard] 设置已更新并保存。');
        }

        STATE.settings = settings;

        try {
            // 从 IndexedDB 加载番号记录（收藏、评分等操作均写入 IndexedDB）
            STATE.records = await dbViewedGetAll();
        } catch (error) {
            console.error('从 IndexedDB 加载记录数据失败:', error);
            // 兜底：仍尝试从 chrome.storage.local 读取旧数据
            try {
                const recordsData = await getValue<Record<string, VideoRecord>>(STORAGE_KEYS.VIEWED_RECORDS, {});
                STATE.records = Object.values(recordsData || {});
            } catch {
                STATE.records = [];
            }
        }

        try {
            const logsData = await getValue<LogEntry[]>(STORAGE_KEYS.LOGS, []);
            // 确保 logsData 是数组
            if (Array.isArray(logsData)) {
                STATE.logs = logsData;
            } else {
                console.warn('日志数据不是数组格式:', logsData);
                STATE.logs = [];
            }
        } catch (error) {
            console.error('加载日志数据失败:', error);
            STATE.logs = [];
        }

        // 从 chrome.storage.local 加载 Emby 库索引（用于收藏中心"已入库 Emby"计数）
        try {
            const embyData = await getValue<LibraryIndex | null>(STORAGE_KEYS.EMBY_LIBRARY_INDEX, null);
            if (embyData && typeof embyData === 'object' && Array.isArray(embyData.entries)) {
                STATE.embyLibraryState = embyData;
            }
        } catch (error) {
            console.error('加载 Emby 库索引失败:', error);
        }

        // 从 chrome.storage.local 加载 Emby 已观看记录
        try {
            const watchedData = await getValue<EmbyWatchedData | null>(STORAGE_KEYS.EMBY_WATCHED_PERMANENT, null);
            if (watchedData && typeof watchedData === 'object' && Array.isArray(watchedData.codes)) {
                STATE.embyWatchedState = watchedData;
            }
        } catch (error) {
            console.error('加载 Emby 已观看数据失败:', error);
        }
    } catch (error: any) {
        console.error("Failed to initialize global state:", error);
        showMessage(`Failed to load settings: ${error.message}`, 'error');
        // 确保在出错时也有安全的默认值
        STATE.records = [];
        STATE.logs = [];
    }
    STATE.isInitialized = true;

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;

        if (changes[STORAGE_KEYS.EMBY_LIBRARY_INDEX]) {
            const newValue = changes[STORAGE_KEYS.EMBY_LIBRARY_INDEX].newValue as LibraryIndex | undefined;
            if (newValue && Array.isArray(newValue.entries)) {
                STATE.embyLibraryState = newValue;
                window.dispatchEvent(new CustomEvent('emby-data-updated'));
            }
        }

        if (changes[STORAGE_KEYS.EMBY_WATCHED_PERMANENT]) {
            const newValue = changes[STORAGE_KEYS.EMBY_WATCHED_PERMANENT].newValue as EmbyWatchedData | undefined;
            if (newValue && Array.isArray(newValue.codes)) {
                STATE.embyWatchedState = newValue;
                window.dispatchEvent(new CustomEvent('emby-data-updated'));
            }
        }
    });
}

/**
 * 清理搜索引擎配置中的测试数据
 */
export async function cleanupSearchEngines(): Promise<void> {
    try {
        const settings = await getValue(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);

        if (!settings.searchEngines || !Array.isArray(settings.searchEngines)) {
            return;
        }

        const originalCount = settings.searchEngines.length;

        // 过滤掉包含测试数据的搜索引擎
        settings.searchEngines = settings.searchEngines.filter((engine: any) => {
            const hasExampleDomain = engine.urlTemplate && engine.urlTemplate.includes('example.com');
            const hasGoogleFavicon = engine.icon && engine.icon.includes('google.com/s2/favicons');

            if (hasExampleDomain || hasGoogleFavicon) {
                logAsync('INFO', '清理包含测试数据的搜索引擎', { engine });
                return false;
            }
            return true;
        });

        const cleanedCount = settings.searchEngines.length;

        if (cleanedCount !== originalCount) {
            await setValue(STORAGE_KEYS.SETTINGS, settings);
            await logAsync('INFO', `搜索引擎清理完成，移除了 ${originalCount - cleanedCount} 个包含测试数据的引擎`);

            // 更新全局状态
            STATE.settings = settings;
        }
    } catch (error: any) {
        await logAsync('ERROR', '清理搜索引擎配置失败', { error: error.message });
    }
}
