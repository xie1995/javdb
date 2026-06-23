import type { VideoRecord } from '../../../types';
import { dbViewedPut } from '../../../platform/storage/dbRuntimeClient';
import { showToast } from '../../../platform/browser/toast';
import { STATE, log } from '../../contentState';

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
