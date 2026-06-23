import type { EmbyLibraryConfig, LibraryIndex } from '../domain/types';

function sendMessage(message: any): Promise<any> {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage(message, (response) => {
                resolve(response);
            });
        } catch (e) {
            resolve(null);
        }
    });
}

export async function getEmbyConfig(): Promise<EmbyLibraryConfig | null> {
    try {
        const response = await sendMessage({ type: 'EMBY_LIBRARY_GET_CONFIG' });
        return response?.config || response || null;
    } catch (e) {
        return null;
    }
}

export async function getLibraryIndex(): Promise<LibraryIndex | null> {
    try {
        const response = await sendMessage({ type: 'EMBY_LIBRARY_GET_INDEX' });
        if (response?.index) return response.index;
        return response || null;
    } catch (e) {
        return null;
    }
}

export async function checkCodeInLibrary(videoId: string): Promise<boolean> {
    try {
        const response = await sendMessage({ type: 'EMBY_LIBRARY_CHECK_CODE', videoId });
        return response?.matched || false;
    } catch (e) {
        return false;
    }
}

export async function triggerSync(): Promise<{ success: boolean; error?: string }> {
    try {
        const response = await sendMessage({ type: 'EMBY_LIBRARY_SYNC' });
        return response || { success: false, error: '同步失败' };
    } catch (e) {
        return { success: false, error: '同步失败' };
    }
}

export async function testServerConnection(config: any): Promise<{ success: boolean; message: string; serverName?: string }> {
    try {
        const response = await sendMessage({ type: 'EMBY_LIBRARY_TEST_CONNECTION', config });
        return response || { success: false, message: '测试连接失败' };
    } catch (e) {
        return { success: false, message: '测试连接失败' };
    }
}

export async function updateEmbyConfig(config: EmbyLibraryConfig): Promise<void> {
    await sendMessage({ type: 'EMBY_LIBRARY_UPDATE_CONFIG', config });
}

export async function getWatchedData(): Promise<{ codes: string[]; lastSyncTime: number } | null> {
    try {
        const response = await sendMessage({ type: 'EMBY_WATCHED_GET' });
        if (response?.data) return response.data;
        return response || null;
    } catch (e) {
        return null;
    }
}

export async function checkCodeWatched(videoId: string): Promise<boolean> {
    try {
        const response = await sendMessage({ type: 'EMBY_WATCHED_CHECK', videoId });
        return response?.matched || false;
    } catch (e) {
        return false;
    }
}
