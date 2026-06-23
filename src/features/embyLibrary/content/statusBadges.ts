import type { LibraryIndex, EmbyWatchedData } from '../domain/types';
import { findMatchingEntry, buildEmbyDetailUrl, normalizeCode } from '../domain/matcher';

export function renderLibraryStatusCoverBadge(item: HTMLElement, index: LibraryIndex, videoId: string): void {
    if (!item || !videoId) return;
    if (!index?.entries || index.entries.length === 0) return;

    item.querySelectorAll('.emby-library-cover-badge').forEach(el => el.remove());

    const entryInfo = findMatchingEntry(videoId, index);
    if (!entryInfo) return;

    const coverImage = item.querySelector('img.video-cover, img');
    if (!coverImage) return;

    let wrapper = coverImage.parentElement as HTMLElement | null;
    while (wrapper && !wrapper.querySelector(':scope > img')) {
        wrapper = wrapper.parentElement;
    }
    const badgeHost: HTMLElement = wrapper || item;

    const badge = document.createElement('span');
    badge.className = 'emby-library-cover-badge';
    badge.textContent = '已入库';
    badge.title = '点击跳转到 Emby 影片详情页';
    badge.style.cssText = `
        position: absolute;
        top: 6px;
        right: 6px;
        background: rgba(34, 197, 94, 0.92);
        color: white;
        font-size: 10px;
        font-weight: 600;
        padding: 3px 7px;
        border-radius: 10px;
        z-index: 10;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        letter-spacing: 0.5px;
        user-select: none;
    `;

    const computedStyle = window.getComputedStyle(badgeHost);
    if (computedStyle.position === 'static') {
        badgeHost.style.position = 'relative';
    }

    // 点击跳转到 Emby 详情页
    badge.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (entryInfo.serverUrl && entryInfo.id) {
            const url = buildEmbyDetailUrl(entryInfo.serverUrl, entryInfo.id, entryInfo.serverType, entryInfo.serverId);
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    });

    badgeHost.appendChild(badge);
}

export function renderDetailLibraryCoverBadge(videoId: string, index: LibraryIndex): void {
    if (!videoId) return;
    if (!index?.entries || index.entries.length === 0) return;

    const coverColumn = document.querySelector<HTMLElement>(
        '.movie-panel-info .column:first-child, .movie-panel-info > .columns > .column:first-child, .movie-panel-info .column-video-cover'
    );
    if (!coverColumn) return;

    coverColumn.querySelectorAll('.emby-library-cover-badge').forEach(el => el.remove());

    const entryInfo = findMatchingEntry(videoId, index);
    if (!entryInfo) return;

    const coverImage = coverColumn.querySelector<HTMLImageElement>('img.video-cover, img');
    if (!coverImage) return;

    const badge = document.createElement('span');
    badge.className = 'emby-library-cover-badge emby-library-detail-cover-badge';
    badge.textContent = '已入库';
    badge.title = '点击跳转到 Emby 影片详情页';
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
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        letter-spacing: 1px;
        user-select: none;
    `;

    const computedStyle = window.getComputedStyle(coverColumn);
    if (computedStyle.position === 'static') {
        coverColumn.style.position = 'relative';
    }

    // 点击跳转到 Emby 详情页
    badge.addEventListener('click', (e) => {
        e.stopPropagation();
        if (entryInfo.serverUrl && entryInfo.id) {
            const url = buildEmbyDetailUrl(entryInfo.serverUrl, entryInfo.id, entryInfo.serverType, entryInfo.serverId);
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    });

    coverColumn.appendChild(badge);
}

export function clearAllCoverBadges(): void {
    document.querySelectorAll('.emby-library-cover-badge').forEach(el => el.remove());
    clearAllWatchedBadges();
}

export function renderWatchedCoverBadge(item: HTMLElement, watchedData: EmbyWatchedData, videoId: string): void {
    if (!item || !videoId) return;
    if (!watchedData?.codes || watchedData.codes.length === 0) return;

    item.querySelectorAll('.emby-watched-cover-badge').forEach(el => el.remove());

    const normalized = normalizeCode(videoId);
    if (!watchedData.codes.includes(normalized)) return;

    const coverImage = item.querySelector('img.video-cover, img');
    if (!coverImage) return;

    let wrapper = coverImage.parentElement as HTMLElement | null;
    while (wrapper && !wrapper.querySelector(':scope > img')) {
        wrapper = wrapper.parentElement;
    }
    const badgeHost: HTMLElement = wrapper || item;

    const badge = document.createElement('span');
    badge.className = 'emby-watched-cover-badge';
    badge.textContent = '已观看';
    badge.title = '已在 Emby 中观看过';
    badge.style.cssText = `
        position: absolute;
        top: 6px;
        left: 6px;
        background: rgba(239, 68, 68, 0.92);
        color: white;
        font-size: 10px;
        font-weight: 600;
        padding: 3px 7px;
        border-radius: 10px;
        z-index: 10;
        cursor: default;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        letter-spacing: 0.5px;
        user-select: none;
    `;

    const computedStyle = window.getComputedStyle(badgeHost);
    if (computedStyle.position === 'static') {
        badgeHost.style.position = 'relative';
    }

    badgeHost.appendChild(badge);
}

export function renderDetailWatchedCoverBadge(videoId: string, watchedData: EmbyWatchedData): void {
    if (!videoId) return;
    if (!watchedData?.codes || watchedData.codes.length === 0) return;

    const normalized = normalizeCode(videoId);
    if (!watchedData.codes.includes(normalized)) return;

    const coverColumn = document.querySelector<HTMLElement>(
        '.movie-panel-info .column:first-child, .movie-panel-info > .columns > .column:first-child, .movie-panel-info .column-video-cover'
    );
    if (!coverColumn) return;

    coverColumn.querySelectorAll('.emby-watched-cover-badge').forEach(el => el.remove());

    const coverImage = coverColumn.querySelector<HTMLImageElement>('img.video-cover, img');
    if (!coverImage) return;

    const badge = document.createElement('span');
    badge.className = 'emby-watched-cover-badge emby-watched-detail-cover-badge';
    badge.textContent = '已观看';
    badge.title = '已在 Emby 中观看过';
    badge.style.cssText = `
        position: absolute;
        top: 12px;
        left: 12px;
        background: rgba(239, 68, 68, 0.92);
        color: white;
        font-size: 14px;
        font-weight: 600;
        padding: 6px 14px;
        border-radius: 14px;
        z-index: 10;
        cursor: default;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        letter-spacing: 1px;
        user-select: none;
    `;

    const computedStyle = window.getComputedStyle(coverColumn);
    if (computedStyle.position === 'static') {
        coverColumn.style.position = 'relative';
    }

    coverColumn.appendChild(badge);
}

export function clearAllWatchedBadges(): void {
    document.querySelectorAll('.emby-watched-cover-badge').forEach(el => el.remove());
}
