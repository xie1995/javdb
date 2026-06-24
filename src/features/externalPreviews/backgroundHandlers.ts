type SendResponse = (response: any) => void;

export async function handleFetchHtml(message: any, sendResponse: SendResponse): Promise<void> {
  try {
    const { url } = message;
    if (!url) {
      sendResponse({ success: false, html: '', error: 'No URL provided' });
      return;
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });

    if (!res.ok) {
      sendResponse({ success: false, html: '', error: `HTTP ${res.status}` });
      return;
    }

    const html = await res.text();
    sendResponse({ success: true, html });
  } catch (error: any) {
    console.error('[Background] Failed to fetch HTML:', error);
    sendResponse({ success: false, html: '', error: error.message });
  }
}

export async function handleFetchImage(message: any, sendResponse: SendResponse): Promise<void> {
  try {
    const { url } = message;
    console.log('[Background] Fetching image:', url);
    if (!url) {
      sendResponse({ success: false, dataUrl: '', error: 'No URL provided' });
      return;
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      referrer: '',
    });

    console.log('[Background] Image fetch status:', res.status);
    if (!res.ok) {
      sendResponse({ success: false, dataUrl: '', error: `HTTP ${res.status}` });
      return;
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const dataUrl = `data:${contentType};base64,${base64}`;
    
    console.log('[Background] Image converted, size:', dataUrl.length);
    sendResponse({ success: true, dataUrl });
  } catch (error: any) {
    console.error('[Background] Failed to fetch image:', error);
    sendResponse({ success: false, dataUrl: '', error: error.message });
  }
}
