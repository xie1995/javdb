import type { LibraryIndex } from './types';

/**
 * 标准化番号格式
 * 去除分隔符（- _ . 空格）并转小写
 * 例: "050826_100" → "050826100", "ABC-123" → "abc123"
 */
export function normalizeCode(code: string): string {
    if (!code) return '';
    return code.toLowerCase().replace(/[-\s._]/g, '');
}

/**
 * 生成番号的变体形式用于宽松匹配
 * 包含：标准化形式 + 仅数字/仅字母数字（如果不同）
 */
export function generateCodeVariants(code: string): string[] {
    const variants: string[] = [];
    const normalized = normalizeCode(code);
    if (normalized) variants.push(normalized);
    const alphanumeric = normalized.replace(/[^a-z0-9]/g, '');
    if (alphanumeric && alphanumeric !== normalized) variants.push(alphanumeric);
    const digitOnly = normalized.replace(/\D/g, '');
    if (digitOnly && digitOnly !== normalized && digitOnly.length >= 5) variants.push(digitOnly);
    return [...new Set(variants)];
}

/**
 * 从 entry 中提取所有可能的番号候选（只使用 normalizedCodes）
 */
function collectAllCodesFromEntry(entry: any): Set<string> {
    const result = new Set<string>();
    const entryCodes: string[] = entry?.normalizedCodes || [];
    for (const c of entryCodes) {
        if (c && typeof c === 'string' && c.length >= 3) result.add(c);
    }
    return result;
}

/**
 * 判断 videoId 是否命中库索引
 * 匹配策略:
 *   1. 精确变体匹配 (变体 vs 变体)
 */
export function matchCode(videoId: string, index: LibraryIndex): boolean {
    if (!index?.entries || index.entries.length === 0) return false;
    if (!videoId) return false;

    const normalizedVideoId = normalizeCode(videoId);
    if (!normalizedVideoId || normalizedVideoId.length < 5) return false;

    const isValidFormat = /^[a-z]+[0-9]+$/.test(normalizedVideoId) || /^\d+[-_]\d+$/.test(videoId) || /^\d{5,12}$/.test(normalizedVideoId);
    if (!isValidFormat) return false;

    const videoVariants = generateCodeVariants(videoId);
    const allVideoVariants = new Set<string>(videoVariants);
    allVideoVariants.add(normalizedVideoId);

    for (const entry of index.entries) {
        const entryCodes = collectAllCodesFromEntry(entry);
        if (entryCodes.size === 0) continue;

        for (const v of allVideoVariants) {
            if (entryCodes.has(v)) return true;
        }
    }

    return false;
}

/**
 * 批量判断 videoIds 中哪些命中库索引
 */
export function matchCodes(videoIds: string[], index: LibraryIndex): Set<string> {
    const matched = new Set<string>();
    if (!videoIds || videoIds.length === 0) return matched;
    for (const videoId of videoIds) {
        if (matchCode(videoId, index)) {
            matched.add(videoId);
        }
    }
    return matched;
}

/**
 * 查找匹配的库索引条目
 * 返回匹配的第一个 entry（含 id、serverUrl、serverType、serverId）
 */
export function findMatchingEntry(videoId: string, index: LibraryIndex): { id: string; serverUrl?: string; serverType?: string; serverId?: string } | null {
    if (!index?.entries || index.entries.length === 0) return null;
    if (!videoId) return null;

    const normalizedVideoId = normalizeCode(videoId);
    if (!normalizedVideoId || normalizedVideoId.length < 5) return null;

    const isValidFormat = /^[a-z]+[0-9]+$/.test(normalizedVideoId) || /^\d+[-_]\d+$/.test(videoId);
    if (!isValidFormat) return null;

    const videoVariants = generateCodeVariants(videoId);
    const allVideoVariants = new Set<string>(videoVariants);
    allVideoVariants.add(normalizedVideoId);

    for (const entry of index.entries) {
        const entryCodes = collectAllCodesFromEntry(entry);
        if (entryCodes.size === 0) continue;

        for (const v of allVideoVariants) {
            if (entryCodes.has(v)) {
                return { id: entry.id, serverUrl: entry.serverUrl, serverType: entry.serverType, serverId: entry.serverId };
            }
        }
    }

    return null;
}

/**
 * 根据 Emby/Jellyfin 服务器地址和 ItemId 构建影片详情页 URL
 * Emby 4.x:   {server}/web/index.html#!/item?id={itemId}&serverId={serverId}
 * Jellyfin:   {server}/web/index.html#!/item?id={itemId}
 * 不指定 serverId 也能正常访问，但添加后兼容性更好
 */
export function buildEmbyDetailUrl(serverUrl: string, itemId: string, serverType?: string, serverId?: string): string {
    const base = serverUrl.replace(/\/$/, '');
    if (serverId && serverType === 'emby') {
        return `${base}/web/index.html#!/item?id=${encodeURIComponent(itemId)}&serverId=${encodeURIComponent(serverId)}`;
    }
    return `${base}/web/index.html#!/item?id=${encodeURIComponent(itemId)}`;
}
