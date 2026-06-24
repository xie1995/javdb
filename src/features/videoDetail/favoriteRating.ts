// 影片页收藏与评分功能

import './favoriteRating.css';
import { STATE, log } from '../contentState';
import { extractVideoIdFromPage } from '../../platform/browser';
import { showToast } from '../../platform/browser/toast';
import type { VideoRecord } from '../../types';
import { runChunkedWork, saveSubtaskDetail, yieldToMainThread } from '../../platform/tasks';
import { getSettings } from '../../utils/storage';
import { selectOptimalMagnet, parseSizeToBytes, extractFileCountFromText } from '../magnets/application/resultMetadata';
import type { MagnetResult } from '../magnets/domain/types';

/**
 * 影片页收藏与评分增强
 * 在影片详情页显示番号库中的收藏状态和用户评分，支持直接修改
 */
export class VideoFavoriteRatingEnhancer {
  private static readonly CONTAINER_SELECTOR = '.video-favorite-rating-container';
  private videoId: string | null = null;
  private record: VideoRecord | null = null;
  private containerElement: HTMLElement | null = null;

  /**
   * 初始化增强功能
   */
  public async init(): Promise<void> {
    try {
      const steps: Array<() => Promise<void>> = [
        async () => {
      // 检查是否启用
      if (!STATE.settings?.videoEnhancement?.enableVideoFavoriteRating) {
        log('[VideoFavoriteRating] Feature disabled in settings');
        throw new Error('video-favorite-rating-disabled');
      }
        },
        async () => {

      // 获取当前影片ID
      this.videoId = extractVideoIdFromPage();
      if (!this.videoId) {
        log('[VideoFavoriteRating] No video ID found');
        throw new Error('video-favorite-rating-missing-id');
      }

      log('[VideoFavoriteRating] Initializing for video:', this.videoId);
        },
        async () => {

      // 从番号库获取记录
      await this.loadRecord();
        },
        async () => {

      // 始终显示UI，即使记录不存在（允许用户直接添加收藏和评分）
      await this.renderUI();
        },
      ];

      await runChunkedWork(steps, {
        batchSize: 1,
        parentLabel: 'videoFavoriteRating:init',
        yieldAfterBatch: async () => {
          await yieldToMainThread(0);
        },
        onBatchComplete: async ({ batchIndex }) => {
          const subtaskLabels = ['check-enabled', 'resolve-video-id', 'load-record', 'render-ui'];
          saveSubtaskDetail({
            label: `videoFavoriteRating:init:${subtaskLabels[batchIndex] || 'step'}`,
            parentLabel: 'videoFavoriteRating:init',
            subtaskLabel: subtaskLabels[batchIndex] || 'step',
            batchIndex,
            itemCount: 1,
            phase: 'deferred',
            status: 'done',
            durationMs: 0,
          });
        },
        onItem: async (step) => {
          await step();
        }
      });
    } catch (error) {
      if (error instanceof Error && (
        error.message === 'video-favorite-rating-disabled' ||
        error.message === 'video-favorite-rating-missing-id'
      )) {
        return;
      }
      console.error('[VideoFavoriteRating] Init error:', error);
    }
  }

  /**
   * 从番号库加载记录
   */
  private async loadRecord(): Promise<void> {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DB:VIEWED_GET',
        payload: { id: this.videoId }
      });

      if (response?.success && response.record) {
        this.record = response.record;
        log('[VideoFavoriteRating] Record loaded:', this.record);
      }
    } catch (error) {
      console.error('[VideoFavoriteRating] Failed to load record:', error);
    }
  }

  /**
   * 渲染UI
   */
  private async renderUI(): Promise<void> {
    try {
      // 查找插入位置（影片标题下方）
      const titleContainer = document.querySelector('h2.title.is-4');
      if (!titleContainer) {
        log('[VideoFavoriteRating] Title container not found');
        return;
      }

      const existingContainers = Array.from(document.querySelectorAll<HTMLElement>(VideoFavoriteRatingEnhancer.CONTAINER_SELECTOR));
      const firstExisting = existingContainers[0] || null;
      if (existingContainers.length > 1) {
        existingContainers.slice(1).forEach((element) => element.remove());
      }

      if (firstExisting) {
        this.containerElement = firstExisting;
        this.containerElement.innerHTML = this.generateHTML();
        this.bindEvents();
        log('[VideoFavoriteRating] UI refreshed');
        return;
      }

      // 创建容器
      this.containerElement = document.createElement('div');
      this.containerElement.className = 'video-favorite-rating-container';
      this.containerElement.innerHTML = this.generateHTML();

      // 插入到标题下方
      titleContainer.parentElement?.insertBefore(
        this.containerElement,
        titleContainer.nextSibling
      );

      // 绑定事件
      this.bindEvents();

      log('[VideoFavoriteRating] UI rendered');
    } catch (error) {
      console.error('[VideoFavoriteRating] Failed to render UI:', error);
    }
  }

  private static readonly HEART_PATH = 'M10 17 C10 17 2 11.5 2 6.5 C2 4 4 2.5 6 2.5 C7.6 2.5 9.1 3.5 10 5 C10.9 3.5 12.4 2.5 14 2.5 C16 2.5 18 4 18 6.5 C18 11.5 10 17 10 17Z';
  private static readonly STAR_POINTS = '10,1.5 12.4,7.2 18.5,7.6 14,11.8 15.6,17.9 10,14.5 4.4,17.9 6,11.8 1.5,7.6 7.6,7.2';

  /**
   * 生成HTML
   */
  private generateHTML(): string {
    const isFavorite = this.record?.isFavorite || false;
    const userRating = this.record?.userRating || 0;

    return `
      <div class="vfr-panel">
        <div class="vfr-favorite">
          <button class="vfr-favorite-btn ${isFavorite ? 'favorited' : ''}"
                  data-favorited="${isFavorite}"
                  title="${isFavorite ? '取消收藏' : '添加到收藏'}">
            <svg class="vfr-heart-svg" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
              <path d="${VideoFavoriteRatingEnhancer.HEART_PATH}"/>
            </svg>
            <span>${isFavorite ? '已收藏' : '收藏'}</span>
          </button>
        </div>
        <div class="vfr-rating">
          <span class="vfr-rating-label">我的评分：</span>
          <div class="vfr-stars">
            ${this.generateStarsHTML(userRating)}
          </div>
          <span class="vfr-rating-value">${userRating > 0 ? userRating.toFixed(1) : '未评分'}</span>
        </div>
      </div>
    `;
  }

  /**
   * 生成星星HTML（SVG渐变实现半星，不依赖字体）
   */
  private generateStarsHTML(rating: number): string {
    let html = '';
    for (let i = 1; i <= 5; i++) {
      const isFull = i <= Math.floor(rating);
      const isHalf = !isFull && i <= Math.ceil(rating) && rating % 1 >= 0.5;
      const filledPct = isFull ? 100 : isHalf ? 50 : 0;
      const gradId = `vfr-sg-${i}`;

      html += `
        <span class="vfr-star-svg" data-star="${i}">
          <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="${gradId}" x1="0" x2="1" y1="0" y2="0">
                <stop offset="${filledPct}%" stop-color="#ffd700"/>
                <stop offset="${filledPct}%" stop-color="#d0d0d0"/>
              </linearGradient>
            </defs>
            <polygon fill="url(#${gradId})" points="${VideoFavoriteRatingEnhancer.STAR_POINTS}"/>
          </svg>
        </span>
      `;
    }
    return html;
  }

  /**
   * 绑定事件（星星用事件委托，避免重复绑定）
   */
  private bindEvents(): void {
    if (!this.containerElement) return;

    const favoriteBtn = this.containerElement.querySelector('.vfr-favorite-btn');
    favoriteBtn?.addEventListener('click', () => this.toggleFavorite());

    const starsContainer = this.containerElement.querySelector('.vfr-stars');
    starsContainer?.addEventListener('click', (e) => {
      const starSpan = (e.target as HTMLElement).closest('.vfr-star-svg') as HTMLElement | null;
      if (!starSpan) return;
      const starIndex = parseInt(starSpan.dataset.star || '0');
      const rect = starSpan.getBoundingClientRect();
      const isLeftHalf = (e as MouseEvent).clientX < rect.left + rect.width / 2;
      this.setRating(isLeftHalf ? starIndex - 0.5 : starIndex);
    });
  }

  /**
   * 切换收藏状态
   */
  private async toggleFavorite(): Promise<void> {
    try {
      // 如果记录不存在，先创建记录
      if (!this.record) {
        this.record = {
          id: this.videoId!,
          title: document.querySelector('h2.title.is-4 strong')?.textContent?.trim() || this.videoId!,
          status: 'browsed',
          tags: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isFavorite: false
        };
      }

      const newFavoriteState = !this.record.isFavorite;
      this.record.isFavorite = newFavoriteState;
      if (newFavoriteState) {
        this.record.favoritedAt = Date.now();
      }
      this.record.updatedAt = Date.now();

      // 保存 VideoRecord 到数据库
      await chrome.runtime.sendMessage({
        type: 'DB:VIEWED_PUT',
        payload: { record: this.record }
      });

      // 如果是收藏，同时在收藏中心创建/更新对应的番号前缀标签
      if (newFavoriteState) {
        // 提取番号前缀（如 "ABC" 从 "ABC-123"，"050826" 从 "050826_100"）
        const codePrefix = this.videoId!.split(/[-_]/)[0].toUpperCase();
        const listRecord: any = {
          id: codePrefix,
          name: codePrefix,
          type: 'label',
          source: 'local',
          moviesCount: 1,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        // 尝试先获取已有记录，合并 moviesCount
        try {
          const existing = await chrome.runtime.sendMessage({ type: 'DB:LISTS_GET', payload: { id: codePrefix } });
          if (existing?.record) {
            listRecord.moviesCount = ((existing.record as any).moviesCount || 0) + 1;
            listRecord.createdAt = (existing.record as any).createdAt || Date.now();
          }
        } catch { /* ignore */ }
        await chrome.runtime.sendMessage({ type: 'DB:LISTS_PUT', payload: { record: listRecord } });
      } else {
        // 取消收藏时递减对应番号前缀的 moviesCount
        const codePrefix = this.videoId!.split(/[-_]/)[0].toUpperCase();
        try {
          const existing = await chrome.runtime.sendMessage({ type: 'DB:LISTS_GET', payload: { id: codePrefix } });
          if (existing?.record) {
            const rec = existing.record as any;
            const newCount = Math.max(0, (rec.moviesCount || 1) - 1);
            if (newCount <= 0) {
              await chrome.runtime.sendMessage({ type: 'DB:LISTS_DELETE', payload: { id: codePrefix } });
            } else {
              await chrome.runtime.sendMessage({ type: 'DB:LISTS_PUT', payload: { record: { ...rec, moviesCount: newCount, updatedAt: Date.now() } } });
            }
          }
        } catch { /* ignore */ }
      }

      // 更新UI
      const btn = this.containerElement?.querySelector('.vfr-favorite-btn');
      if (btn) {
        btn.classList.toggle('favorited', newFavoriteState);
        btn.setAttribute('data-favorited', String(newFavoriteState));
        btn.setAttribute('title', newFavoriteState ? '取消收藏' : '添加到收藏');
        const text = btn.querySelector('span:last-child');
        if (text) {
          text.textContent = newFavoriteState ? '已收藏' : '收藏';
        }
      }

      showToast(newFavoriteState ? '已添加到收藏' : '已取消收藏', 'success');
      log('[VideoFavoriteRating] Favorite toggled:', newFavoriteState);

      if (newFavoriteState && this.videoId) {
        setTimeout(() => {
          handleAutoPushOnFavoriteDetail(this.videoId!).catch((err) => {
            log('[VideoFavoriteRating] Auto-push error:', err);
          });
        }, 500);
      }
    } catch (error) {
      console.error('[VideoFavoriteRating] Failed to toggle favorite:', error);
      showToast('操作失败，请重试', 'error');
    }
  }

  /**
   * 设置评分
   */
  private async setRating(rating: number): Promise<void> {
    try {
      // 如果记录不存在，先创建记录
      if (!this.record) {
        this.record = {
          id: this.videoId!,
          title: document.querySelector('h2.title.is-4 strong')?.textContent?.trim() || this.videoId!,
          status: 'browsed',
          tags: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          userRating: 0
        };
      }

      this.record.userRating = rating;
      this.record.updatedAt = Date.now();

      // 保存到数据库
      await chrome.runtime.sendMessage({
        type: 'DB:VIEWED_PUT',
        payload: { record: this.record }
      });

      // 更新UI
      const starsContainer = this.containerElement?.querySelector('.vfr-stars');
      const ratingValue = this.containerElement?.querySelector('.vfr-rating-value');

      if (starsContainer) {
        starsContainer.innerHTML = this.generateStarsHTML(rating);
      }

      if (ratingValue) {
        ratingValue.textContent = rating > 0 ? rating.toFixed(1) : '未评分';
      }

      showToast(`评分已更新：${rating.toFixed(1)} 星`, 'success');
      log('[VideoFavoriteRating] Rating updated:', rating);
    } catch (error) {
      console.error('[VideoFavoriteRating] Failed to set rating:', error);
      showToast('评分失败，请重试', 'error');
    }
  }

  /**
   * 销毁
   */
  public destroy(): void {
    if (this.containerElement) {
      this.containerElement.remove();
      this.containerElement = null;
    }
    this.record = null;
    this.videoId = null;
  }
}

async function isAutoPushOnFavoriteEnabled(): Promise<boolean> {
  try {
    const settings = await getSettings() as any;
    return !!(settings?.drive115?.enabled && settings?.drive115?.autoPushOnFavorite);
  } catch (error) {
    log('[VideoFavoriteRating] Failed to check auto-push setting:', error);
    return false;
  }
}

function collectMagnetsFromDetailPage(): MagnetResult[] {
  const results: MagnetResult[] = [];
  try {
    const magnetContent = document.querySelector('#magnets-content');
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
        log('[VideoFavoriteRating] Error parsing magnet item:', e);
      }
    });
  } catch (error) {
    log('[VideoFavoriteRating] Error collecting magnets:', error);
  }
  return results;
}

async function pushMagnetToDrive115(
  videoId: string,
  magnetUrl: string,
  magnetName: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    log(`[VideoFavoriteRating] Auto-pushing to 115: ${videoId} | ${magnetName}`);

    const { addTaskUrlsV2 } = await import('../drive115/router');
    const settings = await getSettings() as any;
    const downloadDir = settings?.drive115?.downloadDir || '0';
    const wpPathId = downloadDir === '' ? '0' : downloadDir;

    const res = await addTaskUrlsV2({
      urls: magnetUrl,
      wp_path_id: wpPathId,
      context: {
        source: 'auto_push_favorite_detail',
        videoId,
        magnetName,
        pageUrl: window.location.href,
        wpPathId,
      } as any,
    });

    if (res.success) {
      log(`[VideoFavoriteRating] Auto-push success for ${videoId}`);
      return { success: true };
    } else {
      log(`[VideoFavoriteRating] Auto-push failed for ${videoId}: ${res.message}`);
      return { success: false, error: res.message || '推送失败' };
    }
  } catch (error) {
    log('[VideoFavoriteRating] Auto-push to 115 failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    };
  }
}

async function handleAutoPushOnFavoriteDetail(videoId: string): Promise<void> {
  try {
    const enabled = await isAutoPushOnFavoriteEnabled();
    if (!enabled) return;

    log(`[VideoFavoriteRating] Starting auto-push for favorited video: ${videoId}`);

    const magnets = collectMagnetsFromDetailPage();

    if (magnets.length === 0) {
      log(`[VideoFavoriteRating] No magnets found for ${videoId}, skipping auto-push`);
      showToast(`${videoId} 未找到磁力链接，跳过自动推送`, 'info');
      return;
    }

    const optimalMagnet = selectOptimalMagnet(magnets);
    if (!optimalMagnet) {
      log(`[VideoFavoriteRating] Failed to select optimal magnet for ${videoId}`);
      return;
    }

    log(`[VideoFavoriteRating] Selected optimal magnet: ${optimalMagnet.name.substring(0, 50)}...`);

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
    log('[VideoFavoriteRating] Auto-push on favorite failed:', error);
    showToast('自动推送115网盘时发生错误', 'error');
  }
}

// 导出单例
export const videoFavoriteRatingEnhancer = new VideoFavoriteRatingEnhancer();
