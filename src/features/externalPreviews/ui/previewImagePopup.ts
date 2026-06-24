import type { PreviewImage } from '../fetcher';

export interface PreviewImagePopupOptions {
  width?: number;
  offsetX?: number;
  offsetY?: number;
}

export function createPreviewImagePopup(
  images: PreviewImage[],
  options: PreviewImagePopupOptions = {},
): HTMLElement {
  const popup = document.createElement('div');
  popup.className = 'jdb-external-preview-popup';
  
  const width = options.width || 400;
  popup.style.width = `${width}px`;

  if (images.length === 0) {
    popup.innerHTML = '<div class="jdb-preview-no-image">暂无预览图</div>';
    return popup;
  }

  const mainImage = images[0];
  const imageContainer = document.createElement('div');
  imageContainer.className = 'jdb-preview-main-image';
  
  const img = document.createElement('img');
  img.src = mainImage.url;
  img.alt = 'Preview';
  img.style.maxWidth = '100%';
  img.style.height = 'auto';
  img.style.display = 'block';
  
  imageContainer.appendChild(img);
  popup.appendChild(imageContainer);

  if (images.length > 1) {
    const thumbnails = document.createElement('div');
    thumbnails.className = 'jdb-preview-thumbnails';
    
    images.slice(0, 8).forEach((image, index) => {
      const thumb = document.createElement('div');
      thumb.className = 'jdb-preview-thumbnail' + (index === 0 ? ' active' : '');
      
      const thumbImg = document.createElement('img');
      thumbImg.src = image.url;
      thumbImg.alt = `Preview ${index + 1}`;
      
      thumb.appendChild(thumbImg);
      thumb.addEventListener('click', () => {
        img.src = image.url;
        thumbnails.querySelectorAll('.jdb-preview-thumbnail').forEach(t => t.classList.remove('active'));
        thumb.classList.add('active');
      });
      
      thumbnails.appendChild(thumb);
    });
    
    popup.appendChild(thumbnails);
  }

  const sourceInfo = document.createElement('div');
  sourceInfo.className = 'jdb-preview-source';
  const sources = [...new Set(images.map(i => i.source))];
  sourceInfo.textContent = `来源: ${sources.join(', ')}`;
  popup.appendChild(sourceInfo);

  return popup;
}

export function injectPreviewPopupStyles(): void {
  const styleId = 'jdb-external-preview-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .jdb-external-preview-popup {
      position: fixed;
      z-index: 10000;
      background: #fff;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      overflow: hidden;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    
    .jdb-external-preview-popup.visible {
      opacity: 1;
      pointer-events: auto;
    }
    
    .jdb-preview-main-image {
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 200px;
    }
    
    .jdb-preview-main-image img {
      max-height: 500px;
      object-fit: contain;
    }
    
    .jdb-preview-thumbnails {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 8px;
      background: #f5f5f5;
    }
    
    .jdb-preview-thumbnail {
      width: 60px;
      height: 60px;
      overflow: hidden;
      border-radius: 4px;
      cursor: pointer;
      border: 2px solid transparent;
      opacity: 0.7;
      transition: opacity 0.2s, border-color 0.2s;
    }
    
    .jdb-preview-thumbnail:hover {
      opacity: 1;
    }
    
    .jdb-preview-thumbnail.active {
      border-color: #3273dc;
      opacity: 1;
    }
    
    .jdb-preview-thumbnail img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    
    .jdb-preview-source {
      padding: 6px 10px;
      font-size: 11px;
      color: #888;
      background: #fafafa;
      border-top: 1px solid #eee;
    }
    
    .jdb-preview-no-image {
      padding: 40px 20px;
      text-align: center;
      color: #999;
      font-size: 14px;
    }
    
    .jdb-preview-loading {
      padding: 30px 20px;
      text-align: center;
      color: #666;
      font-size: 13px;
    }
    
    .jdb-preview-loading::after {
      content: '...';
      animation: dots 1.5s steps(4, end) infinite;
    }
    
    @keyframes dots {
      0%, 20% { content: '.'; }
      40% { content: '..'; }
      60%, 100% { content: '...'; }
    }
  `;
  
  document.head.appendChild(style);
}
