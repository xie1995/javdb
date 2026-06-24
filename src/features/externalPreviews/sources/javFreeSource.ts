import { HttpClient, defaultHttpClient } from '../../../platform/network/httpClient';

export interface PreviewImage {
  url: string;
  thumbnail?: string;
  source: string;
  width?: number;
  height?: number;
}

export interface JavFreeConfig {
  enabled: boolean;
  baseUrl: string;
  timeout: number;
  maxRetries: number;
}

export class JavFreeSource {
  private httpClient: HttpClient;
  private config: JavFreeConfig;

  constructor(config: JavFreeConfig) {
    this.config = config;
    this.httpClient = defaultHttpClient;
  }

  async getPreviewImages(code: string): Promise<PreviewImage[]> {
    try {
      if (!this.config.enabled) return [];

      const normalizedCode = this.normalizeCode(code);
      const searchUrl = `${this.config.baseUrl}/search/${encodeURIComponent(normalizedCode)}`;

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
    
    const links = doc.querySelectorAll('.entry-title > a, .post-title a, article h2 a');
    for (const link of links) {
      const text = link.textContent?.trim() || '';
      const cleanText = text.replace(/[-_\s]/g, '').toUpperCase();
      if (cleanText.includes(cleanCode)) {
        return link.getAttribute('href');
      }
    }

    const images = doc.querySelectorAll('img');
    for (const img of images) {
      const alt = img.getAttribute('alt') || '';
      const cleanAlt = alt.replace(/[-_\s]/g, '').toUpperCase();
      if (cleanAlt.includes(cleanCode)) {
        const parentLink = img.closest('a');
        if (parentLink) {
          return parentLink.getAttribute('href');
        }
      }
    }

    return null;
  }

  private extractImages(doc: Document): PreviewImage[] {
    const images: PreviewImage[] = [];
    const seenUrls = new Set<string>();

    const imgElements = doc.querySelectorAll('.entry-content img, .post-content img, article img');
    for (const img of imgElements) {
      let src = img.getAttribute('src') || img.getAttribute('data-src') || '';
      if (!src) continue;

      src = src.replace(/^http:/, 'https:');
      
      if (seenUrls.has(src)) continue;
      seenUrls.add(src);

      if (this.isValidImage(src)) {
        images.push({
          url: src,
          source: 'javfree',
        });
      }
    }

    return images;
  }

  private isValidImage(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    if (!imageExtensions.some(ext => lowerUrl.includes(ext))) return false;
    
    const excludePatterns = ['avatar', 'icon', 'logo', 'button', 'banner', 'ads'];
    return !excludePatterns.some(pattern => lowerUrl.includes(pattern));
  }
}

export const DEFAULT_JAVFREE_CONFIG: JavFreeConfig = {
  enabled: true,
  baseUrl: 'https://javfree.me',
  timeout: 15000,
  maxRetries: 2,
};
