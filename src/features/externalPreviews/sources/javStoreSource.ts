import { HttpClient, defaultHttpClient } from '../../../platform/network/httpClient';
import type { PreviewImage } from './javFreeSource';

export interface JavStoreConfig {
  enabled: boolean;
  baseUrl: string;
  timeout: number;
  maxRetries: number;
}

export class JavStoreSource {
  private httpClient: HttpClient;
  private config: JavStoreConfig;

  constructor(config: JavStoreConfig) {
    this.config = config;
    this.httpClient = defaultHttpClient;
  }

  async getPreviewImages(code: string): Promise<PreviewImage[]> {
    try {
      if (!this.config.enabled) return [];

      const normalizedCode = this.normalizeCode(code);
      const searchUrl = `${this.config.baseUrl}/search?q=${encodeURIComponent(normalizedCode)}`;

      const document = await this.httpClient.getDocument(searchUrl, {
        timeout: this.config.timeout,
        retries: this.config.maxRetries,
      });

      const articleLink = this.findArticleLink(document, normalizedCode);
      if (!articleLink) return [];

      const articleUrl = articleLink.startsWith('/')
        ? this.config.baseUrl + articleLink
        : articleLink;

      const articleDoc = await this.httpClient.getDocument(articleUrl, {
        timeout: this.config.timeout,
        retries: this.config.maxRetries,
      });

      return this.extractImages(articleDoc);
    } catch {
      return [];
    }
  }

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase().replace(/\s+/g, '-');
  }

  private findArticleLink(doc: Document, code: string): string | null {
    const cleanCode = code.replace(/[-_]/g, '').toUpperCase();
    
    const candidates = doc.querySelectorAll('div.grid > a, a.group, article h2 a, .video-card a');
    for (const a of candidates) {
      const h3Text = a.querySelector('h3')?.textContent || '';
      const text = a.textContent || a.querySelector('img')?.alt || '';
      const combined = (h3Text + ' ' + text).toUpperCase().replace(/[-_\s]/g, '');
      
      if (combined.includes(cleanCode)) {
        return a.getAttribute('href');
      }
    }

    const allLinks = doc.querySelectorAll('a');
    for (const link of allLinks) {
      const text = link.textContent?.trim() || '';
      const cleanText = text.replace(/[-_\s]/g, '').toUpperCase();
      if (cleanText.includes(cleanCode) && cleanText.length < 100) {
        const href = link.getAttribute('href');
        if (href && !href.includes('/search') && !href.includes('?q=')) {
          return href;
        }
      }
    }

    return null;
  }

  private extractImages(doc: Document): PreviewImage[] {
    const images: PreviewImage[] = [];
    const seenUrls = new Set<string>();

    const imgElements = doc.querySelectorAll('.prose img, .entry-content img, article img, .post-body img');
    for (const img of imgElements) {
      let src = img.getAttribute('src') || img.getAttribute('data-src') || '';
      if (!src) continue;

      src = src.replace(/^http:/, 'https:');
      
      if (seenUrls.has(src)) continue;
      seenUrls.add(src);

      if (this.isValidImage(src)) {
        images.push({
          url: src,
          source: 'javstore',
        });
      }
    }

    return images;
  }

  private isValidImage(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    if (!imageExtensions.some(ext => lowerUrl.includes(ext))) return false;
    
    const excludePatterns = ['avatar', 'icon', 'logo', 'button', 'banner', 'ads', 'thumb', '_s.'];
    return !excludePatterns.some(pattern => lowerUrl.includes(pattern));
  }
}

export const DEFAULT_JAVSTORE_CONFIG: JavStoreConfig = {
  enabled: true,
  baseUrl: 'https://javstore.net',
  timeout: 15000,
  maxRetries: 2,
};
