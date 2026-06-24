import type { VideoRecord } from '../../../types';
import { dbViewedPut } from '../../../platform/storage/dbRuntimeClient';
import { showToast } from '../../../platform/browser/toast';
import { STATE, log } from '../../contentState';
import { getSettings } from '../../../utils/storage';
import { defaultHttpClient } from '../../../platform/network/httpClient';
import { selectOptimalMagnet, parseSizeToBytes, extractFileCountFromText } from '../../magnets/application/resultMetadata';
import type { MagnetResult } from '../../magnets/domain/types';

const FAV_BTN_CLASS = 'jdb-cover-favorite-btn';

let stylesInjected = false;

function injectStyles(): void {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'jdb-cover-favorite-btn-style';
    style.textContent = `
        .${FAV_BTN_CLASS} {
            position: absolute;
            right: 8px;
            bottom: 8px;
            z-index: 20;
            width: 30px;
            height: 30px;
            border: none;
            border-radius: 50%;
            background: rgba(15, 23, 42, 0.72);
            backdrop-filter: blur(6px);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            line-height: 1;
            color: rgba(255, 255, 255, 0.6);
            transition: all 0.2s ease;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            padding: 0;
            opacity: 0;
            transform: translateY(4px);
        }
        .item:hover .${FAV_BTN_CLASS},
        .${FAV_BTN_CLASS}.is-favorited {
            opacity: 1;
            transform: translateY(0);
        }
        .${FAV_BTN_CLASS}:hover {
            background: rgba(239, 68, 68, 0.85);
            color: #fff;
            transform: scale(1.12);
            box-shadow: 0 6px 16px rgba(239, 68, 68, 0.4);
        }
        .${FAV_BTN_CLASS}.is-favorited {
            opacity: 1;
            background: rgba(239, 68, 68, 0.9);
            color: #fff;
            animation: jdb-fav-pop 0.35s ease;
        }
        @keyframes jdb-fav-pop {
            0% { transform: scale(0.8); }
            50% { transform: scale(1.2); }
            100% { transform: scale(1); }
        }
    `;
    document.head.appendChild(style);
}

export function renderCoverFavoriteButton(item: HTMLElement, videoId: string): void {
    injectStyles();

    item.querySelectorAll(`.${FAV_BTN_CLASS}`).forEach(el => el.remove());

    const coverImage = item.querySelector<HTMLImageElement>('img.video-cover, img.cover, img');
    if (!coverImage) return;

    let wrapper = coverImage.parentElement as HTMLElement | null;
    while (wrapper && !wrapper.querySelector(':scope > img')) {
        wrapper = wrapper.parentElement;
    }
    const badgeHost: HTMLElement = wrapper || item;
    const computedStyle = window.getComputedStyle(badgeHost);
    if (computedStyle.position === 'static') {
        badgeHost.style.position = 'relative';
    }

    const record = STATE.records[videoId];
    const isFavorited = record?.isFavorite === true;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = FAV_BTN_CLASS;
    btn.title = isFavorited ? '取消收藏' : '一键收藏';
    btn.innerHTML = isFavorited ? '❤️' : '🤍';
    btn.setAttribute('aria-label', isFavorited ? '取消收藏' : '收藏');
    if (isFavorited) {
        btn.classList.add('is-favorited');
    }

    btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await toggleFavorite(item, videoId, btn);
    });

    badgeHost.appendChild(btn);
}

async function toggleFavorite(
    item: HTMLElement,
    videoId: string,
    btn: HTMLElement,
): Promise<void> {
    const previous = STATE.records[videoId];
    const now = Date.now();
    const isNowFavorite = !(previous?.isFavorite === true);

    const link = item.querySelector<HTMLAnchorElement>('a[href*="/v/"]');
    const cover = item.querySelector<HTMLImageElement>('img.video-cover, img.cover, img');

    const record: VideoRecord = {
        ...(previous || {}),
        id: videoId,
        title: previous?.title || extractListItemTitle(item, videoId),
        status: previous?.status || 'untracked',
        tags: previous?.tags || [],
        createdAt: previous?.createdAt || now,
        updatedAt: now,
        isFavorite: isNowFavorite,
    };
    if (isNowFavorite && !record.favoritedAt) {
        record.favoritedAt = now;
    }
    if (!record.javdbUrl && link?.href) record.javdbUrl = link.href;
    if (!record.coverImage && cover?.src) record.coverImage = cover.src;
    if (!record.javdbImage && cover?.src) record.javdbImage = cover.src;

    try {
        await dbViewedPut(record);
        STATE.records[videoId] = record;

        btn.innerHTML = isNowFavorite ? '❤️' : '🤍';
        btn.title = isNowFavorite ? '取消收藏' : '一键收藏';
        if (isNowFavorite) {
            btn.classList.add('is-favorited');
        } else {
            btn.classList.remove('is-favorited');
        }
        btn.setAttribute('aria-label', isNowFavorite ? '取消收藏' : '收藏');

        showToast(isNowFavorite ? `${videoId} 已收藏` : `${videoId} 已取消收藏`, 'success');

        if (isNowFavorite) {
            const link = item.querySelector<HTMLAnchorElement>('a[href*="/v/"]');
            const detailUrl = link?.href;
            setTimeout(() => {
                handleAutoPushOnFavorite(videoId, detailUrl).catch((err) => {
                    log('Auto-push error:', err);
                });
            }, 500);
        }
    } catch (error) {
        log('Failed to toggle favorite:', error);
        showToast('收藏操作失败', 'error');
    }
}

function extractListItemTitle(item: HTMLElement, videoId: string): string {
    const dataTitle = item.querySelector<HTMLElement>('.x-btn')?.dataset.title?.trim();
    if (dataTitle) return dataTitle;
    const titleText = item.querySelector('.video-title')?.textContent?.trim() || '';
    return titleText.replace(videoId, '').trim();
}

async function isAutoPushOnFavoriteEnabled(): Promise<boolean> {
    try {
        const settings = await getSettings() as any;
        return !!(settings?.drive115?.enabled && settings?.drive115?.autoPushOnFavorite);
    } catch (error) {
        log('Failed to check auto-push setting:', error);
        return false;
    }
}

function collectMagnetsFromDocument(doc: Document): MagnetResult[] {
    const results: MagnetResult[] = [];
    try {
        const magnetContent = doc.querySelector('#magnets-content');
        if (!magnetContent) return results;

        const magnetItems = magnetContent.querySelectorAll('.item.columns');
        magnetItems.forEach((item) => {
            try {
                const nameElement = item.querySelector('.magnet-name .name');
                const magnetLink = item.querySelector('a[href^="magnet:"]');
                const metaElement = item.querySelector('.meta');
                const dateElement = item.querySelector('.date .time');
                const tagsElements = item.querySelectorAll('.tags .tag');

                if (nameElement && magnetLink) {
                    const name = nameElement.textContent?.trim() || '';
                    const magnet = (magnetLink as HTMLAnchorElement).href;
                    const meta = metaElement?.textContent?.trim() || '';
                    const date = dateElement?.textContent?.trim() || '';

                    const sizeMatch = meta.match(/([0-9.]+)\s*(GB|MB|KB|TB)/i);
                    const size = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : '';

                    const fileCount = extractFileCountFromText(meta);

                    let hasSubtitle = false;
                    let quality = '';

                    tagsElements.forEach(tag => {
                        const tagText = tag.textContent?.trim() || '';
                        if (tagText.includes('字幕') || tagText.includes('subtitle')) {
                            hasSubtitle = true;
                        }
                        if (tagText.includes('高清') || tagText.includes('HD')) {
                            quality = 'HD';
                        }
                        if (tagText.includes('1080P') || tagText.includes('1080p')) {
                            quality = '1080P';
                        }
                        if (tagText.includes('720P') || tagText.includes('720p')) {
                            quality = '720P';
                        }
                        if (tagText.includes('4K')) {
                            quality = '4K';
                        }
                    });

                    results.push({
                        name,
                        magnet,
                        size,
                        sizeBytes: parseSizeToBytes(size),
                        date: date || '',
                        seeders: 0,
                        leechers: 0,
                        source: 'JavDB',
                        hasSubtitle,
                        quality,
                        fileCount: isFinite(fileCount) ? fileCount : undefined,
                    });
                }
            } catch (e) {
                log('Error parsing magnet item:', e);
            }
        });
    } catch (error) {
        log('Error collecting magnets from document:', error);
    }
    return results;
}

async function fetchMagnetsFromDetailPage(detailUrl: string): Promise<MagnetResult[]> {
    try {
        log(`Fetching detail page for magnets: ${detailUrl}`);
        const doc = await defaultHttpClient.getDocument(detailUrl, {
            timeout: 15000,
        });
        const magnets = collectMagnetsFromDocument(doc);
        log(`Fetched ${magnets.length} magnets from detail page`);
        return magnets;
    } catch (error) {
        log('Failed to fetch magnets from detail page:', error);
        return [];
    }
}

async function pushMagnetToDrive115(
    videoId: string,
    magnetUrl: string,
    magnetName: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        log(`Auto-pushing to 115: ${videoId} | ${magnetName}`);

        const { addTaskUrlsV2 } = await import('../../drive115/router');
        const settings = await getSettings() as any;
        const downloadDir = settings?.drive115?.downloadDir || '0';
        const wpPathId = downloadDir === '' ? '0' : downloadDir;

        const res = await addTaskUrlsV2({
            urls: magnetUrl,
            wp_path_id: wpPathId,
            context: {
                source: 'auto_push_favorite',
                videoId,
                magnetName,
                pageUrl: window.location.href,
                wpPathId,
            } as any,
        });

        if (res.success) {
            log(`Auto-push success for ${videoId}`);
            return { success: true };
        } else {
            log(`Auto-push failed for ${videoId}: ${res.message}`);
            return { success: false, error: res.message || '推送失败' };
        }
    } catch (error) {
        log('Auto-push to 115 failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : '未知错误',
        };
    }
}

export async function handleAutoPushOnFavorite(
    videoId: string,
    detailUrl?: string,
): Promise<void> {
    try {
        const enabled = await isAutoPushOnFavoriteEnabled();
        if (!enabled) return;

        log(`Starting auto-push for favorited video: ${videoId}`);

        let magnets: MagnetResult[] = [];

        const isDetailPage = window.location.pathname.startsWith('/v/');
        if (isDetailPage) {
            magnets = collectMagnetsFromDocument(document);
        } else if (detailUrl) {
            magnets = await fetchMagnetsFromDetailPage(detailUrl);
        }

        if (magnets.length === 0) {
            log(`No magnets found for ${videoId}, skipping auto-push`);
            showToast(`${videoId} 未找到磁力链接，跳过自动推送`, 'info');
            return;
        }

        const optimalMagnet = selectOptimalMagnet(magnets);
        if (!optimalMagnet) {
            log(`Failed to select optimal magnet for ${videoId}`);
            return;
        }

        log(`Selected optimal magnet: ${optimalMagnet.name.substring(0, 50)}...`);

        showToast(`${videoId} 正在自动推送到115网盘...`, 'info');

        const result = await pushMagnetToDrive115(
            videoId,
            optimalMagnet.magnet,
            optimalMagnet.name,
        );

        if (result.success) {
            showToast(`${videoId} 已自动推送到115网盘`, 'success');
        } else {
            showToast(`${videoId} 自动推送失败: ${result.error || '未知错误'}`, 'error');
        }
    } catch (error) {
        log('Auto-push on favorite failed:', error);
        showToast('自动推送115网盘时发生错误', 'error');
    }
}
