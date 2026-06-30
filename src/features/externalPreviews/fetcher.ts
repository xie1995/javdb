export interface PreviewImage {
  url: string;
  source: string;
}

const CACHE_PREFIX = 'jdb_ext_preview_';
const CACHE_TTL = 14 * 24 * 60 * 60 * 1000;
const DEBUG = true;

function debugLog(...args: any[]): void {
  if (DEBUG) {
    console.log('[ExternalPreview]', ...args);
  }
}

async function fetchHtml(url: string): Promise<string> {
  debugLog('Fetching:', url);
  const response = await chrome.runtime.sendMessage({
    type: 'FETCH_EXTERNAL_PREVIEWS_HTML',
    url,
  });
  if (response?.success && response?.html) {
    debugLog('Fetched OK, length:', response.html.length);
    return response.html;
  }
  debugLog('Fetch error:', response?.error);
  throw new Error(response?.error || 'Failed to fetch HTML');
}

// 通过后台代理获取图片，绕过防盗链
export async function fetchImageProxy(url: string): Promise<string> {
  debugLog('Fetching image via proxy:', url);
  const response = await chrome.runtime.sendMessage({
    type: 'FETCH_EXTERNAL_PREVIEWS_IMAGE',
    url,
  });
  if (response?.success && response?.dataUrl) {
    debugLog('Image fetched OK via proxy');
    return response.dataUrl;
  }
  debugLog('Image fetch error:', response?.error);
  throw new Error(response?.error || 'Failed to fetch image');
}

function normalizeCode(raw: string): string {
  if (!raw) return '';
  return raw.trim().toUpperCase().replace(/\s+/g, '-');
}

function normalizeCodeStrict(s: string): string {
  if (!s) return '';
  return String(s).trim().toUpperCase().replace(/[\s\-_]/g, '');
}

/** 安全地解析相对 URL */
function getSafeUrl(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function smartExtractLink(doc: Document, code: string, baseUrl: string): string | null {
  if (!code || !doc) return null;
  const cleanTarget = normalizeCodeStrict(code);
  const reStr = `(?<![:/@])\\b(?:[A-Za-z]{1,10}(?:[-_][A-Za-z]{1,5})?[-_]?\\d{3,8}|\\d{6}[-_]\\d{3})(?:[-_]\\d{1,4})?[A-Za-z]?\\b`;
  const globalRe = new RegExp(reStr, 'gi');

  const fastMatch = (text: string): boolean => {
    if (!text) return false;
    globalRe.lastIndex = 0;
    const matches = text.match(globalRe);
    if (!matches) return false;
    for (let i = 0; i < matches.length; i++) {
      if (normalizeCodeStrict(matches[i]) === cleanTarget) {
        return true;
      }
    }
    return false;
  };

  const anchors = doc.querySelectorAll('a');
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const href = a.getAttribute('href');
    if (!href || href.startsWith('javascript:') || href.match(/search|\?q=|&q=|\?s=|&s=|tag=|category=|actor=|maker=|page=/i)) {
      continue;
    }
    if (fastMatch(a.textContent || '')) return getSafeUrl(href, baseUrl);
    if (fastMatch(a.getAttribute('title') || '')) return getSafeUrl(href, baseUrl);
    const img = a.querySelector('img');
    if (img && fastMatch(img.getAttribute('alt') || '')) return getSafeUrl(href, baseUrl);
  }
  return null;
}

// 从缓存读取
function getFromCache(code: string): PreviewImage | null {
  try {
    const cached = localStorage.getItem(CACHE_PREFIX + code);
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    if (Date.now() - parsed.timestamp > CACHE_TTL) return null;
    return { url: parsed.img, source: parsed.source };
  } catch {
    return null;
  }
}

// 写入缓存
function saveToCache(code: string, img: string, source: string): void {
  try {
    localStorage.setItem(CACHE_PREFIX + code, JSON.stringify({
      img,
      source,
      timestamp: Date.now(),
    }));
  } catch {}
}

// JavFree 获取单张预览图（完全按照原脚本逻辑）
async function fetchFromJavFree(code: string): Promise<string | null> {
  debugLog('[JavFree] Start fetch:', code);
  try {
    const searchUrl = `https://javfree.me/search/${encodeURIComponent(code)}`;
    const searchHtml = await fetchHtml(searchUrl);

    const parser = new DOMParser();
    const searchDoc = parser.parseFromString(searchHtml, 'text/html');
    const link = searchDoc.querySelector('.entry-title > a')?.getAttribute('href');
    debugLog('[JavFree] Article link:', link);
    if (!link) return null;

    const articleUrl = link.startsWith('/') ? 'https://javfree.me' + link : link;
    const articleHtml = await fetchHtml(articleUrl);
    const articleDoc = parser.parseFromString(articleHtml, 'text/html');

    // 原脚本：取 p>img 的第2张或第1张
    const imgNode = articleDoc.querySelectorAll('p>img')[1] || articleDoc.querySelectorAll('p>img')[0];
    let src = imgNode?.getAttribute('src')?.replace(/^http:/, 'https:') || null;
    
    if (src) {
      debugLog('[JavFree] Got image:', src);
      return src;
    }
    return null;
  } catch (e) {
    debugLog('[JavFree] Error:', e);
    return null;
  }
}

// JavStore 获取单张预览图
async function fetchFromJavStore(code: string): Promise<string | null> {
  debugLog('[JavStore] Start fetch:', code);
  try {
    const searchUrl = `https://javstore.net/search?q=${encodeURIComponent(code)}`;
    const searchHtml = await fetchHtml(searchUrl);

    const parser = new DOMParser();
    const searchDoc = parser.parseFromString(searchHtml, 'text/html');

    const normInput = normalizeCodeStrict(code);
    const candidates = Array.from(searchDoc.querySelectorAll('div.grid > a, a.group, article h2 a'));

    let link: string | null = null;
    for (const a of candidates) {
      const h3Text = (a as Element).querySelector('h3')?.textContent || a.textContent || (a as Element).querySelector('img')?.alt || '';
      const normH3 = normalizeCodeStrict(h3Text);
      if (!normH3) continue;
      if (normH3.includes(normInput)) {
        link = (a as HTMLAnchorElement).getAttribute('href');
        break;
      }
    }

    if (!link) {
      link = smartExtractLink(searchDoc, code, 'https://javstore.net');
    }
    debugLog('[JavStore] Article link:', link);
    if (!link) return null;

    const articleUrl = link.startsWith('/') ? 'https://javstore.net' + link : link;
    const articleHtml = await fetchHtml(articleUrl);
    const articleDoc = parser.parseFromString(articleHtml, 'text/html');

    // 原脚本：.prose a[href*='_s.jpg'] 或 a[href*='.jpg'] 排除 p[ls].jpg，使用 .href 获取完整 URL
    const _sLink = articleDoc.querySelector(".prose a[href*='_s.jpg'], .entry-content a[href*='_s.jpg']") as HTMLAnchorElement | null;
    let url = _sLink?.href || '';
    
    if (!url) {
      const allLinks = articleDoc.querySelectorAll<HTMLAnchorElement>("a[href*='.jpg']");
      for (const a of allLinks) {
        if (!/p[ls]\.jpg/i.test(a.href || '')) {
          url = a.href || '';
          break;
        }
      }
    }
    
    if (url) {
      url = url.replace(/^http:/, 'https:');
      debugLog('[JavStore] Got image:', url);
      return url;
    }
    return null;
  } catch (e) {
    debugLog('[JavStore] Error:', e);
    return null;
  }
}

// BlogJav 获取单张预览图（完全按照原脚本逻辑）
async function fetchFromBlogJav(code: string): Promise<string | null> {
  debugLog('[BlogJav] Start fetch:', code);
  try {
    // 原脚本使用 ?s= 参数（不是 ?q=）
    const searchUrl = `https://blogjav.net/?s=${encodeURIComponent(code)}`;
    const searchHtml = await fetchHtml(searchUrl);

    const parser = new DOMParser();
    const searchDoc = parser.parseFromString(searchHtml, 'text/html');
    
    // 原脚本：找包含 "View More Info" 的 article，取 .entry-title a
    const fallbackUrl = Array.from(searchDoc.querySelectorAll('article'))
      .find(a => a.textContent.includes('View More Info'))
      ?.querySelector('.entry-title a');
    const articleLink = (fallbackUrl as HTMLAnchorElement | null)?.href || null;
    
    debugLog('[BlogJav] Article link:', articleLink);
    if (!articleLink) return null;

    const articleHtml = await fetchHtml(articleLink);
    const articleDoc = parser.parseFromString(articleHtml, 'text/html');

    // 原脚本：找 .entry-content img 中 width>0 && width<height 的
    const imgs = articleDoc.querySelectorAll('.entry-content img');
    let imgSrc = null;
    for (const img of imgs) {
      const w = parseInt(img.getAttribute('width') || '0');
      const h = parseInt(img.getAttribute('height') || '0');
      if (w > 0 && w < h) {
        imgSrc = img.getAttribute('src') || '';
        break;
      }
    }
    
    if (!imgSrc) {
      const fallbackImg = imgs[0];
      imgSrc = fallbackImg?.getAttribute('src') || '';
    }
    
    if (imgSrc) {
      // 原脚本：转换 pixhost 缩略图 URL 到全尺寸
      imgSrc = imgSrc.replace(/^http:/, 'https:');
      const converted = imgSrc.replace(/t(\d+)\.pixhost\.to\/thumbs/, 'img$1.pixhost.to/images');
      debugLog('[BlogJav] Got image:', converted);
      return converted;
    }
    return null;
  } catch (e) {
    debugLog('[BlogJav] Error:', e);
    return null;
  }
}

// 主函数：获取单张预览图
export async function fetchExternalPreviewImage(code: string, force = false): Promise<PreviewImage | null> {
  const normalizedCode = normalizeCode(code);
  debugLog('fetchExternalPreviewImage START, code:', normalizedCode, 'force:', force);

  if (!force) {
    const cached = getFromCache(normalizedCode);
    if (cached) {
      debugLog('Cache hit:', cached.url);
      return cached;
    }
  }

  // 按顺序尝试：javfree → javstore → blogjav
  let img = await fetchFromJavFree(normalizedCode);
  debugLog('JavFree result:', img);
  if (img) {
    saveToCache(normalizedCode, img, 'javfree');
    return { url: img, source: 'javfree' };
  }

  img = await fetchFromJavStore(normalizedCode);
  debugLog('JavStore result:', img);
  if (img) {
    saveToCache(normalizedCode, img, 'javstore');
    return { url: img, source: 'javstore' };
  }

  img = await fetchFromBlogJav(normalizedCode);
  debugLog('BlogJav result:', img);
  if (img) {
    saveToCache(normalizedCode, img, 'blogjav');
    return { url: img, source: 'blogjav' };
  }

  debugLog('All sources failed');
  return null;
}

// 获取所有预览图（详情页用）
export async function fetchAllPreviewImages(code: string): Promise<PreviewImage[]> {
  const normalizedCode = normalizeCode(code);
  const cacheKey = CACHE_PREFIX + normalizedCode + '_all';

  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.urls && Date.now() - parsed.timestamp < CACHE_TTL) {
        return parsed.urls.map((url: string) => ({ url, source: parsed.source || 'cached' }));
      }
    }
  } catch {}

  const allImages = await fetchAllImages(normalizedCode);

  if (allImages.length > 0) {
    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        urls: allImages,
        source: 'javfree',
        timestamp: Date.now(),
      }));
    } catch {}
    return allImages.map(url => ({ url, source: 'javfree' }));
  }

  return [];
}

// 获取多张图片
async function fetchAllImages(code: string): Promise<string[]> {
  const images: string[] = [];
  const seen = new Set<string>();

  try {
    const imgs = await fetchImagesFromJavFree(code);
    imgs.forEach(img => {
      if (!seen.has(img)) {
        seen.add(img);
        images.push(img);
      }
    });
  } catch {}

  if (images.length === 0) {
    try {
      const imgs = await fetchImagesFromJavStore(code);
      imgs.forEach(img => {
        if (!seen.has(img)) {
          seen.add(img);
          images.push(img);
        }
      });
    } catch {}
  }

  if (images.length === 0) {
    try {
      const imgs = await fetchImagesFromBlogJav(code);
      imgs.forEach(img => {
        if (!seen.has(img)) {
          seen.add(img);
          images.push(img);
        }
      });
    } catch {}
  }

  return images;
}

// JavFree 获取多张预览图
async function fetchImagesFromJavFree(code: string): Promise<string[]> {
  debugLog('[JavFree] Fetching multiple images:', code);
  try {
    const searchUrl = `https://javfree.me/search/${encodeURIComponent(code)}`;
    const searchHtml = await fetchHtml(searchUrl);

    const parser = new DOMParser();
    const searchDoc = parser.parseFromString(searchHtml, 'text/html');
    const link = searchDoc.querySelector('.entry-title > a')?.getAttribute('href');
    if (!link) return [];

    const articleUrl = link.startsWith('/') ? 'https://javfree.me' + link : link;
    const articleHtml = await fetchHtml(articleUrl);
    const articleDoc = parser.parseFromString(articleHtml, 'text/html');

    const imgs = articleDoc.querySelectorAll('p > img, .entry-content img, article img');
    const results: string[] = [];
    for (const img of imgs) {
      let src = img.getAttribute('src') || '';
      if (!src) continue;
      const lowerSrc = src.toLowerCase();
      if (lowerSrc.includes('avatar') || lowerSrc.includes('icon') || lowerSrc.includes('logo')) continue;
      src = src.replace(/^http:/, 'https:');
      if (!results.includes(src)) {
        results.push(src);
      }
    }
    debugLog('[JavFree] Found images:', results.length);
    return results;
  } catch (e) {
    debugLog('[JavFree] Error:', e);
    return [];
  }
}

// JavStore 获取多张预览图
async function fetchImagesFromJavStore(code: string): Promise<string[]> {
  debugLog('[JavStore] Fetching multiple images:', code);
  try {
    const searchUrl = `https://javstore.net/search?q=${encodeURIComponent(code)}`;
    const searchHtml = await fetchHtml(searchUrl);

    const parser = new DOMParser();
    const searchDoc = parser.parseFromString(searchHtml, 'text/html');

    const normInput = normalizeCodeStrict(code);
    const candidates = Array.from(searchDoc.querySelectorAll('div.grid > a, a.group, article h2 a'));

    let link: string | null = null;
    for (const a of candidates) {
      const h3Text = (a as Element).querySelector('h3')?.textContent || a.textContent || (a as Element).querySelector('img')?.alt || '';
      const normH3 = normalizeCodeStrict(h3Text);
      if (!normH3) continue;
      if (normH3.includes(normInput)) {
        link = (a as HTMLAnchorElement).getAttribute('href');
        break;
      }
    }

    if (!link) {
      link = smartExtractLink(searchDoc, code, 'https://javstore.net');
    }
    if (!link) return [];

    const articleUrl = link.startsWith('/') ? 'https://javstore.net' + link : link;
    const articleHtml = await fetchHtml(articleUrl);
    const articleDoc = parser.parseFromString(articleHtml, 'text/html');

    const results: string[] = [];
    
    // 从 a 标签获取大图链接
    const links = articleDoc.querySelectorAll('a[href*=".jpg"], a[href*=".png"], a[href*=".webp"]');
    for (const a of links) {
      let href = (a as HTMLAnchorElement).getAttribute('href') || '';
      if (!href) continue;
      const lowerHref = href.toLowerCase();
      if (lowerHref.includes('avatar') || lowerHref.includes('icon') || lowerHref.includes('logo')) continue;
      if (lowerHref.includes('/thumbs/') || /_[pls]\.(jpg|png|webp)/i.test(href)) continue;
      href = getSafeUrl(href, articleUrl).replace(/^http:/, 'https:');
      if (!results.includes(href)) {
        results.push(href);
      }
    }

    // 从 img 标签获取
    const imgs = articleDoc.querySelectorAll('.prose img, .entry-content img, article img');
    for (const img of imgs) {
      let src = img.getAttribute('src') || '';
      if (!src) continue;
      const lowerSrc = src.toLowerCase();
      if (lowerSrc.includes('avatar') || lowerSrc.includes('icon') || lowerSrc.includes('logo')) continue;
      src = getSafeUrl(src, articleUrl).replace(/^http:/, 'https:');
      if (!results.includes(src)) {
        results.push(src);
      }
    }

    debugLog('[JavStore] Found images:', results.length);
    return results;
  } catch (e) {
    debugLog('[JavStore] Error:', e);
    return [];
  }
}

// BlogJav 获取多张预览图
async function fetchImagesFromBlogJav(code: string): Promise<string[]> {
  debugLog('[BlogJav] Fetching multiple images:', code);
  try {
    const searchUrl = `https://blogjav.net/search?q=${encodeURIComponent(code)}`;
    const searchHtml = await fetchHtml(searchUrl);

    const parser = new DOMParser();
    const searchDoc = parser.parseFromString(searchHtml, 'text/html');
    const link = smartExtractLink(searchDoc, code, 'https://blogjav.net');
    if (!link) return [];

    const articleHtml = await fetchHtml(link);
    const articleDoc = parser.parseFromString(articleHtml, 'text/html');

    const results: string[] = [];
    const imgs = articleDoc.querySelectorAll('.entry-content img, .post-content img, article img');
    for (const img of imgs) {
      let src = img.getAttribute('src') || '';
      if (!src) continue;
      const lowerSrc = src.toLowerCase();
      if (lowerSrc.includes('avatar') || lowerSrc.includes('icon') || lowerSrc.includes('logo')) continue;
      src = getSafeUrl(src, link).replace(/^http:/, 'https:');
      if (!results.includes(src)) {
        results.push(src);
      }
    }

    debugLog('[BlogJav] Found images:', results.length);
    return results;
  } catch (e) {
    debugLog('[BlogJav] Error:', e);
    return [];
  }
}
