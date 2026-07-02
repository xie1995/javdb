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

export async function syncLibrary(config: EmbyServerConfig, enrichJavdbMetadata?: boolean, onEnrichProgress?: (p: EnrichProgress) => void): Promise<{ index: LibraryIndex; totalFetched: number; matchedLibraryName: string | null; watchedCount: number }> {
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
                await enrichImportedRecordsWithJavdbMetadata(codesToEnrich, onEnrichProgress).catch(e => {
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

/**
 * 拟人化延迟：模拟真实用户浏览行为
 * - 搜索番号后"看"搜索结果页（3~6s）
 * - 点开详情页"浏览"封面和基本信息（5~12s）
 * - 偶尔"仔细看"（15~30s，概率约 15%）
 * - 每 4~6 个番号后"休息"一会（30~90s）
 * - 每约 20 个番号后长时间"休息"（2~5分钟），避免持续请求
 */
function humanDelay(sessionIndex: number): Promise<void> {
    // 每 4~6 个番号取一次额外休息
    const breakEvery = 4 + Math.floor(Math.random() * 3); // 4-6
    if (sessionIndex > 0 && sessionIndex % breakEvery === 0) {
        const breakSec = 30 + Math.random() * 60; // 30-90s
        console.log(`[EmbyLibrary] 🫖 Taking a break for ${breakSec.toFixed(0)}s...`);
        return new Promise(r => setTimeout(r, breakSec * 1000));
    }
    return Promise.resolve();
}

function humanLongBreak(batchIndex: number): Promise<void> {
    const longBreakEvery = 18 + Math.floor(Math.random() * 5); // 18-22
    if (batchIndex > 0 && batchIndex % longBreakEvery === 0) {
        const breakMin = 2 + Math.floor(Math.random() * 3); // 2-5 minutes
        console.log(`[EmbyLibrary] 😴 Long break for ${breakMin} min...`);
        return new Promise(r => setTimeout(r, breakMin * 60 * 1000));
    }
    return Promise.resolve();
}

/** 模拟一次番号抓取：搜索 → 浏览 → 详情 */
async function enrichOneCode(code: string, index: number): Promise<boolean> {
    // 1. 搜索 JavDB —— 模拟"输入番号、看搜索结果"
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000)); // 1-3s 输入+加载
    const searchResult = await searchJavdb(code);
    if (!searchResult) {
        console.log(`[EmbyLibrary] Not found: ${code}`);
        return false;
    }

    // 2. 浏览搜索结果页 —— 模拟"扫一眼结果"
    const browseTime = 3 + Math.random() * 6; // 3-9s
    await new Promise(r => setTimeout(r, browseTime * 1000));

    // 3. 打开详情页 —— 模拟"点进去看"
    const isDeepBrowse = Math.random() < 0.15; // 15% 概率"仔细看"
    const detailTime = isDeepBrowse
        ? 15 + Math.random() * 15  // 仔细看：15-30s
        : 5 + Math.random() * 7;   // 普通看：5-12s
    await new Promise(r => setTimeout(r, detailTime * 1000));

    // 4. 抓取封面
    const coverImage = await fetchJavdbCoverImage(searchResult.url);

    console.log(`[EmbyLibrary] Enriched #${index}: ${code} → ${searchResult.title}${isDeepBrowse ? ' (deep)' : ''}`);
    const record: VideoRecord = {
        id: code, title: searchResult.title, status: 'untracked' as any,
        javdbUrl: searchResult.url, javdbImage: coverImage,
        createdAt: Date.now(), updatedAt: Date.now(),
    };
    await idbViewedPut(record);
    return true;
}

export type EnrichProgress = { current: number; total: number; code: string; title?: string; stage: 'searching' | 'browsing' | 'detail' | 'done' };

const ENRICH_CONTROL_KEY = 'emby_enrich_control';
type EnrichControl = 'running' | 'paused' | 'stopped';

async function getEnrichControl(): Promise<EnrichControl> {
    try {
        const result = await chrome.storage.local.get(ENRICH_CONTROL_KEY);
        const val = result[ENRICH_CONTROL_KEY];
        if (val === 'paused' || val === 'stopped') return val;
    } catch {}
    return 'running';
}

async function setEnrichControl(control: EnrichControl): Promise<void> {
    await chrome.storage.local.set({ [ENRICH_CONTROL_KEY]: control });
}

/** 等待直到控制状态变为 running，或变为 stopped */
async function waitIfPaused(): Promise<boolean> {
    while (true) {
        const control = await getEnrichControl();
        if (control === 'stopped') return false; // 停止
        if (control === 'running') return true;   // 继续
        // paused: 每秒检查一次
        await new Promise(r => setTimeout(r, 1000));
    }
}

async function enrichImportedRecordsWithJavdbMetadata(
    codes: string[],
    onProgress?: (p: EnrichProgress) => void,
): Promise<void> {
    const total = codes.length;
    console.log(`[EmbyLibrary] Starting JavDB enrichment for ${total} codes (~${(total * 20 / 60).toFixed(0)}min estimated)...`);
    let enriched = 0;
    let stopped = false;

    await setEnrichControl('running');
    onProgress?.({ current: 0, total, code: codes[0] || '', stage: 'searching' });

    for (let i = 0; i < total; i++) {
        const code = codes[i];
        try {
            // 检查暂停/停止
            const shouldContinue = await waitIfPaused();
            if (!shouldContinue) { stopped = true; break; }

            onProgress?.({ current: i, total, code, stage: 'searching' });

            // 长时间休息（每约20个）
            await humanLongBreak(i);

            // 休息期间也检查
            const afterBreak = await waitIfPaused();
            if (!afterBreak) { stopped = true; break; }

            // 小休息（每4-6个）
            await humanDelay(i);

            onProgress?.({ current: i, total, code, stage: 'browsing' });
            const ok = await enrichOneCode(code, i + 1);
            if (ok) enriched++;

            onProgress?.({ current: i + 1, total, code, title: code, stage: 'done' });
        } catch (e) {
            console.warn(`[EmbyLibrary] Failed ${code}:`, e);
            onProgress?.({ current: i + 1, total, code, stage: 'done' });
            await new Promise(r => setTimeout(r, 5000 + Math.random() * 5000));
        }
    }

    await setEnrichControl('stopped'); // 清理状态
    if (stopped) {
        onProgress?.({ current: enriched, total, code: '', title: '已停止', stage: 'done' });
        console.log(`[EmbyLibrary] Enrichment stopped by user: ${enriched}/${total}`);
    } else {
        onProgress?.({ current: total, total, code: '', stage: 'done' });
        console.log(`[EmbyLibrary] JavDB enrichment done: ${enriched}/${total}`);
    }
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