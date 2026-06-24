import { JavFreeSource, DEFAULT_JAVFREE_CONFIG, type PreviewImage } from './sources/javFreeSource';
import { JavStoreSource, DEFAULT_JAVSTORE_CONFIG } from './sources/javStoreSource';
import { BlogJavSource, DEFAULT_BLOGJAV_CONFIG } from '../dataAggregator/sources/blogJav';

export type PreviewSourceName = 'javfree' | 'javstore' | 'blogjav';

export interface ExternalPreviewConfig {
  enabled: boolean;
  sources: PreviewSourceName[];
  javfree: typeof DEFAULT_JAVFREE_CONFIG;
  javstore: typeof DEFAULT_JAVSTORE_CONFIG;
  blogjav: typeof DEFAULT_BLOGJAV_CONFIG;
  cacheTTL: number;
}

export interface FetchPreviewResult {
  success: boolean;
  images: PreviewImage[];
  sources: string[];
  error?: string;
}

const PREVIEW_CACHE_KEY = 'external_preview_cache';
const DEFAULT_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

class ExternalPreviewService {
  private config: ExternalPreviewConfig;
  private cache: Map<string, { images: PreviewImage[]; timestamp: number }> = new Map();

  constructor(config?: Partial<ExternalPreviewConfig>) {
    this.config = {
      enabled: true,
      sources: ['javfree', 'javstore', 'blogjav'],
      javfree: DEFAULT_JAVFREE_CONFIG,
      javstore: DEFAULT_JAVSTORE_CONFIG,
      blogjav: DEFAULT_BLOGJAV_CONFIG,
      cacheTTL: DEFAULT_CACHE_TTL,
      ...config,
    };
    this.loadCache();
  }

  updateConfig(config: Partial<ExternalPreviewConfig>): void {
    this.config = { ...this.config, ...config };
  }

  async fetchPreviews(code: string, force = false): Promise<FetchPreviewResult> {
    if (!this.config.enabled) {
      return { success: false, images: [], sources: [], error: 'disabled' };
    }

    const normalizedCode = code.toUpperCase().trim();
    const cached = this.getFromCache(normalizedCode);
    
    if (!force && cached && cached.length > 0) {
      return { success: true, images: cached, sources: [...new Set(cached.map(i => i.source))] };
    }

    const allImages: PreviewImage[] = [];
    const fetchedSources: string[] = [];

    const fetchPromises = this.config.sources.map(source => 
      this.fetchFromSource(source, normalizedCode)
        .then(images => {
          if (images.length > 0) {
            fetchedSources.push(source);
            allImages.push(...images);
          }
        })
        .catch(() => {})
    );

    await Promise.allSettled(fetchPromises);

    const uniqueImages = this.deduplicateImages(allImages);

    if (uniqueImages.length > 0) {
      this.saveToCache(normalizedCode, uniqueImages);
    }

    return {
      success: uniqueImages.length > 0,
      images: uniqueImages,
      sources: fetchedSources,
      error: uniqueImages.length === 0 ? 'no images found' : undefined,
    };
  }

  private async fetchFromSource(source: PreviewSourceName, code: string): Promise<PreviewImage[]> {
    try {
      switch (source) {
        case 'javfree': {
          const javfree = new JavFreeSource(this.config.javfree);
          return await javfree.getPreviewImages(code);
        }
        case 'javstore': {
          const javstore = new JavStoreSource(this.config.javstore);
          return await javstore.getPreviewImages(code);
        }
        case 'blogjav': {
          const blogjav = new BlogJavSource(this.config.blogjav);
          const result = await blogjav.getCoverImage(code);
          if (result.success && result.data) {
            return result.data.map(img => ({
              url: img.url,
              source: 'blogjav',
            }));
          }
          return [];
        }
        default:
          return [];
      }
    } catch {
      return [];
    }
  }

  private deduplicateImages(images: PreviewImage[]): PreviewImage[] {
    const seen = new Set<string>();
    const result: PreviewImage[] = [];

    for (const img of images) {
      const key = this.getImageKey(img.url);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(img);
      }
    }

    return result;
  }

  private getImageKey(url: string): string {
    try {
      const cleanUrl = url.replace(/^https?:\/\//, '').replace(/\?.*$/, '');
      return cleanUrl.toLowerCase();
    } catch {
      return url;
    }
  }

  private getFromCache(code: string): PreviewImage[] | null {
    const entry = this.cache.get(code);
    if (!entry) return null;
    
    const now = Date.now();
    if (now - entry.timestamp > this.config.cacheTTL) {
      this.cache.delete(code);
      return null;
    }
    
    return entry.images;
  }

  private saveToCache(code: string, images: PreviewImage[]): void {
    this.cache.set(code, {
      images,
      timestamp: Date.now(),
    });
    this.saveCache();
  }

  private loadCache(): void {
    try {
      const raw = localStorage.getItem(PREVIEW_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const now = Date.now();
        for (const [code, entry] of Object.entries(parsed) as [string, { images: PreviewImage[]; timestamp: number }][]) {
          if (now - entry.timestamp <= this.config.cacheTTL) {
            this.cache.set(code, entry);
          }
        }
      }
    } catch {
    }
  }

  private saveCache(): void {
    try {
      const maxEntries = 200;
      if (this.cache.size > maxEntries) {
        const entries = Array.from(this.cache.entries())
          .sort((a, b) => b[1].timestamp - a[1].timestamp)
          .slice(0, maxEntries);
        this.cache = new Map(entries);
      }
      
      const obj = Object.fromEntries(this.cache);
      localStorage.setItem(PREVIEW_CACHE_KEY, JSON.stringify(obj));
    } catch {
    }
  }

  clearCache(): void {
    this.cache.clear();
    try {
      localStorage.removeItem(PREVIEW_CACHE_KEY);
    } catch {
    }
  }
}

export const externalPreviewService = new ExternalPreviewService();
