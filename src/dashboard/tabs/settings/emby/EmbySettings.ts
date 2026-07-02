import { showMessage } from '../../../ui/toast';
import { STORAGE_KEYS } from '../../../../utils/config';
import { DEFAULT_EMBY_LIBRARY_CONFIG } from '../../../../features/embyLibrary/domain/types';
import type { EmbyLibraryConfig, EmbyServerConfig } from '../../../../features/embyLibrary/domain/types';

function sendMessage(message: any): Promise<any> {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) { resolve(null); return; }
                resolve(response);
            });
        } catch (e) { resolve(null); }
    });
}

async function loadConfig(): Promise<EmbyLibraryConfig> {
    try {
        const result = await new Promise<Record<string, EmbyLibraryConfig>>((resolve) => {
            chrome.storage.local.get([STORAGE_KEYS.EMBY_LIBRARY_CONFIG], (data) => {
                resolve(data as Record<string, EmbyLibraryConfig>);
            });
        });
        if (result[STORAGE_KEYS.EMBY_LIBRARY_CONFIG]) {
            const saved = result[STORAGE_KEYS.EMBY_LIBRARY_CONFIG];
            return {
                server: { ...DEFAULT_EMBY_LIBRARY_CONFIG.server, ...saved.server },
                sync: { ...DEFAULT_EMBY_LIBRARY_CONFIG.sync, ...saved.sync },
                libraryStatus: { ...DEFAULT_EMBY_LIBRARY_CONFIG.libraryStatus, ...saved.libraryStatus },
            };
        }
    } catch (e) { console.error('[EmbySettings] Failed to load config:', e); }
    return { ...DEFAULT_EMBY_LIBRARY_CONFIG };
}

async function saveConfig(config: EmbyLibraryConfig): Promise<void> {
    await new Promise<void>((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.EMBY_LIBRARY_CONFIG]: config }, () => resolve());
    });
    try { await sendMessage({ type: 'EMBY_LIBRARY_UPDATE_CONFIG', config }); } catch {}
}

function setStatus(el: HTMLElement, text: string, type: 'success' | 'error' | 'info' | 'loading' = 'info'): void {
    el.textContent = text; el.style.display = 'block';
    el.classList.remove('status-success', 'status-error', 'status-info', 'status-loading');
    if (type === 'success') el.classList.add('status-success');
    else if (type === 'error') el.classList.add('status-error');
    else if (type === 'loading') el.classList.add('status-loading');
    else el.classList.add('status-info');
}

export async function initEmbySettings(): Promise<void> {
    const pageRoot = document.getElementById('emby-settings');
    if (!pageRoot) { console.log('[EmbySettings] Page root not found, skipping initialization'); return; }
    if (pageRoot.hasAttribute('data-emby-initialized')) return;
    pageRoot.setAttribute('data-emby-initialized', '');

    const config = await loadConfig();

    const enabledCheckbox = document.getElementById('embyEnabled') as HTMLInputElement;
    const configSection = document.getElementById('embyConfigSection') as HTMLElement | null;
    const serverTypeSelect = document.getElementById('embyServerType') as HTMLSelectElement;
    const serverUrlInput = document.getElementById('embyServerUrl') as HTMLInputElement;
    const apiKeyInput = document.getElementById('embyApiKey') as HTMLInputElement;
    const libraryNameInput = document.getElementById('embyLibraryName') as HTMLInputElement;
    const refreshFoldersBtn = document.getElementById('refreshEmbyFolders') as HTMLButtonElement;
    const folderListEl = document.getElementById('embyFolderList') as HTMLElement | null;
    const testConnectionBtn = document.getElementById('testEmbyConnection') as HTMLButtonElement;
    const connectionStatus = document.getElementById('embyConnectionStatus') as HTMLElement | null;

    const realtimeOnJavdbCheckbox = document.getElementById('embyRealtimeOnJavdb') as HTMLInputElement;
    const autoScheduledSyncCheckbox = document.getElementById('embyAutoScheduledSync') as HTMLInputElement;
    const enrichJavdbMetadataCheckbox = document.getElementById('embyEnrichJavdbMetadata') as HTMLInputElement;

    const syncIntervalField = document.getElementById('embySyncIntervalField') as HTMLElement | null;
    const syncIntervalInput = document.getElementById('embySyncInterval') as HTMLInputElement;
    const syncLibraryBtn = document.getElementById('syncEmbyLibrary') as HTMLButtonElement;
    const syncStatus = document.getElementById('embySyncStatus') as HTMLElement | null;
    const lastSyncText = document.getElementById('embyLastSyncText') as HTMLElement | null;

    const showOnListCheckbox = document.getElementById('embyShowOnList') as HTMLInputElement;
    const showOnDetailCheckbox = document.getElementById('embyShowOnDetail') as HTMLInputElement;
    const syncWatchedBtn = document.getElementById('syncEmbyWatched') as HTMLButtonElement;
    const watchedSyncStatus = document.getElementById('embyWatchedSyncStatus') as HTMLElement | null;
    const saveBtn = document.getElementById('saveEmbySettings') as HTMLButtonElement;
    const saveStatus = document.getElementById('embySaveStatus') as HTMLElement | null;

    if (!enabledCheckbox || !serverTypeSelect || !serverUrlInput || !apiKeyInput) return;

    enabledCheckbox.checked = config.server.enabled;
    serverTypeSelect.value = config.server.type;
    serverUrlInput.value = config.server.url || '';
    apiKeyInput.value = config.server.apiKey || '';
    if (libraryNameInput) libraryNameInput.value = config.server.libraryName || '';

    if (configSection) configSection.style.display = enabledCheckbox.checked ? 'block' : 'none';
    enabledCheckbox.addEventListener('change', () => {
        if (configSection) configSection.style.display = enabledCheckbox.checked ? 'block' : 'none';
    });

    if (realtimeOnJavdbCheckbox) realtimeOnJavdbCheckbox.checked = config.sync.realtimeOnJavdb === true;
    if (enrichJavdbMetadataCheckbox) enrichJavdbMetadataCheckbox.checked = config.sync.enrichJavdbMetadata === true;
    if (autoScheduledSyncCheckbox) {
        autoScheduledSyncCheckbox.checked = config.sync.autoScheduledSync === true;
        autoScheduledSyncCheckbox.addEventListener('change', () => {
            if (syncIntervalField) syncIntervalField.style.display = autoScheduledSyncCheckbox.checked ? 'block' : 'none';
        });
    }

    if (syncIntervalField) syncIntervalField.style.display = autoScheduledSyncCheckbox?.checked ? 'block' : 'none';
    if (syncIntervalInput && config.sync.scheduledIntervalMinutes) syncIntervalInput.value = String(config.sync.scheduledIntervalMinutes);

    if (showOnListCheckbox) showOnListCheckbox.checked = config.libraryStatus.showOnList !== false;
    if (showOnDetailCheckbox) showOnDetailCheckbox.checked = config.libraryStatus.showOnDetail !== false;

    if (lastSyncText) {
        if (config.sync.lastSyncTime) lastSyncText.textContent = '上次同步: ' + new Date(config.sync.lastSyncTime).toLocaleString();
        else lastSyncText.textContent = '尚未同步。请配置服务器并点击"立即同步"。';
    }

    if (testConnectionBtn) {
        testConnectionBtn.addEventListener('click', async () => {
            if (!connectionStatus) return;
            setStatus(connectionStatus, '正在测试连接...', 'loading');
            try {
                const result = await sendMessage({ type: 'EMBY_LIBRARY_TEST_CONNECTION', config: { type: serverTypeSelect.value as 'emby' | 'jellyfin', url: serverUrlInput.value.trim(), apiKey: apiKeyInput.value.trim(), enabled: true } });
                if (result?.success) setStatus(connectionStatus, '✓ ' + (result.serverName || '连接成功'), 'success');
                else setStatus(connectionStatus, '✗ ' + (result?.message || '连接失败'), 'error');
            } catch (e) { setStatus(connectionStatus, '✗ ' + (e as Error).message, 'error'); }
        });
    }

    if (refreshFoldersBtn) {
        refreshFoldersBtn.addEventListener('click', async () => {
            if (!folderListEl) return;
            setStatus(folderListEl, '正在获取库列表...', 'loading');
            try {
                const result = await sendMessage({ type: 'EMBY_LIBRARY_LIST_FOLDERS' });
                if (result?.success && result.folders?.length > 0) {
                    setStatus(folderListEl, '媒体库: ' + result.folders.map((f: any) => f.name).join('、') + ' (' + result.folders.length + ' 个)', 'info');
                } else setStatus(folderListEl, '未找到: ' + (result?.error || ''), 'error');
            } catch (e) { setStatus(folderListEl, '✗ ' + (e as Error).message, 'error'); }
        });
    }

    if (syncLibraryBtn) {
        // 进度条元素
        const enrichProgress = document.getElementById('embyEnrichProgress') as HTMLElement | null;
        const enrichFill = document.getElementById('embyEnrichFill') as HTMLElement | null;
        const enrichPercent = document.getElementById('embyEnrichPercent') as HTMLElement | null;
        const enrichText = document.getElementById('embyEnrichText') as HTMLElement | null;

        // 控制按钮
        const pauseBtn = document.getElementById('embyEnrichPause') as HTMLButtonElement | null;
        const resumeBtn = document.getElementById('embyEnrichResume') as HTMLButtonElement | null;
        const stopBtn = document.getElementById('embyEnrichStop') as HTMLButtonElement | null;

        let enrichListener: ((msg: any) => void) | null = null;
        let enrichRunning = false;

        function showControlButtons(show: boolean) {
            if (pauseBtn) pauseBtn.style.display = show ? 'inline-flex' : 'none';
            if (resumeBtn) resumeBtn.style.display = 'none'; // start hidden
            if (stopBtn) stopBtn.style.display = show ? 'inline-flex' : 'none';
            syncLibraryBtn.style.display = show ? 'none' : 'inline-flex';
        }

        function updateProgressUI(p: any) {
            const pct = p.total > 0 ? Math.round((p.current / p.total) * 100) : 0;
            if (enrichFill) enrichFill.style.width = pct + '%';
            if (enrichPercent) enrichPercent.textContent = pct + '%';
            if (enrichText) {
                const stageText = p.stage === 'searching' ? '🔍 搜索中' : p.stage === 'browsing' ? '👀 浏览中' : '✅';
                const extra = p.title === '已停止' ? ' ⏹ 已停止' : '';
                enrichText.textContent = `${stageText} ${p.current}/${p.total} ${p.code || ''}${extra}`;
            }
        }

        // 暂停
        pauseBtn?.addEventListener('click', async () => {
            await sendMessage({ type: 'EMBY_ENRICH_PAUSE' });
            if (pauseBtn) pauseBtn.style.display = 'none';
            if (resumeBtn) resumeBtn.style.display = 'inline-flex';
            if (enrichText) enrichText.textContent += ' ⏸ 已暂停';
        });

        // 恢复
        resumeBtn?.addEventListener('click', async () => {
            await sendMessage({ type: 'EMBY_ENRICH_RESUME' });
            if (pauseBtn) pauseBtn.style.display = 'inline-flex';
            if (resumeBtn) resumeBtn.style.display = 'none';
        });

        // 停止
        stopBtn?.addEventListener('click', async () => {
            await sendMessage({ type: 'EMBY_ENRICH_STOP' });
            showControlButtons(false);
            enrichRunning = false;
        });

        syncLibraryBtn.addEventListener('click', async () => {
            if (!syncStatus) return;
            if (!enabledCheckbox.checked) { setStatus(syncStatus, '请先启用Emby联动', 'error'); return; }
            if (!serverUrlInput.value.trim() || !apiKeyInput.value.trim()) { setStatus(syncStatus, '请先填写服务器信息', 'error'); return; }
            setStatus(syncStatus, '正在同步番号索引...', 'loading');

            // 显示进度条和控制按钮
            if (enrichProgress) enrichProgress.style.display = 'block';
            if (enrichFill) enrichFill.style.width = '0%';
            if (enrichPercent) enrichPercent.textContent = '0%';
            if (enrichText) enrichText.textContent = '准备中...';
            showControlButtons(true);
            enrichRunning = true;

            // 监听抓取进度
            enrichListener = (msg: any) => {
                if (msg?.type !== 'EMBY_LIBRARY_ENRICH_PROGRESS') return;
                const p = msg?.progress;
                if (!p) return;
                updateProgressUI(p);
                if (!enrichRunning) {
                    // 停止时更新 UI
                    updateProgressUI(p);
                }
            };
            chrome.runtime.onMessage.addListener(enrichListener);

            try {
                const cur = config.sync;
                await sendMessage({ type: 'EMBY_LIBRARY_UPDATE_CONFIG', config: { ...config, sync: { ...cur, enrichJavdbMetadata: enrichJavdbMetadataCheckbox?.checked ?? false } } });
                const result = await sendMessage({ type: 'EMBY_LIBRARY_SYNC' });
                // 完成
                if (enrichText) enrichText.textContent = '完成！';
                if (result?.success) {
                    const count = result.index?.totalCount ?? result.count ?? 0;
                    const fetched = result.totalFetched ?? 0;
                    setStatus(syncStatus, '✓ 同步成功，共 ' + fetched + ' 条，提取番号 ' + count + ' 条', 'success');
                    if (lastSyncText) lastSyncText.textContent = '上次同步: ' + new Date().toLocaleString();
                } else setStatus(syncStatus, '✗ ' + (result?.error || '失败'), 'error');
            } catch (e) { setStatus(syncStatus, '✗ ' + (e as Error).message, 'error'); }
            finally {
                enrichRunning = false;
                // 延迟隐藏进度条和按钮
                setTimeout(() => {
                    if (enrichProgress) enrichProgress.style.display = 'none';
                    showControlButtons(false);
                }, 3000);
                if (enrichListener) {
                    chrome.runtime.onMessage.removeListener(enrichListener);
                    enrichListener = null;
                }
            }
        });
    }

    if (syncWatchedBtn && watchedSyncStatus) {
        syncWatchedBtn.addEventListener('click', async () => {
            setStatus(watchedSyncStatus, '正在同步已观看记录...', 'loading');
            try {
                const result = await sendMessage({ type: 'EMBY_LIBRARY_SYNC_WATCHED' });
                if (result?.success) setStatus(watchedSyncStatus, '✓ 同步成功，累计 ' + result.totalWatched + ' 部', 'success');
                else setStatus(watchedSyncStatus, '✗ ' + (result?.error || '失败'), 'error');
            } catch (e) { setStatus(watchedSyncStatus, '✗ ' + (e as Error).message, 'error'); }
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const newConfig: EmbyLibraryConfig = {
                server: { type: serverTypeSelect.value as 'emby' | 'jellyfin', url: serverUrlInput.value.trim(), apiKey: apiKeyInput.value.trim(), enabled: enabledCheckbox.checked, libraryName: libraryNameInput.value.trim() },
                sync: { mode: 'manual', scheduledIntervalMinutes: parseInt(syncIntervalInput?.value || '1440', 10), lastSyncTime: config.sync.lastSyncTime, realtimeOnJavdb: realtimeOnJavdbCheckbox?.checked ?? false, autoScheduledSync: autoScheduledSyncCheckbox?.checked ?? false, enrichJavdbMetadata: enrichJavdbMetadataCheckbox?.checked ?? false },
                libraryStatus: { enabled: enabledCheckbox.checked, showOnList: showOnListCheckbox?.checked ?? true, showOnDetail: showOnDetailCheckbox?.checked ?? true },
            };
            try {
                await saveConfig(newConfig);
                if (saveStatus) { setStatus(saveStatus, '✓ 已保存', 'success'); setTimeout(() => { if (saveStatus) saveStatus.style.display = 'none'; }, 3000); }
                showMessage('Emby 联动设置已保存', 'success');
            } catch (e) { showMessage((e as Error).message, 'error'); }
        });
    }

    console.log('[EmbySettings] Emby 联动设置初始化完成');
}