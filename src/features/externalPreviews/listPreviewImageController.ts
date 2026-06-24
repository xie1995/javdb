import { fetchExternalPreviewImage, fetchAllPreviewImages, fetchImageProxy, type PreviewImage } from './fetcher';

const PREVIEW_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;

const BROKEN_ICON = `<svg viewBox="0 0 24 24" style="width:16px;height:16px;"><path fill="currentColor" d="M21 5v6.59l-2.29-2.3c-.39-.39-1.03-.39-1.42 0L14 12.59L10.71 9.3a.996.996 0 0 0-1.41 0L6 12.59L3 9.58V5c0-1.1.9-2 2-2h14c1.1 0 2 .9 2 2m-3 6.42l3 3.01V19c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2v-6.58l2.29 2.29c.39.39 1.02.39 1.41 0l3.3-3.3l3.29 3.29c.39.39 1.02.39 1.41 0z"/></svg>`;

let previewModal: HTMLElement | null = null;
let modalOverlay: HTMLElement | null = null;
let currentImages: PreviewImage[] = [];
let currentIndex = 0;

export function initListPagePreviews(): void {
  injectStyles();
  attachToAllItems();

  const movieList = document.querySelector('.movie-list');
  if (movieList) {
    const observer = new MutationObserver(() => {
      attachToAllItems();
    });
    observer.observe(movieList, { childList: true, subtree: true });
  }
}

function injectStyles(): void {
  const styleId = 'jdb-preview-icon-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .jdb-preview-icon {
      position: absolute;
      top: 32px;
      right: 8px;
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
      opacity: 1;
      transition: background 0.2s;
      backdrop-filter: blur(4px);
    }
    
    .jdb-preview-icon:hover {
      background: rgba(50, 115, 220, 0.9);
    }
    
    .jdb-preview-icon.is-loading {
      background: rgba(50, 115, 220, 0.8);
    }
    
    .jdb-preview-icon.is-loading svg {
      animation: jdb-spin 1s linear infinite;
    }
    
    .jdb-preview-icon.has-preview {
      background: rgba(72, 199, 142, 0.85);
    }
    
    .jdb-preview-icon.fetch-failed,
    .jdb-preview-icon.fetch-error {
      background: rgba(255, 56, 96, 0.75);
    }
    
    @keyframes jdb-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    
    .jdb-preview-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.9);
      z-index: 99999;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      animation: jdb-fade-in 0.2s ease-out;
      overflow: hidden;
    }
    
    @keyframes jdb-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    
    .jdb-preview-modal {
      position: relative;
      max-width: 100%;
      max-height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      animation: jdb-scale-in 0.25s ease-out;
    }
    
    @keyframes jdb-scale-in {
      from { transform: scale(0.9); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    
    .jdb-preview-image-container {
      width: 98vw;
      height: 90vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .jdb-preview-image-container img {
      max-width: 100%;
      max-height: 100%;
      width: auto;
      height: auto;
      object-fit: contain;
      border-radius: 4px;
    }
    
    .jdb-preview-close {
      position: fixed;
      top: 20px;
      right: 20px;
      width: 40px;
      height: 40px;
      border: none;
      border-radius: 50%;
      background: rgba(255, 56, 96, 0.9);
      color: #fff;
      font-size: 24px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100000;
      line-height: 1;
    }
    
    .jdb-preview-close:hover {
      background: rgba(255, 56, 96, 1);
    }
    
    .jdb-preview-thumbs {
      display: flex;
      gap: 8px;
      padding: 12px 16px;
      overflow-x: auto;
      max-width: 98vw;
      max-height: 120px;
      margin-top: 12px;
    }
    
    .jdb-preview-thumbs::-webkit-scrollbar {
      height: 6px;
    }
    
    .jdb-preview-thumbs::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
    }
    
    .jdb-preview-thumbs::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.3);
      border-radius: 3px;
    }
    
    .jdb-preview-thumb {
      width: 80px;
      height: 80px;
      object-fit: cover;
      border-radius: 4px;
      cursor: pointer;
      opacity: 0.6;
      transition: opacity 0.2s, transform 0.2s, border-color 0.2s;
      border: 2px solid transparent;
    }
    
    .jdb-preview-thumb:hover {
      opacity: 1;
      transform: scale(1.05);
    }
    
    .jdb-preview-thumb.active {
      opacity: 1;
      border-color: #3273dc;
    }
    
    .jdb-preview-source {
      position: fixed;
      bottom: 120px;
      left: 50%;
      transform: translateX(-50%);
      color: #999;
      font-size: 14px;
      white-space: nowrap;
      background: rgba(0, 0, 0, 0.6);
      padding: 6px 16px;
      border-radius: 20px;
      z-index: 100000;
    }
    
    .jdb-preview-error {
      color: #ff3860;
      font-size: 16px;
      padding: 40px;
    }
    
    .movie-list .item {
      position: relative;
    }
  `;
  document.head.appendChild(style);
}

function attachToAllItems(): void {
  const items = document.querySelectorAll('.movie-list .item');
  items.forEach(item => {
    if (!item.querySelector('.jdb-preview-icon')) {
      attachPreviewIcon(item as HTMLElement);
    }
  });
}

function attachPreviewIcon(item: HTMLElement): void {
  const cover = item.querySelector('.cover') || item.querySelector('a.box') || item.querySelector('.box');
  if (!cover) return;

  const btn = document.createElement('button');
  btn.className = 'jdb-preview-icon';
  btn.innerHTML = PREVIEW_ICON;
  btn.title = '点击获取预览图';
  btn.type = 'button';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void handlePreviewClick(item, btn);
  });

  (cover as HTMLElement).style.position = 'relative';
  cover.appendChild(btn);
}

function getCodeFromItem(item: HTMLElement): string {
  const titleEl = item.querySelector('.video-title strong, .title strong, h3 strong');
  if (titleEl?.textContent) {
    return titleEl.textContent.trim().toUpperCase();
  }
  const title = item.querySelector('.video-title, .title, h3');
  if (title?.textContent) {
    const match = title.textContent.match(/[A-Za-z]{2,10}[-_]?\d{3,6}/i);
    if (match) return match[0].toUpperCase().replace(/_/g, '-');
  }
  return '';
}

async function handlePreviewClick(item: HTMLElement, btn: HTMLElement): Promise<void> {
  const code = getCodeFromItem(item);
  console.log('[Preview] handlePreviewClick, code:', code);
  
  if (!code) {
    console.warn('[Preview] No code found for item');
    return;
  }

  if (btn.classList.contains('is-loading')) return;

  btn.classList.remove('has-preview', 'fetch-failed', 'fetch-error');
  btn.classList.add('is-loading');
  btn.innerHTML = PREVIEW_ICON;
  btn.title = '正在获取预览图...';

  try {
    console.log('[Preview] Calling fetchExternalPreviewImage...');
    // 先尝试获取单张图片
    const singleResult = await fetchExternalPreviewImage(code);
    console.log('[Preview] fetchExternalPreviewImage result:', singleResult);
    
    if (singleResult) {
      currentImages = [singleResult];
      currentIndex = 0;
      btn.classList.remove('is-loading');
      btn.classList.add('has-preview');
      btn.innerHTML = PREVIEW_ICON;
      btn.title = `预览图 (${singleResult.source})`;
      console.log('[Preview] Opening modal...');
      openPreviewModal();
      return;
    }
    
    console.log('[Preview] Single fetch failed, trying fetchAllPreviewImages...');
    // 单张获取失败，尝试获取多张
    const images = await fetchAllPreviewImages(code);
    console.log('[Preview] fetchAllPreviewImages result:', images);
    
    if (images.length > 0) {
      currentImages = images;
      currentIndex = 0;
      btn.classList.remove('is-loading');
      btn.classList.add('has-preview');
      btn.innerHTML = PREVIEW_ICON;
      btn.title = `预览图 (${images.length}张)`;
      console.log('[Preview] Opening modal with multiple images...');
      openPreviewModal();
    } else {
      btn.classList.remove('is-loading');
      btn.classList.add('fetch-failed');
      btn.innerHTML = BROKEN_ICON;
      btn.title = '无可用预览图，点击重试';
    }
  } catch (err) {
    console.error('[Preview] Fetch error:', err);
    btn.classList.remove('is-loading');
    btn.classList.add('fetch-error');
    btn.innerHTML = BROKEN_ICON;
    btn.title = '获取失败，点击重试';
  }
}

function openPreviewModal(): void {
  console.log('[Preview] openPreviewModal called, currentImages:', currentImages.length);

  if (currentImages.length === 0) {
    console.log('[Preview] No images to display');
    return;
  }

  closePreviewModal();

  modalOverlay = document.createElement('div');
  modalOverlay.className = 'jdb-preview-modal-overlay';
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closePreviewModal();
  });

  previewModal = document.createElement('div');
  previewModal.className = 'jdb-preview-modal';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'jdb-preview-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', closePreviewModal);
  previewModal.appendChild(closeBtn);

  // 主图容器
  const imgContainer = document.createElement('div');
  imgContainer.className = 'jdb-preview-image-container';
  
  const img = document.createElement('img');
  img.alt = 'Preview';
  img.referrerPolicy = 'no-referrer';
  
  // 直接用代理加载（绕过防盗链）
  console.log('[Preview] Loading image via proxy:', currentImages[currentIndex].url);
  fetchImageProxy(currentImages[currentIndex].url)
    .then(dataUrl => {
      console.log('[Preview] Proxy image loaded successfully, size:', dataUrl.length);
      img.src = dataUrl;
    })
    .catch(err => {
      console.error('[Preview] Proxy image failed:', err);
      // 代理失败，尝试直接加载
      img.src = currentImages[currentIndex].url;
      img.onerror = () => {
        if (currentIndex < currentImages.length - 1) {
          currentIndex++;
          updateMainImage();
        } else {
          imgContainer.innerHTML = '<div class="jdb-preview-error">图片加载失败</div>';
        }
      };
    });
  
  imgContainer.appendChild(img);
  previewModal.appendChild(imgContainer);

  // 缩略图导航栏
  const thumbContainer = document.createElement('div');
  thumbContainer.className = 'jdb-preview-thumbs';
  
  currentImages.forEach((image, index) => {
    const thumb = document.createElement('img');
    thumb.src = image.url;
    thumb.referrerPolicy = 'no-referrer';
    thumb.className = `jdb-preview-thumb ${index === currentIndex ? 'active' : ''}`;
    thumb.addEventListener('click', () => {
      currentIndex = index;
      img.src = image.url;
      // 更新活动状态
      thumbContainer.querySelectorAll('.jdb-preview-thumb').forEach((t, i) => {
        t.classList.toggle('active', i === index);
      });
    });
    thumbContainer.appendChild(thumb);
  });
  previewModal.appendChild(thumbContainer);

  // 来源标签
  const sourceLabel = document.createElement('div');
  sourceLabel.className = 'jdb-preview-source';
  sourceLabel.textContent = `来源: ${currentImages[0].source} | ${currentIndex + 1}/${currentImages.length}`;
  previewModal.appendChild(sourceLabel);

  modalOverlay.appendChild(previewModal);
  document.body.appendChild(modalOverlay);

  document.addEventListener('keydown', onModalKeydown);
}

function closePreviewModal(): void {
  if (modalOverlay) {
    modalOverlay.remove();
    modalOverlay = null;
  }
  if (previewModal) {
    previewModal = null;
  }
  document.removeEventListener('keydown', onModalKeydown);
}

function onModalKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    closePreviewModal();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    if (currentIndex > 0) {
      currentIndex--;
      updateMainImage();
    }
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (currentIndex < currentImages.length - 1) {
      currentIndex++;
      updateMainImage();
    }
  }
}

function updateMainImage(): void {
  if (!previewModal || currentImages.length === 0) return;
  
  const img = previewModal.querySelector('.jdb-preview-image-container img') as HTMLImageElement;
  const sourceLabel = previewModal.querySelector('.jdb-preview-source') as HTMLDivElement;
  const thumbs = previewModal.querySelectorAll('.jdb-preview-thumb');
  
  if (img) {
    console.log('[Preview] Switching to image', currentIndex, ':', currentImages[currentIndex].url);
    // 用代理加载
    fetchImageProxy(currentImages[currentIndex].url)
      .then(dataUrl => {
        console.log('[Preview] Switched image loaded via proxy');
        img.src = dataUrl;
      })
      .catch(err => {
        console.error('[Preview] Switched image proxy failed:', err);
        img.src = currentImages[currentIndex].url;
        img.onerror = () => {
          if (currentIndex < currentImages.length - 1) {
            currentIndex++;
            updateMainImage();
          }
        };
      });
  }
  
  if (sourceLabel) {
    sourceLabel.textContent = `来源: ${currentImages[currentIndex].source} | ${currentIndex + 1}/${currentImages.length}`;
  }
  
  thumbs.forEach((thumb, index) => {
    thumb.classList.toggle('active', index === currentIndex);
  });
}
