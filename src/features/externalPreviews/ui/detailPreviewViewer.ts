import type { PreviewImage } from '../fetcher';

export function createDetailPreviewViewer(images: PreviewImage[]): HTMLElement {
  const container = document.createElement('div');
  container.className = 'jdb-detail-preview-panel';
  container.id = 'jdb-detail-preview-panel';

  if (images.length === 0) {
    container.innerHTML = `
      <div class="panel-block">
        <strong>预览图:</strong>
        <span class="value" style="margin-left: 0.5rem; color: #999;">暂无预览图</span>
      </div>
    `;
    return container;
  }

  const header = document.createElement('div');
  header.className = 'panel-block';
  header.innerHTML = `
    <strong>预览图:</strong>
    <span class="value" style="margin-left: 0.5rem;">
      <span class="tag is-info is-light">${images.length}张</span>
      <span class="tag is-light" style="margin-left: 4px;">${[...new Set(images.map(i => i.source))].join(', ')}</span>
    </span>
  `;
  container.appendChild(header);

  const gallery = document.createElement('div');
  gallery.className = 'jdb-preview-gallery';
  
  images.slice(0, 12).forEach((image, index) => {
    const item = document.createElement('div');
    item.className = 'jdb-gallery-item';
    
    const img = document.createElement('img');
    img.src = image.url;
    img.alt = `Preview ${index + 1}`;
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    
    item.appendChild(img);
    item.addEventListener('click', () => openImageLightbox(images, index));
    gallery.appendChild(item);
  });
  
  container.appendChild(gallery);

  injectDetailPreviewStyles();
  return container;
}

function openImageLightbox(images: PreviewImage[], currentIndex: number): void {
  const overlay = document.createElement('div');
  overlay.className = 'jdb-lightbox-overlay';
  
  const content = document.createElement('div');
  content.className = 'jdb-lightbox-content';
  
  const mainImg = document.createElement('img');
  mainImg.src = images[currentIndex].url;
  mainImg.className = 'jdb-lightbox-image';
  mainImg.referrerPolicy = 'no-referrer';
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'jdb-lightbox-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', () => overlay.remove());
  
  const prevBtn = document.createElement('button');
  prevBtn.className = 'jdb-lightbox-nav jdb-lightbox-prev';
  prevBtn.innerHTML = '&#10094;';
  prevBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    currentIndex = (currentIndex - 1 + images.length) % images.length;
    mainImg.referrerPolicy = 'no-referrer';
    mainImg.src = images[currentIndex].url;
    counter.textContent = `${currentIndex + 1} / ${images.length}`;
  });
  
  const nextBtn = document.createElement('button');
  nextBtn.className = 'jdb-lightbox-nav jdb-lightbox-next';
  nextBtn.innerHTML = '&#10095;';
  nextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    currentIndex = (currentIndex + 1) % images.length;
    mainImg.referrerPolicy = 'no-referrer';
    mainImg.src = images[currentIndex].url;
    counter.textContent = `${currentIndex + 1} / ${images.length}`;
  });
  
  const counter = document.createElement('div');
  counter.className = 'jdb-lightbox-counter';
  counter.textContent = `${currentIndex + 1} / ${images.length}`;
  
  content.appendChild(mainImg);
  content.appendChild(closeBtn);
  content.appendChild(prevBtn);
  content.appendChild(nextBtn);
  content.appendChild(counter);
  overlay.appendChild(content);
  
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    } else if (e.key === 'ArrowLeft') {
      prevBtn.click();
    } else if (e.key === 'ArrowRight') {
      nextBtn.click();
    }
  });
  
  document.body.appendChild(overlay);
}

function injectDetailPreviewStyles(): void {
  const styleId = 'jdb-detail-preview-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .jdb-preview-gallery {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 6px;
      padding: 12px;
      background: #fafafa;
    }
    
    .jdb-gallery-item {
      aspect-ratio: 1;
      overflow: hidden;
      border-radius: 4px;
      cursor: pointer;
      background: #eee;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    
    .jdb-gallery-item:hover {
      transform: scale(1.05);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      z-index: 1;
    }
    
    .jdb-gallery-item img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    
    .jdb-lightbox-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.9);
      z-index: 100000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .jdb-lightbox-content {
      position: relative;
      max-width: 90vw;
      max-height: 90vh;
    }
    
    .jdb-lightbox-image {
      max-width: 90vw;
      max-height: 90vh;
      object-fit: contain;
    }
    
    .jdb-lightbox-close {
      position: absolute;
      top: -40px;
      right: 0;
      background: none;
      border: none;
      color: #fff;
      font-size: 32px;
      cursor: pointer;
      padding: 0;
      width: 40px;
      height: 40px;
    }
    
    .jdb-lightbox-nav {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: #fff;
      font-size: 24px;
      cursor: pointer;
      padding: 20px 15px;
      transition: background 0.2s;
    }
    
    .jdb-lightbox-nav:hover {
      background: rgba(255, 255, 255, 0.2);
    }
    
    .jdb-lightbox-prev {
      left: -60px;
    }
    
    .jdb-lightbox-next {
      right: -60px;
    }
    
    .jdb-lightbox-counter {
      position: absolute;
      bottom: -30px;
      left: 50%;
      transform: translateX(-50%);
      color: #fff;
      font-size: 14px;
    }
    
    @media (max-width: 768px) {
      .jdb-preview-gallery {
        grid-template-columns: repeat(4, 1fr);
      }
      
      .jdb-lightbox-prev { left: 0; }
      .jdb-lightbox-next { right: 0; }
    }
  `;

  document.head.appendChild(style);
}
