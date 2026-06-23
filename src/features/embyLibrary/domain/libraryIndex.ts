import { STORAGE_KEYS } from '../../../utils/config';
import type { EmbyServerConfig, LibraryIndex, LibraryIndexEntry, EmbyWatchedData } from './types';
import { EMPTY_LIBRARY_INDEX, EMPTY_WATCHED_DATA } from './types';
import { normalizeCode } from './matcher';

/**
 * 从文本中提取可能的 Jav 番号
 * 支持格式: ABC-123, ABC123, FC2-PPV-123456, S2-123, HEYZO-1234, 050826_100 (纯数字带分隔符)
 */
function extractCodesFromText(text: string): string[] {
    if (!text) return [];
    const codes: string[] = [];

    // 1. 结构化 JavDB 番号格式（字母开头）
    const structuredPatterns = [
        /([A-Z]{1,6}[-_]\d{1,6})/gi,
        /([A-Z]{2,6}\d{1,6})/g,
        /(FC2[_-]\w{1,6})/gi,
        /(S2[_-]\d{1,6})/gi,
        /(HEYZO[_-]\d{1,6})/gi,
        /(10mu[_-]\d{1,6})/gi,
        /(CARIBBEAN[_-]\d{1,6})/gi,
        /(MADONNA[_-]\d{1,6})/gi,
    ];

    for (const pattern of structuredPatterns) {
        const matches = text.match(pattern);
        if (matches) {
            for (const match of matches) {
                const cleaned = match.toUpperCase().replace(/[_]/g, '-').replace(/-+/g, '-');
                if (cleaned.length >= 3 && cleaned.length <= 25) {
                codes.push(cleaned);
                }
            }
        }
    }

    // 2. 纯数字格式（无字母，像 050826_100、050826-100）必须带有分隔符
    const numericPatterns = [
        /(\d{4,8}[-_]\d{1,6})/g,
    ];

    for (const pattern of numericPatterns) {
        const matches = text.match(pattern);
        if (matches) {
            for (const match of matches) {
                const cleaned = match.toUpperCase().replace(/[_]/g, '-').replace(/-+/g, '-');
                if (cleaned.length >= 5 && cleaned.length <= 25) {
                    codes.push(cleaned);
                }
            }
        }
    }

    // 移除过于宽松的兜底逻辑，避免从标签/简介中误提取纯数字

    return [...new Set(codes)];
}

/**
 * 从一个影片的完整字段中提取所有可能的番号
 * 只从最可靠的字段提取，避免误匹配
 */
function extractCodesFromItem(item: any): { codes: string[]; source: string } {
    if (!item) return { codes: [], source: '' };

    const allCodes: string[] = [];
    let primarySource = '';

    // 1. ProviderIds（最可靠，专门存储外部 ID）
    const providerIds = item.ProviderIds || {};
    const nonJavKeys = new Set(['tmdb', 'imdb', 'tvdb', 'tvrage', 'mbid', 'musicbrainz', 'audiodb', 'isrc']);
    for (const [key, value] of Object.entries(providerIds)) {
        const str = String(value || '');
        if (str.length > 2 && str.length < 30) {
            const keyLower = key.toLowerCase();
            const isKnownNonJav = nonJavKeys.has(keyLower);
            if (isKnownNonJav) {
                if (!/[-_]/.test(str) && /^\d{5,12}$/.test(str)) {
                    continue;
                }
            }
            const codes = extractCodesFromText(str);
            if (codes.length > 0) {
                allCodes.push(...codes);
                if (!primarySource) primarySource = `ProviderIds.${key}`;
            }
        }
    }

    // 2. Path（文件路径，文件名可能含番号）
    const path: string = item.Path || '';
    const pathCodes = extractCodesFromText(path);
    if (pathCodes.length > 0) {
        allCodes.push(...pathCodes);
        if (!primarySource) primarySource = 'Path';
    }

    // 3. Name（标题，仅作为最后兜底）
    if (allCodes.length === 0) {
        const name: string = item.Name || '';
        const nameCodes = extractCodesFromText(name);
        if (nameCodes.length > 0) {
            allCodes.push(...nameCodes);
            if (!primarySource) primarySource = 'Name';
        }
    }

    // 4. OriginalTitle（原始标题，仅作为最后兜底）
    if (allCodes.length === 0) {
        const originalTitle: string = item.OriginalTitle || '';
        const otCodes = extractCodesFromText(originalTitle);
        if (otCodes.length > 0) {
            allCodes.push(...otCodes);
            if (!primarySource) primarySource = 'OriginalTitle';
        }
    }

    // 移除从 Genres、Tags、Overview 等字段提取，避免误匹配

    return { codes: [...new Set(allCodes)], source: primarySource };
}

export async function getLibraryIndex(): Promise<LibraryIndex> {
    try {
        const result = await new Promise<Record<string, LibraryIndex>>((resolve) => {
            chrome.storage.local.get([STORAGE_KEYS.EMBY_LIBRARY_INDEX], (data) => {
                resolve(data as Record<string, LibraryIndex>);
            });
        });
        if (result[STORAGE_KEYS.EMBY_LIBRARY_INDEX]) {
            return result[STORAGE_KEYS.EMBY_LIBRARY_INDEX];
        }
    } catch (e) {
        console.error('[EmbyLibrary] Failed to get index:', e);
    }
    return { ...EMPTY_LIBRARY_INDEX };
}

export async function saveLibraryIndex(index: LibraryIndex): Promise<void> {
    await new Promise<void>((resolve) => {
        chrome.storage.local.set({
            [STORAGE_KEYS.EMBY_LIBRARY_INDEX]: index,
        }, () => resolve());
    });
}

export async function clearLibraryIndex(): Promise<void> {
    await new Promise<void>((resolve) => {
        chrome.storage.local.remove(STORAGE_KEYS.EMBY_LIBRARY_INDEX, () => resolve());
    });
}

/**
 * 获取 Emby/Jellyfin 服务器上的所有媒体库（虚拟文件夹）列表
 * 返回格式: [{ id: "xxxx", name: "日本AV", path: "/path/to/lib" }, ...]
 */
export async function listLibraryFolders(config: EmbyServerConfig): Promise<Array<{ id: string; name: string; path?: string }>> {
    if (!config.url || !config.apiKey) {
        throw new Error('服务器配置不完整');
    }

    const baseUrl = config.url.replace(/\/$/, '');

    // 方式1: 用 /Library/VirtualFolders
    try {
        const url = `${baseUrl}/Library/VirtualFolders?api_key=${encodeURIComponent(config.apiKey)}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
        });
        if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data) && data.length > 0) {
                return data
                    .filter((item: any) => item && item.Name)
                    .map((item: any) => ({
                        id: item.Id || item.ItemId || item.name,
                        name: item.Name,
                        path: item.Path || (item.Locations && item.Locations[0]) || undefined,
                    }));
            }
        }
    } catch (e) {
        console.warn('[EmbyLibrary] VirtualFolders failed:', e);
    }

    // 方式2: 用 /Views 回退
    try {
        const url = `${baseUrl}/Views?api_key=${encodeURIComponent(config.apiKey)}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
        });
        if (response.ok) {
            const data = await response.json();
            const items = data.Items || [];
            if (items.length > 0) {
                return items.map((item: any) => ({
                    id: item.Id,
                    name: item.Name || '',
                    path: item.Path || undefined,
                }));
            }
        }
    } catch (e) {
        console.warn('[EmbyLibrary] /Views fallback failed:', e);
    }

    return [];
}

/**
 * 从媒体库列表中根据名称匹配找到库 id
 * 支持精确匹配和包含匹配
 */
function findLibraryIdByName(folders: Array<{ id: string; name: string; path?: string }>, targetName: string): string | null {
    if (!targetName || folders.length === 0) return null;
    const normalizedTarget = targetName.trim().toLowerCase();

    // 精确匹配
    const exact = folders.find((f) => f.name.toLowerCase() === normalizedTarget);
    if (exact) return exact.id;

    // 包含匹配
    const partial = folders.find((f) => f.name.toLowerCase().includes(normalizedTarget));
    if (partial) return partial.id;

    // 反向包含（用户输入的名字可能比库名长）
    const reverse = folders.find((f) => normalizedTarget.includes(f.name.toLowerCase()));
    if (reverse) return reverse.id;

    return null;
}

export async function fetchLibraryFromServer(config: EmbyServerConfig, libraryName?: string): Promise<{ entries: LibraryIndexEntry[]; totalFetched: number; matchedLibraryName: string | null; serverId: string | null }> {
    if (!config.url || !config.apiKey) {
        throw new Error('服务器配置不完整');
    }

    const baseUrl = config.url.replace(/\/$/, '');
    const entries: LibraryIndexEntry[] = [];
    let totalFetched = 0;
    let serverId: string | null = null;

    // 0. 从 System/Info 获取服务器 ID（用于构建跳转 URL 的 serverId 参数）
    try {
        const sysInfoUrl = `${baseUrl}/System/Info?api_key=${encodeURIComponent(config.apiKey)}`;
        const sysInfoResp = await fetch(sysInfoUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
        });
        if (sysInfoResp.ok) {
            const sysInfo = await sysInfoResp.json();
            serverId = sysInfo.Id || sysInfo.id || sysInfo.ServerId || sysInfo.serverId || null;
            if (serverId) {
                console.log(`[EmbyLibrary] Server ID: ${serverId}`);
            }
        }
    } catch (e) {
        console.warn('[EmbyLibrary] Failed to get System/Info for serverId:', e);
    }

    // 1. 如果配置了媒体库名称，先找到该库的 ParentId
    let parentId: string | null = null;
    let matchedLibraryName: string | null = null;
    const libName = libraryName || config.libraryName;
    if (libName && libName.trim()) {
        try {
            const folders = await listLibraryFolders(config);
            console.log(`[EmbyLibrary] Found ${folders.length} library folders:`, folders.map((f) => f.name).join(', '));
            const foundId = findLibraryIdByName(folders, libName);
            if (foundId) {
                parentId = foundId;
                const matchedFolder = folders.find((f) => f.id === foundId);
                matchedLibraryName = matchedFolder?.name || libName;
                console.log(`[EmbyLibrary] Matched library "${libName}" -> id=${foundId} (name=${matchedLibraryName})`);
            } else {
                console.warn(`[EmbyLibrary] Library name "${libName}" not found. Falling back to global scan.`);
            }
        } catch (e) {
            console.warn('[EmbyLibrary] Failed to list folders, fallback to global scan:', e);
        }
    }

    let startIndex = 0;
    const pageSize = 200;
    let hasMore = true;
    let pageCount = 0;

    while (hasMore) {
        // 如果指定了库的 ParentId，用 ParentId 限定范围；否则递归扫描全部
        const parentFilter = parentId ? `ParentId=${encodeURIComponent(parentId)}&` : '';
        const url = `${baseUrl}/Items?api_key=${encodeURIComponent(config.apiKey)}&${parentFilter}Fields=ProviderIds,Genres,Tags,OriginalTitle,Path,Overview,Studios&Filters=IsNotFolder&Recursive=true&StartIndex=${startIndex}&Limit=${pageSize}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
        });

        if (!response.ok) {
            if (response.status === 401) throw new Error('API Key 无效或已过期');
            if (response.status === 404) throw new Error('服务器地址错误或不可达');
            throw new Error(`服务器返回错误: ${response.status}`);
        }

        const data = await response.json();
        const items = data.Items || [];
        totalFetched += items.length;
        pageCount++;

        // 打印前 3 条影片的完整原始 JSON（仅一次），方便诊断
        if (pageCount === 1 && items.length > 0) {
            const sampleSize = Math.min(3, items.length);
            for (let i = 0; i < sampleSize; i++) {
                const sample = items[i];
                const { codes, source } = extractCodesFromItem(sample);
                console.log(`[EmbyLibrary] Sample[${i}]: name="${sample.Name}", codes=${JSON.stringify(codes)}, source=${source}`);
                // 压缩后的完整字段（仅打印一次）
                console.log(`[EmbyLibrary] Sample[${i}] raw JSON keys: ${Object.keys(sample).join(', ')}`);
                if (i === 0) {
                    console.log(`[EmbyLibrary] Sample[0] ProviderIds: ${JSON.stringify(sample.ProviderIds || {})}`);
                    console.log(`[EmbyLibrary] Sample[0] Genres: ${JSON.stringify(sample.Genres || [])}`);
                    console.log(`[EmbyLibrary] Sample[0] Tags: ${JSON.stringify(sample.Tags || [])}`);
                }
            }
        }

        for (const item of items) {
            const { codes, source } = extractCodesFromItem(item);
            if (codes.length > 0) {
                entries.push({
                    id: item.Id,
                    name: item.Name || '',
                    providerIds: { extracted: codes[0] },
                    normalizedCodes: codes.map(c => normalizeCode(c)),
                    _matchedSource: (source as any),
                });
            }
        }

        startIndex += items.length;
        hasMore = items.length === pageSize;
    }

    console.log(`[EmbyLibrary] Done. Fetched ${totalFetched} items total, indexed ${entries.length} items with valid jav codes.`);
    return { entries, totalFetched, matchedLibraryName: matchedLibraryName || null, serverId };
}

export async function fetchWatchedCodesFromServer(config: EmbyServerConfig): Promise<string[]> {
    const baseUrl = config.url.replace(/\/$/, '');
    const watchedCodes: string[] = [];

    try {
        const usersUrl = `${baseUrl}/Users?api_key=${encodeURIComponent(config.apiKey)}`;
        const usersResponse = await fetch(usersUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
        });
        if (!usersResponse.ok) {
            console.warn(`[EmbyLibrary] Failed to get users: ${usersResponse.status}`);
            return [];
        }
        const users = await usersResponse.json();
        if (!Array.isArray(users) || users.length === 0) {
            console.warn('[EmbyLibrary] No users found on Emby server');
            return [];
        }
        console.log(`[EmbyLibrary] Found ${users.length} user(s): ${users.map((u: any) => u.Name).join(', ')}`);

        for (const user of users) {
            const userId = user.Id;
            let startIndex = 0;
            const pageSize = 500;
            let hasMore = true;
            let userTotal = 0;
            let sampleLogged = false;

            while (hasMore) {
                const url = `${baseUrl}/Users/${encodeURIComponent(userId)}/Items?api_key=${encodeURIComponent(config.apiKey)}&Filters=IsPlayed&Fields=ProviderIds,Path&Recursive=true&StartIndex=${startIndex}&Limit=${pageSize}`;
                const response = await fetch(url, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                });

                if (!response.ok) {
                    console.warn(`[EmbyLibrary] Failed to get played items for user ${user.Name}: ${response.status} ${response.statusText}`);
                    break;
                }

                const data = await response.json();
                const items = data.Items || [];
                console.log(`[EmbyLibrary] User "${user.Name}" page ${Math.floor(startIndex / pageSize) + 1}: ${items.length} items (TotalRecordCount=${data.TotalRecordCount})`);

                if (!sampleLogged && items.length > 0) {
                    const first = items[0];
                    console.log(`[EmbyLibrary] First played item: name="${first.Name}", type="${first.Type}", path="${first.Path}", codes=${JSON.stringify(extractCodesFromItem(first).codes)}`);
                    sampleLogged = true;
                }

                for (const item of items) {
                    const { codes } = extractCodesFromItem(item);
                    for (const code of codes) {
                        const normalized = normalizeCode(code);
                        if (normalized && !watchedCodes.includes(normalized)) {
                            watchedCodes.push(normalized);
                        }
                    }
                }

                userTotal += items.length;
                startIndex += items.length;
                hasMore = items.length === pageSize;
            }
            console.log(`[EmbyLibrary] User "${user.Name}" total played items: ${userTotal}, unique codes so far: ${watchedCodes.length}`);
        }
    } catch (e) {
        console.error('[EmbyLibrary] Failed to fetch watched codes:', e);
    }

    console.log(`[EmbyLibrary] Total watched codes collected: ${watchedCodes.length}`);
    return watchedCodes;
}

export async function syncLibrary(config: EmbyServerConfig): Promise<{ index: LibraryIndex; totalFetched: number; matchedLibraryName: string | null; watchedCount: number }> {
    const { entries, totalFetched, matchedLibraryName, serverId } = await fetchLibraryFromServer(config);
    // 给每个 entry 注入服务器信息，用于构建详情页跳转链接
    const serverUrl = config.url.replace(/\/$/, '');
    for (const entry of entries) {
        entry.serverUrl = serverUrl;
        entry.serverType = config.type;
        if (serverId) entry.serverId = serverId;
    }
    const index: LibraryIndex = {
        entries,
        lastSyncTime: Date.now(),
        totalCount: entries.length,
    };
    await saveLibraryIndex(index);

    // 从用户上下文中获取已观看番号（需要用户ID）
    const watchedCodes = await fetchWatchedCodesFromServer(config);
    const watchedCount = await mergeWatchedCodes(watchedCodes);

    return { index, totalFetched, matchedLibraryName, watchedCount };
}

export async function getWatchedData(): Promise<EmbyWatchedData> {
    try {
        const result = await new Promise<Record<string, EmbyWatchedData>>((resolve) => {
            chrome.storage.local.get([STORAGE_KEYS.EMBY_WATCHED_PERMANENT], (data) => {
                resolve(data as Record<string, EmbyWatchedData>);
            });
        });
        if (result[STORAGE_KEYS.EMBY_WATCHED_PERMANENT]) {
            return result[STORAGE_KEYS.EMBY_WATCHED_PERMANENT];
        }
    } catch (e) {
        console.error('[EmbyLibrary] Failed to get watched data:', e);
    }
    return { ...EMPTY_WATCHED_DATA };
}

export async function mergeWatchedCodes(newCodes: string[]): Promise<number> {
    const data = await getWatchedData();
    const existingSet = new Set(data.codes);
    let addedCount = 0;
    for (const code of newCodes) {
        if (!existingSet.has(code)) {
            existingSet.add(code);
            addedCount++;
        }
    }
    const updated: EmbyWatchedData = {
        codes: Array.from(existingSet),
        lastSyncTime: Date.now(),
    };
    console.log(`[EmbyLibrary] mergeWatchedCodes: newCodes=${newCodes.length}, existingBefore=${data.codes.length}, added=${addedCount}, totalAfter=${updated.codes.length}`);
    if (updated.codes.length > 0) {
        console.log(`[EmbyLibrary] Watched codes sample: ${updated.codes.slice(0, 10).join(', ')}`);
    }
    await new Promise<void>((resolve) => {
        chrome.storage.local.set({
            [STORAGE_KEYS.EMBY_WATCHED_PERMANENT]: updated,
        }, () => resolve());
    });
    return addedCount;
}

export async function clearWatchedData(): Promise<void> {
    await new Promise<void>((resolve) => {
        chrome.storage.local.remove(STORAGE_KEYS.EMBY_WATCHED_PERMANENT, () => resolve());
    });
}

export async function testConnection(config: EmbyServerConfig): Promise<{ success: boolean; message: string; serverName?: string }> {
    if (!config.url || !config.apiKey) {
        return { success: false, message: '服务器地址和 API Key 不能为空' };
    }

    try {
        const baseUrl = config.url.replace(/\/$/, '');
        const url = `${baseUrl}/System/Info?api_key=${encodeURIComponent(config.apiKey)}`;

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
            serverName: data.ServerName || data.serverName || 'Unknown',
        };
    } catch (e) {
        const error = e as Error;
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError') || error.message.includes('network')) {
            return { success: false, message: '无法连接到服务器，请检查地址是否正确' };
        }
        return { success: false, message: error.message || '连接失败' };
    }
}
