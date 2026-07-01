import { STORAGE_KEYS } from '../../../utils/config';
import type { EmbyServerConfig, LibraryIndex, LibraryIndexEntry, EmbyWatchedData } from './types';
import { EMPTY_LIBRARY_INDEX, EMPTY_WATCHED_DATA } from './types';
import { normalizeCode } from './matcher';
import { viewedGetAll as idbViewedGetAll, viewedBulkPut as idbViewedBulkPut, viewedPut as idbViewedPut } from '../../../platform/storage/indexedDb';
import type { VideoRecord } from '../../../types';

function extractCodesFromText(text: string): string[] {
    if (!text) return [];
    const codes: string[] = [];
    const structuredPatterns = [
        /([A-Z]{1,6}[-_]\d{1,6})/gi, /([A-Z]{2,6}\d{1,6})/g,
        /(FC2[_-]\w{1,6})/gi, /(S2[_-]\d{1,6})/gi,
        /(HEYZO[_-]\d{1,6})/gi, /(10mu[_-]\d{1,6})/gi,
        /(CARIBBEAN[_-]\d{1,6})/gi, /(MADONNA[_-]\d{1,6})/gi,
    ];
    for (const pattern of structuredPatterns) {
        const matches = text.match(pattern);
        if (matches) for (const match of matches) {
            const cleaned = match.toUpperCase().replace(/[_]/g, '-').replace(/-+/g, '-');
            if (cleaned.length >= 3 && cleaned.length <= 25) codes.push(cleaned);
        }
    }
    const numericPatterns = [/(\d{4,8}[-_]\d{1,6})/g];
    for (const pattern of numericPatterns) {
        const matches = text.match(pattern);
        if (matches) for (const match of matches) {
            const cleaned = match.toUpperCase().replace(/[_]/g, '-').replace(/-+/g, '-');
            if (cleaned.length >= 5 && cleaned.length <= 25) codes.push(cleaned);
        }
    }
    return [...new Set(codes)];
}

function extractCodesFromItem(item: any): { codes: string[]; source: string } {
    if (!item) return { codes: [], source: '' };
    const allCodes: string[] = [];
    let primarySource = '';
    const providerIds = item.ProviderIds || {};
    const nonJavKeys = new Set(['tmdb', 'imdb', 'tvdb', 'tvrage', 'mbid', 'musicbrainz', 'audiodb', 'isrc']);
    for (const [key, value] of Object.entries(providerIds)) {
        const str = String(value || '');
        if (str.length > 2 && str.length < 30) {
            const keyLower = key.toLowerCase();
            if (nonJavKeys.has(keyLower) && !/[-_]/.test(str) && /^\d{5,12}$/.test(str)) continue;
            const codes = extractCodesFromText(str);
            if (codes.length > 0) { allCodes.push(...codes); if (!primarySource) primarySource = `ProviderIds.${key}`; }
        }
    }
    const pathCodes = extractCodesFromText(item.Path || '');
    if (pathCodes.length > 0) { allCodes.push(...pathCodes); if (!primarySource) primarySource = 'Path'; }
    if (allCodes.length === 0) {
        const nameCodes = extractCodesFromText(item.Name || '');
        if (nameCodes.length > 0) { allCodes.push(...nameCodes); if (!primarySource) primarySource = 'Name'; }
    }
    if (allCodes.length === 0) {
        const otCodes = extractCodesFromText(item.OriginalTitle || '');
        if (otCodes.length > 0) { allCodes.push(...otCodes); if (!primarySource) primarySource = 'OriginalTitle'; }
    }
    return { codes: [...new Set(allCodes)], source: primarySource };
}

export async function getLibraryIndex(): Promise<LibraryIndex> {
    try {
        const result = await new Promise<Record<string, LibraryIndex>>((resolve) => {
            chrome.storage.local.get([STORAGE_KEYS.EMBY_LIBRARY_INDEX], (data) => resolve(data as Record<string, LibraryIndex>));
        });
        if (result[STORAGE_KEYS.EMBY_LIBRARY_INDEX]) return result[STORAGE_KEYS.EMBY_LIBRARY_INDEX];
    } catch (e) { console.error('[EmbyLibrary] Failed to get index:', e); }
    return { ...EMPTY_LIBRARY_INDEX };
}

export async function saveLibraryIndex(index: LibraryIndex): Promise<void> {
    await new Promise<void>((resolve) => { chrome.storage.local.set({ [STORAGE_KEYS.EMBY_LIBRARY_INDEX]: index }, () => resolve()); });
}

export async function clearLibraryIndex(): Promise<void> {
    await new Promise<void>((resolve) => { chrome.storage.local.remove(STORAGE_KEYS.EMBY_LIBRARY_INDEX, () => resolve()); });
}

// ... (listLibraryFolders, findLibraryIdByName same as before) ...
export async function listLibraryFolders(config: EmbyServerConfig): Promise<Array<{ id: string; name: string; path?: string }>> {
    if (!config.url || !config.apiKey) throw new Error('服务器配置不完整');
    const baseUrl = config.url.replace(/\/$/, '');
    try {
        const url = `${baseUrl}/Library/VirtualFolders?api_key=${encodeURIComponent(config.apiKey)}`;
        const response = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
        if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data) && data.length > 0) {
                return data.filter((item: any) => item && item.Name).map((item: any) => ({
                    id: item.Id || item.ItemId || item.name, name: item.Name,
                    path: item.Path || (item.Locations && item.Locations[0]) || undefined,
                }));
            }
        }
    } catch (e) { console.warn('[EmbyLibrary] VirtualFolders failed:', e); }
    try {
        const url = `${baseUrl}/Views?api_key=${encodeURIComponent(config.apiKey)}`;
        const response = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
        if (response.ok) {
            const data = await response.json();
            const items = data.Items || [];
            if (items.length > 0) return items.map((item: any) => ({ id: item.Id, name: item.Name || '', path: item.Path || undefined }));
        }
    } catch (e) { console.warn('[EmbyLibrary] /Views fallback failed:', e); }
    return [];
}

function findLibraryIdByName(folders: Array<{ id: string; name: string; path?: string }>, targetName: string): string | null {
    if (!targetName || folders.length === 0) return null;
    const normalizedTarget = targetName.trim().toLowerCase();
    const exact = folders.find((f) => f.name.toLowerCase() === normalizedTarget);
    if (exact) return exact.id;
    const partial = folders.find((f) => f.name.toLowerCase().includes(normalizedTarget));
    if (partial) return partial.id;
    const reverse = folders.find((f) => normalizedTarget.includes(f.name.toLowerCase()));
    if (reverse) return reverse.id;
    return null;
}

export async function fetchLibraryFromServer(config: EmbyServerConfig, libraryName?: string): Promise<{ entries: LibraryIndexEntry[]; totalFetched: number; matchedLibraryName: string | null; serverId: string | null; playedCodes: string[] }> {
    if (!config.url || !config.apiKey) throw new Error('服务器配置不完整');
    const baseUrl = config.url.replace(/\/$/, '');
    const entries: LibraryIndexEntry[] = [];
    let totalFetched = 0, serverId: string | null = null;
    const playedCodes: string[] = [];

    try {
        const sysInfoResp = await fetch(`${baseUrl}/System/Info?api_key=${encodeURIComponent(config.apiKey)}`, { method: 'GET', headers: { 'Accept': 'application/json' } });
        if (sysInfoResp.ok) {
            const sysInfo = await sysInfoResp.json();
            serverId = sysInfo.Id || sysInfo.id || sysInfo.ServerId || sysInfo.serverId || null;
        }
    } catch (e) {}

    let parentId: string | null = null, matchedLibraryName: string | null = null;
    const libName = libraryName || config.libraryName;
    if (libName && libName.trim()) {
        try {
            const folders = await listLibraryFolders(config);
            const foundId = findLibraryIdByName(folders, libName);
            if (foundId) { parentId = foundId; matchedLibraryName = folders.find((f) => f.id === foundId)?.name || libName; }
        } catch (e) {}
    }

    let startIndex = 0, pageCount = 0, hasMore = true;
    const pageSize = 200;
    while (hasMore) {
        const parentFilter = parentId ? `ParentId=${encodeURIComponent(parentId)}&` : '';
        const url = `${baseUrl}/Items?api_key=${encodeURIComponent(config.apiKey)}&${parentFilter}Fields=ProviderIds,UserData,Genres,Tags,OriginalTitle,Path,Overview,Studios&Filters=IsNotFolder&Recursive=true&StartIndex=${startIndex}&Limit=${pageSize}`;
        const response = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
        if (!response.ok) {
            if (response.status === 401) throw new Error('API Key 无效或已过期');
            if (response.status === 404) throw new Error('服务器地址错误或不可达');
            throw new Error(`服务器返回错误: ${response.status}`);
        }
        const data = await response.json();
        const items = data.Items || [];
        totalFetched += items.length; pageCount++;

        for (const item of items) {
            const { codes, source } = extractCodesFromItem(item);
            if (codes.length > 0) {
                entries.push({
                    id: item.Id, name: item.Name || '', providerIds: { extracted: codes[0] },
                    normalizedCodes: codes.map(c => normalizeCode(c)), _matchedSource: (source as any),
                });
            }
            if (item.UserData?.Played) {
                const played = extractCodesFromItem(item);
                for (const code of played.codes) {
                    const normalized = normalizeCode(code);
                    if (normalized && !playedCodes.includes(normalized)) playedCodes.push(normalized);
                }
            }
        }
        startIndex += items.length;
        hasMore = items.length === pageSize;
    }
    return { entries, totalFetched, matchedLibraryName: matchedLibraryName || null, serverId, playedCodes };
}

// ========== JavDB 抓取 ==========

async function searchJavdb(code: string): Promise<{ url: string; title: string } | null> {
    // 为 JavDB 生成多个搜索变体以处理模式匹配（例如，heyou2550 -> HEYZO-2550）
    const parts = code.match(/^([a-z]+?)(\d+)$/i);
    const searchPatterns = [code]; // 始终包含小写字母版本
    if (parts) {
        const prefix = parts[1].toUpperCase();
        const digits = parts[2];
        searchPatterns.push(`${prefix}${digits}`, `${prefix}-${digits}`); // HEYZO2550, HEYZO-2550
    }
    try {
        const searchUrl = `https://javdb.com/search?q=${encodeURIComponent(code)}&f=all`;
        const response = await fetch(searchUrl);
        if (!response.ok) return null;
        const html = await response.text();

        // 为所有模式构建一个正则表达式
        const escapedCodes = searchPatterns
            .map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|');
        const strongRegex = new RegExp(`<strong[^>]*>\\s*(${escapedCodes})\\s*</strong>`, 'gi');

        for (const match of html.matchAll(strongRegex)) {
            const before = html.substring(0, match.index!);
            const itemStart = before.lastIndexOf('item');
            if (itemStart < 0) continue;
            const itemHtml = html.substring(itemStart, match.index! + 300);
            const hrefMatch = itemHtml.match(/href="(\/v\/[^"]+)"/);
            if (!hrefMatch) continue;
            const url = `https://javdb.com${hrefMatch[1]}`;
            const titleMatch = itemHtml.match(/title="([^"]+)"/);
            return { url, title: titleMatch ? titleMatch[1] : code };
        }
        const itemRegex = /<div[^>]*class="[^"]*item[^"]*"[^>]*>/g;
        let itemMatch: RegExpExecArray | null;
        while ((itemMatch = itemRegex.exec(html)) !== null) {
            const itemHtml = html.substring(itemMatch.index, itemMatch.index + 2000);
            const hrefMatch = itemHtml.match(/href="(\/v\/[^"]+)"/);
            if (!hrefMatch) continue;
            const url = `https://javdb.com${hrefMatch[1]}`;
            const titleMatch = itemHtml.match(/title="([^"]+)"/);
            return { url, title: titleMatch ? titleMatch[1] : code };
        }
        return null;
    } catch { return null; }
}

async function fetchJavdbCoverImage(detailUrl: string): Promise<string | undefined> {
    try {
        const response = await fetch(detailUrl);
        if (!response.ok) return undefined;
        const html = await response.text();
        const coverMatch = html.match(/(?:data-fancybox="gallery"\s+href|<img[^>]*src)="(https:\/\/[^"]*\.jdbstatic\.com\/covers\/[^"]+)"/);
        if (coverMatch) return coverMatch[1];
        const altMatch = html.match(/<img[^>]*class="[^"]*video-cover[^"]*"[^>]*src="([^"]+)"/);
        if (altMatch) return altMatch[1];
        return undefined;
    } catch { return undefined; }
}

// ========== Exports ==========

export async function syncLibrary(config: EmbyServerConfig, enrichJavdbMetadata?: boolean): Promise<{ index: LibraryIndex; totalFetched: number; matchedLibraryName: string | null; watchedCount: number }> {
    const { entries, totalFetched, matchedLibraryName, serverId, playedCodes } = await fetchLibraryFromServer(config);
    const serverUrl = config.url.replace(/\/$/, '');
    for (const entry of entries) {
        entry.serverUrl = serverUrl; entry.serverType = config.type;
        if (serverId) entry.serverId = serverId;
    }
    const index: LibraryIndex = { entries, lastSyncTime: Date.now(), totalCount: entries.length };
    await saveLibraryIndex(index);

    try {
        const allExistingRecords = await idbViewedGetAll();
        const existingIds = new Set(allExistingRecords.map(r => r.id));
        const now = Date.now();
        const newRecords: VideoRecord[] = [];

        for (const entry of entries) {
            for (const code of entry.normalizedCodes) {
                if (!existingIds.has(code) && code.length >= 3 && (/^[a-z]+\d+$/.test(code) || /^\d{5,12}$/.test(code))) {
                    newRecords.push({ id: code, title: entry.name || code, status: 'untracked' as any, createdAt: now, updatedAt: now });
                    existingIds.add(code);
                }
            }
        }
        if (newRecords.length > 0) {
            await idbViewedBulkPut(newRecords);
            console.log(`[EmbyLibrary] Auto-imported ${newRecords.length} codes`);
        }

        if (enrichJavdbMetadata) {
            const recordsMap = new Map(allExistingRecords.map(r => [r.id, r]));
            const codesToEnrich: string[] = [];
            for (const entry of entries) {
                for (const code of entry.normalizedCodes) {
                    if (code.length >= 3 && (/^[a-z]+\d+$/.test(code) || /^\d{5,12}$/.test(code))) {
                        const existing = recordsMap.get(code);
                        if (!existing || !existing.javdbImage) {
                            if (!codesToEnrich.includes(code)) codesToEnrich.push(code);
                        }
                    }
                }
            }
            if (codesToEnrich.length > 0) {
                await enrichImportedRecordsWithJavdbMetadata(codesToEnrich).catch(e => {
                    console.warn('[EmbyLibrary] Enrichment failed:', e);
                });
            }
        }
    } catch (e) { console.warn('[EmbyLibrary] Failed:', e); }

    let watchedCount = await mergeWatchedCodes(playedCodes);
    const watchedCodesFromApi = await fetchWatchedCodesFromServer(config);
    watchedCount += await mergeWatchedCodes(watchedCodesFromApi);
    return { index, totalFetched, matchedLibraryName, watchedCount };
}

export async function fetchWatchedCodesFromServer(config: EmbyServerConfig): Promise<string[]> {
    const baseUrl = config.url.replace(/\/$/, '');
    const watchedCodes: string[] = [];
    try {
        const usersResponse = await fetch(`${baseUrl}/Users?api_key=${encodeURIComponent(config.apiKey)}`, { method: 'GET', headers: { 'Accept': 'application/json' } });
        if (!usersResponse.ok) return [];
        const users = await usersResponse.json();
        if (!Array.isArray(users) || users.length === 0) return [];
        for (const user of users) {
            const userId = user.Id;
            let startIndex = 0, hasMore = true;
            while (hasMore) {
                const url = `${baseUrl}/Users/${encodeURIComponent(userId)}/Items?api_key=${encodeURIComponent(config.apiKey)}&Filters=IsPlayed&Fields=ProviderIds,Path&Recursive=true&StartIndex=${startIndex}&Limit=500`;
                const response = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
                if (!response.ok) break;
                const data = await response.json();
                const items = data.Items || [];
                for (const item of items) {
                    const { codes } = extractCodesFromItem(item);
                    for (const code of codes) { const n = normalizeCode(code); if (n && !watchedCodes.includes(n)) watchedCodes.push(n); }
                }
                startIndex += items.length; hasMore = items.length === 500;
            }
        }
    } catch (e) {}
    return watchedCodes;
}

export async function getWatchedData(): Promise<EmbyWatchedData> {
    try {
        const result = await new Promise<Record<string, EmbyWatchedData>>((resolve) => {
            chrome.storage.local.get([STORAGE_KEYS.EMBY_WATCHED_PERMANENT], (data) => resolve(data as Record<string, EmbyWatchedData>));
        });
        if (result[STORAGE_KEYS.EMBY_WATCHED_PERMANENT]) return result[STORAGE_KEYS.EMBY_WATCHED_PERMANENT];
    } catch (e) {}
    return { ...EMPTY_WATCHED_DATA };
}

export async function mergeWatchedCodes(newCodes: string[]): Promise<number> {
    const data = await getWatchedData();
    const existingSet = new Set(data.codes);
    let addedCount = 0;
    for (const code of newCodes) { if (!existingSet.has(code)) { existingSet.add(code); addedCount++; } }
    const updated: EmbyWatchedData = { codes: Array.from(existingSet), lastSyncTime: Date.now() };
    await new Promise<void>((resolve) => { chrome.storage.local.set({ [STORAGE_KEYS.EMBY_WATCHED_PERMANENT]: updated }, () => resolve()); });
    return addedCount;
}

export async function clearWatchedData(): Promise<void> {
    await new Promise<void>((resolve) => { chrome.storage.local.remove(STORAGE_KEYS.EMBY_WATCHED_PERMANENT, () => resolve()); });
}

async function enrichImportedRecordsWithJavdbMetadata(codes: string[]): Promise<void> {
    const total = codes.length;
    console.log(`[EmbyLibrary] Starting JavDB enrichment for ${total} codes...`);
    let enriched = 0;

    for (let i = 0; i < total; i++) {
        const code = codes[i];
        try {
            if (i > 0 && i % 3 === 0) await new Promise(r => setTimeout(r, 4000));
            if (i > 0) await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));

            const searchResult = await searchJavdb(code);
            if (!searchResult) { console.log(`[EmbyLibrary] Not found: ${code}`); continue; }

            const coverImage = await fetchJavdbCoverImage(searchResult.url);
            const record: VideoRecord = { id: code, title: searchResult.title, status: 'untracked' as any, javdbUrl: searchResult.url, javdbImage: coverImage, createdAt: Date.now(), updatedAt: Date.now() };
            await idbViewedPut(record);
            enriched++;
            console.log(`[EmbyLibrary] Enriched: ${code} → ${searchResult.title}`);
        } catch (e) { console.warn(`[EmbyLibrary] Failed ${code}:`, e); }
    }
    console.log(`[EmbyLibrary] JavDB enrichment done: ${enriched}/${total}`);
}

export async function testConnection(config: EmbyServerConfig): Promise<{ success: boolean; message: string; serverName?: string }> {
    if (!config.url || !config.apiKey) return { success: false, message: '服务器地址和 API Key 不能为空' };
    try {
        const baseUrl = config.url.replace(/\/$/, '');
        const response = await fetch(`${baseUrl}/System/Info?api_key=${encodeURIComponent(config.apiKey)}`, { method: 'GET', headers: { 'Accept': 'application/json' } });
        if (!response.ok) {
            if (response.status === 401) return { success: false, message: 'API Key 无效或已过期' };
            return { success: false, message: `服务器返回错误: ${response.status}` };
        }
        const data = await response.json();
        return { success: true, message: '连接成功', serverName: data.ServerName || data.serverName || 'Unknown' };
    } catch (e) {
        const error = e as Error;
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) return { success: false, message: '无法连接到服务器，请检查地址是否正确' };
        return { success: false, message: error.message || '连接失败' };
    }
}