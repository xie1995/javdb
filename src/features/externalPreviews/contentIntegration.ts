import { initListPagePreviews } from './listPreviewImageController';
import { createDetailPreviewViewer } from './ui/detailPreviewViewer';
import { renderOnlineVideoLinks } from './onlineVideoSites';
import { fetchExternalPreviewImage, type PreviewImage } from './fetcher';

export interface ExternalPreviewContentConfig {
  enabled: boolean;
  listPreviewEnabled: boolean;
  detailPreviewEnabled: boolean;
  onlineVideoEnabled: boolean;
}

const DEFAULT_CONFIG: ExternalPreviewContentConfig = {
  enabled: true,
  listPreviewEnabled: true,
  detailPreviewEnabled: true,
  onlineVideoEnabled: true,
};

let config: ExternalPreviewContentConfig = { ...DEFAULT_CONFIG };

export function updateExternalPreviewConfig(newConfig: Partial<ExternalPreviewContentConfig>): void {
  config = { ...config, ...newConfig };
}

function getCodeFromItem(item: HTMLElement): string | null {
  const titleElement = item.querySelector('.video-title strong');
  if (titleElement) {
    return titleElement.textContent?.trim() || null;
  }
  
  const link = item.querySelector('a[href*="/v/"]') as HTMLAnchorElement;
  if (link) {
    const match = link.href.match(/\/v\/([^/]+)/);
    if (match) return match[1];
  }
  
  return null;
}

export function initListPagePreviewsFromConfig(): void {
  if (!config.enabled || !config.listPreviewEnabled) return;
  initListPagePreviews();
}

export function initDetailPagePreviews(): void {
  if (!config.enabled) return;

  const code = getDetailPageCode();
  if (!code) return;

  if (config.detailPreviewEnabled) {
    void initDetailPreviewGallery(code);
  }

  if (config.onlineVideoEnabled) {
    initDetailOnlineVideoLinks(code);
  }
}

function getDetailPageCode(): string | null {
  const pathMatch = window.location.pathname.match(/\/v\/([^/]+)/);
  if (pathMatch) return pathMatch[1];

  const titleElement = document.querySelector('.video-title strong, h2.title strong');
  if (titleElement) {
    return titleElement.textContent?.trim() || null;
  }

  return null;
}

async function initDetailPreviewGallery(code: string): Promise<void> {
  const insertionTarget = findDetailInsertionTarget();
  if (!insertionTarget) return;

  const loadingPanel = document.createElement('div');
  loadingPanel.id = 'jdb-detail-preview-panel';
  loadingPanel.className = 'panel-block';
  loadingPanel.innerHTML = `
    <strong>预览图:</strong>
    <span class="value" style="margin-left: 0.5rem; color: #888;">加载中...</span>
  `;
  
  insertionTarget.parent.insertBefore(loadingPanel, insertionTarget.before);

  try {
    const image = await fetchExternalPreviewImage(code);
    
    loadingPanel.remove();
    
    if (image) {
      const images: PreviewImage[] = [image];
      const viewer = createDetailPreviewViewer(images);
      insertionTarget.parent.insertBefore(viewer, insertionTarget.before);
    } else {
      const emptyPanel = document.createElement('div');
      emptyPanel.id = 'jdb-detail-preview-panel';
      emptyPanel.className = 'panel-block';
      emptyPanel.innerHTML = `
        <strong>预览图:</strong>
        <span class="value" style="margin-left: 0.5rem; color: #999;">暂无预览图</span>
      `;
      insertionTarget.parent.insertBefore(emptyPanel, insertionTarget.before);
    }
  } catch {
    loadingPanel.innerHTML = `
      <strong>预览图:</strong>
      <span class="value" style="margin-left: 0.5rem; color: #999;">获取失败</span>
    `;
  }
}

function initDetailOnlineVideoLinks(code: string): void {
  const panel = renderOnlineVideoLinks(code);
  if (!panel) return;

  const insertionTarget = findDetailInsertionTarget();
  if (!insertionTarget) return;

  const existingPreview = document.getElementById('jdb-detail-preview-panel');
  if (existingPreview) {
    existingPreview.after(panel);
  } else {
    insertionTarget.parent.insertBefore(panel, insertionTarget.before);
  }
}

function findDetailInsertionTarget(): { parent: Node; before: Node | null } | null {
  const onlinePanel = document.getElementById('jdb-online-availability-panel');
  if (onlinePanel?.parentElement) {
    return { parent: onlinePanel.parentElement, before: onlinePanel.nextSibling };
  }

  const externalSearchPanel = document.getElementById('jdb-external-search-panel');
  if (externalSearchPanel?.parentElement) {
    return { parent: externalSearchPanel.parentElement, before: externalSearchPanel.nextSibling };
  }

  const moviePanel = document.querySelector('.movie-panel-info');
  const reviewButtons = moviePanel?.querySelector('.review-buttons');
  if (reviewButtons?.parentElement) {
    return { parent: reviewButtons.parentElement, before: reviewButtons.nextSibling };
  }

  const firstBlock = moviePanel?.querySelector('.panel-block');
  if (firstBlock?.parentElement) {
    return { parent: firstBlock.parentElement, before: firstBlock.nextSibling };
  }

  return null;
}

export function initExternalPreviewsContent(): void {
  const isListPage = document.querySelector('.movie-list') !== null;
  const isDetailPage = /\/v\/[^/]+/.test(window.location.pathname);

  if (isListPage) {
    initListPagePreviewsFromConfig();
  }

  if (isDetailPage) {
    initDetailPagePreviews();
  }
}
