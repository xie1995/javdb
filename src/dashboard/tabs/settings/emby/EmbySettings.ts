import { showMessage } from '../../../ui/toast';
import { STORAGE_KEYS } from '../../../../utils/config';
import { DEFAULT_EMBY_LIBRARY_CONFIG } from '../../../../features/embyLibrary/domain/types';
import type { EmbyLibraryConfig, EmbyServerConfig } from '../../../../features/embyLibrary/domain/types';

function sendMessage(message: any): Promise<any> {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn('[EmbySettings] Background response error:', chrome.runtime.lastError);
                    resolve(null);
                } else {
                    resolve(response);
                }
            });
        } catch (e) {
            console.warn('[EmbySettings] Failed to send message:', e);
            resolve(null);
        }
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
                libraryStatus: {
                    ...DEFAULT_EMBY_LIBRARY_CONFIG.libraryStatus,
                    ...saved.libraryStatus,
                },
            };
        }
    } catch (e) {
        console.error('[EmbySettings] Failed to load config:', e);
    }
    return { ...DEFAULT_EMBY_LIBRARY_CONFIG };
}

async function saveConfig(config: EmbyLibraryConfig): Promise<void> {
    await new Promise<void>((resolve) => {
        chrome.storage.local.set({
            [STORAGE_KEYS.EMBY_LIBRARY_CONFIG]: config,
        }, () => resolve());
    });
    try {
        await sendMessage({ type: 'EMBY_LIBRARY_UPDATE_CONFIG', config });
    } catch {}
}

function setStatus(el: HTMLElement, text: string, type: 'success' | 'error' | 'info' | 'loading' = 'info'): void {
    el.textContent = text;
    el.style.display = 'block';
    el.classList.remove('status-success', 'status-error', 'status-info', 'status-loading');
    if (type === 'success') el.classList.add('status-success');
    else if (type === 'error') el.classList.add('status-error');
    else if (type === 'loading') el.classList.add('status-loading');
    else el.classList.add('status-info');
}

export async function initEmbySettings(): Promise<void> {
    const pageRoot = document.getElementById('emby-settings');
    if (!pageRoot) {
        console.log('[EmbySettings] Page root not found, skipping initialization');
        return;
    }

    // 防止同一 DOM 实例重复初始化事件监听器
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

    if (!enabledCheckbox || !serverTypeSelect || !serverUrlInput || !apiKeyInput) {
        console.error('[EmbySettings] Required DOM elements not found, aborting initialization');
        return;
    }

    enabledCheckbox.checked = config.server.enabled;
    serverTypeSelect.value = config.server.type;
    serverUrlInput.value = config.server.url || '';
    apiKeyInput.value = config.server.apiKey || '';
    if (libraryNameInput) {
        libraryNameInput.value = config.server.libraryName || '';
    }

    if (configSection) {
        configSection.style.display = enabledCheckbox.checked ? 'block' : 'none';
    }
    enabledCheckbox.addEventListener('change', () => {
        if (configSection) {
            configSection.style.display = enabledCheckbox.checked ? 'block' : 'none';
        }
    });

    if (realtimeOnJavdbCheckbox) {
        realtimeOnJavdbCheckbox.checked = config.sync.realtimeOnJavdb === true;
        realtimeOnJavdbCheckbox.addEventListener('change', () => {
            if (syncIntervalField) {
                syncIntervalField.style.display = autoScheduledSyncCheckbox?.checked ? 'block' : 'none';
            }
        });
    }
    if (autoScheduledSyncCheckbox) {
        autoScheduledSyncCheckbox.checked = config.sync.autoScheduledSync === true;
        autoScheduledSyncCheckbox.addEventListener('change', () => {
            if (syncIntervalField) {
                syncIntervalField.style.display = autoScheduledSyncCheckbox.checked ? 'block' : 'none';
            }
        });
    }
    if (enrichJavdbMetadataCheckbox) {
        enrichJavdbMetadataCheckbox.checked = config.sync.enrichJavdbMetadata === true;
    }

    // 初始化时根据已有配置显示/隐藏同步间隔输入框
    if (syncIntervalField) {
        syncIntervalField.style.display = autoScheduledSyncCheckbox?.checked ? 'block' : 'none';
    }

    if (syncIntervalInput && config.sync.scheduledIntervalMinutes) {
        syncIntervalInput.value = String(config.sync.scheduledIntervalMinutes);
    }

    if (showOnListCheckbox) showOnListCheckbox.checked = config.libraryStatus.showOnList !== false;
    if (showOnDetailCheckbox) showOnDetailCheckbox.checked = config.libraryStatus.showOnDetail !== false;

    if (lastSyncText) {
        if (config.sync.lastSyncTime) {
            lastSyncText.textContent = '上次同步: ' + new Date(config.sync.lastSyncTime).toLocaleString();
        } else {
            lastSyncText.textContent = '尚未同步。请配置服务器并点击"立即同步"。';
        }
    }

    // 测试连接
    if (testConnectionBtn) {
        testConnectionBtn.addEventListener('click', async () => {
            if (!connectionStatus) return;
            setStatus(connectionStatus, '正在测试连接，请稍候...', 'loading');
            const testConfig: EmbyServerConfig = {
                type: serverTypeSelect.value as 'emby' | 'jellyfin',
                url: serverUrlInput.value.trim(),
                apiKey: apiKeyInput.value.trim(),
                enabled: true,
            };
            try {
                const result = await sendMessage({ type: 'EMBY_LIBRARY_TEST_CONNECTION', config: testConfig });
                if (result && result.success) {
                    setStatus(connectionStatus, '✓ 连接成功' + (result.serverName ? ' - 服务器: ' + result.serverName : ''), 'success');
                } else {
                    setStatus(connectionStatus, '✗ 连接失败: ' + (result?.message || '未知错误，请检查服务器地址和 API Key'), 'error');
                }
            } catch (e) {
                const err = e as Error;
                setStatus(connectionStatus, '✗ 连接测试失败: ' + err.message, 'error');
            }
        });
    }

    // 获取库列表
    if (refreshFoldersBtn) {
        refreshFoldersBtn.addEventListener('click', async () => {
            if (!folderListEl) return;
            const currentConfig: EmbyLibraryConfig = {
                server: {
                    type: serverTypeSelect.value as 'emby' | 'jellyfin',
                    url: serverUrlInput.value.trim(),
                    apiKey: apiKeyInput.value.trim(),
                    enabled: enabledCheckbox.checked,
                    libraryName: libraryNameInput.value.trim(),
                },
                sync: config.sync,
                libraryStatus: config.libraryStatus,
            };
            if (!currentConfig.server.url || !currentConfig.server.apiKey) {
                setStatus(folderListEl, '请先填写服务器地址和 API Key', 'error');
                return;
            }
            setStatus(folderListEl, '正在获取库列表，请稍候...', 'loading');
            await sendMessage({ type: 'EMBY_LIBRARY_UPDATE_CONFIG', config: currentConfig });
            try {
                const result = await sendMessage({ type: 'EMBY_LIBRARY_LIST_FOLDERS' });
                if (result && result.success && result.folders && result.folders.length > 0) {
                    const names: string = result.folders.map((f: any) => f.name).join('、');
                    setStatus(folderListEl, '服务器上的媒体库: ' + names + '。共 ' + result.folders.length + ' 个库。请在上方"媒体库名称"字段填入要扫描的库名', 'info');
                    console.log('[EmbySettings] Folders:', result.folders);
                } else {
                    setStatus(folderListEl, '未找到媒体库或请求失败: ' + (result?.error || ''), 'error');
                }
            } catch (e) {
                const err = e as Error;
                setStatus(folderListEl, '✗ 获取库列表失败: ' + err.message, 'error');
            }
        });
    }

    // 立即同步
    if (syncLibraryBtn) {
        syncLibraryBtn.addEventListener('click', async () => {
            if (!syncStatus) return;
            if (!enabledCheckbox.checked) {
                setStatus(syncStatus, '请先启用 Emby 联动并配置服务器信息。', 'error');
                return;
            }
            if (!serverUrlInput.value.trim() || !apiKeyInput.value.trim()) {
                setStatus(syncStatus, '请先填写服务器地址和 API 密钥。', 'error');
                return;
            }
            setStatus(syncStatus, '正在从服务器同步媒体库，请稍候...', 'loading');
            try {
                const currentConfig: EmbyLibraryConfig = {
                    server: {
                        type: serverTypeSelect.value as 'emby' | 'jellyfin',
                        url: serverUrlInput.value.trim(),
                        apiKey: apiKeyInput.value.trim(),
                        enabled: true,
                        libraryName: libraryNameInput.value.trim(),
                    },
                    sync: config.sync,
                    libraryStatus: config.libraryStatus,
                };
                await sendMessage({ type: 'EMBY_LIBRARY_UPDATE_CONFIG', config: currentConfig });

                const result = await sendMessage({ type: 'EMBY_LIBRARY_SYNC' });

                if (result && result.success) {
                    const count = result.index?.totalCount ?? result.count ?? 0;
                    const fetched = result.totalFetched ?? 0;
                    const matchedName = result.matchedLibraryName || '(全局扫描)';
                    const watchedCount = result.watchedCount ?? 0;
                    setStatus(syncStatus, '✓ 同步成功，服务器共 ' + fetched + ' 条影片，成功提取番号 ' + count + ' 条，已观看 ' + watchedCount + ' 部，扫描范围: ' + matchedName, 'success');
                    if (lastSyncText) {
                        lastSyncText.textContent = '上次同步: ' + new Date().toLocaleString() + '（服务器 ' + fetched + ' 条，命中番号 ' + count + ' 条，已观看 ' + watchedCount + ' 部）';
                    }
                    currentConfig.sync.lastSyncTime = Date.now();
                    await saveConfig(currentConfig);
                } else {
                    setStatus(syncStatus, '✗ 同步失败: ' + (result?.error || '无法从服务器获取数据'), 'error');
                }
            } catch (e) {
                const err = e as Error;
                setStatus(syncStatus, '✗ 同步失败: ' + err.message, 'error');
            }
        });
    }

    // 同步已观看记录
    if (syncWatchedBtn && watchedSyncStatus) {
        syncWatchedBtn.addEventListener('click', async () => {
            const wConfig: EmbyLibraryConfig = {
                server: {
                    type: serverTypeSelect.value as 'emby' | 'jellyfin',
                    url: serverUrlInput.value.trim(),
                    apiKey: apiKeyInput.value.trim(),
                    enabled: enabledCheckbox.checked,
                    libraryName: libraryNameInput.value.trim(),
                },
                sync: config.sync,
                libraryStatus: config.libraryStatus,
            };
            if (!wConfig.server.url || !wConfig.server.apiKey) {
                setStatus(watchedSyncStatus, '请先填写服务器地址和 API Key', 'error');
                return;
            }
            await sendMessage({ type: 'EMBY_LIBRARY_UPDATE_CONFIG', config: wConfig });
            setStatus(watchedSyncStatus, '正在从 Emby 获取已观看记录...', 'loading');
            try {
                const result = await sendMessage({ type: 'EMBY_LIBRARY_SYNC_WATCHED' });
                if (result && result.success) {
                    setStatus(watchedSyncStatus, '✓ 已观看同步完成！服务器上共 ' + result.newCodes + ' 部已观看影片，本地累计 ' + result.totalWatched + ' 部已观看番号。', 'success');
                } else {
                    setStatus(watchedSyncStatus, '✗ 同步失败: ' + (result?.error || '未知错误，请确认服务器连接正常'), 'error');
                }
            } catch (e) {
                const err = e as Error;
                setStatus(watchedSyncStatus, '✗ 同步失败: ' + err.message, 'error');
            }
        });
    }

    // 保存设置
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const newConfig: EmbyLibraryConfig = {
                server: {
                    type: serverTypeSelect.value as 'emby' | 'jellyfin',
                    url: serverUrlInput.value.trim(),
                    apiKey: apiKeyInput.value.trim(),
                    enabled: enabledCheckbox.checked,
                    libraryName: libraryNameInput.value.trim(),
                },
                sync: {
                    mode: 'manual',
                    scheduledIntervalMinutes: parseInt(syncIntervalInput?.value || '1440', 10),
                    lastSyncTime: config.sync.lastSyncTime,
                    realtimeOnJavdb: realtimeOnJavdbCheckbox?.checked ?? false,
                    autoScheduledSync: autoScheduledSyncCheckbox?.checked ?? false,
                    enrichJavdbMetadata: enrichJavdbMetadataCheckbox?.checked ?? false,
                },
                libraryStatus: {
                    enabled: enabledCheckbox.checked,
                    showOnList: showOnListCheckbox?.checked ?? true,
                    showOnDetail: showOnDetailCheckbox?.checked ?? true,
                },
            };

            try {
                await saveConfig(newConfig);
                if (saveStatus) {
                    setStatus(saveStatus, '✓ 设置已保存', 'success');
                    setTimeout(() => {
                        if (saveStatus) saveStatus.style.display = 'none';
                    }, 3000);
                }
                showMessage('Emby 联动设置已保存', 'success');
            } catch (e) {
                const err = e as Error;
                if (saveStatus) setStatus(saveStatus, '✗ ' + err.message, 'error');
                showMessage(err.message, 'error');
            }
        });
    }

    // 监听 JavDB 元数据抓取进度条
    const enrichProgressEl = document.getElementById('embyEnrichProgress') as HTMLElement | null;
    const enrichProgressBar = document.getElementById('embyEnrichProgressBar') as HTMLElement | null;
    const enrichProgressText = document.getElementById('embyEnrichProgressText') as HTMLElement | null;
    if (enrichProgressEl && enrichProgressBar && enrichProgressText) {
        let checkTimer: ReturnType<typeof setInterval> | null = null;
        try {
            const r = await new Promise<Record<string, any>>(rs => chrome.storage.local.get([STORAGE_KEYS.EMBY_ENRICH_PROGRESS], d => rs(d)));
            const p = r[STORAGE_KEYS.EMBY_ENRICH_PROGRESS] as any;
            if (p && !p.done) { showEnrichProgress(); updateEnrichProgress(p); startPolling(); }
        } catch {}
        function updateEnrichProgress(p: any) {
            if (!enrichProgressBar) return;
            enrichProgressBar.style.width = (p.total ? Math.round(p.current/p.total*100) : 0) + '%';
            if (p.done) {
                const timeStr = p.lastUpdate ? new Date(p.lastUpdate).toLocaleTimeString() : '';
                if (enrichProgressText) enrichProgressText.textContent = `> 完成 ${p.total} 部抓取任务（${timeStr}）`;
                enrichProgressEl!.classList.add('status-success');
                setTimeout(() => { enrichProgressEl!.style.display = 'none'; if (checkTimer) clearInterval(checkTimer); }, 5000);
            } else if (enrichProgressText) {
                enrichProgressText.textContent = `正在抓取JavDB元数据: ${p.current}/${p.total}${p.currentCode ? ' ('+p.currentCode+')' : ''}`;
            }
        }
        function showEnrichProgress() { enrichProgressEl!.style.display = 'block'; }
        function startPolling() {
            if (checkTimer) return;
            checkTimer = setInterval(async () => {
                const r = await new Promise<Record<string, any>>(rs => chrome.storage.local.get([STORAGE_KEYS.EMBY_ENRICH_PROGRESS], d => rs(d)));
                const p = r[STORAGE_KEYS.EMBY_ENRICH_PROGRESS];
                if (p && p.done) { updateEnrichProgress(p); if (checkTimer) { clearInterval(checkTimer); checkTimer = null; } }
                else if (p) updateEnrichProgress(p);
            }, 1000);
        }
        // 暂停/恢复/停止按钮
        const pauseBtn = document.getElementById('embyEnrichPauseBtn') as HTMLElement | null;
        const resumeBtn = document.getElementById('embyEnrichResumeBtn') as HTMLElement | null;
        const stopBtn = document.getElementById('embyEnrichStopBtn') as HTMLElement | null;
        let isPaused = false;

        async function setPaused(paused: boolean) {
            try {
                const r = await new Promise<Record<string, any>>(rs => chrome.storage.local.get([STORAGE_KEYS.EMBY_ENRICH_PROGRESS], d => rs(d)));
                const p = r[STORAGE_KEYS.EMBY_ENRICH_PROGRESS] as any;
                if (p) {
                    await new Promise<void>(rs => chrome.storage.local.set({
                        [STORAGE_KEYS.EMBY_ENRICH_PROGRESS]: { ...p, paused, lastUpdate: Date.now() }
                    }, () => rs()));
                }
                isPaused = paused;
                updateButtonVisibility();
            } catch {}
        }

        function updateButtonVisibility() {
            if (isPaused) {
                if (pauseBtn) pauseBtn.style.display = 'none';
                if (resumeBtn) resumeBtn.style.display = '';
                if (stopBtn) stopBtn.style.display = '';
            } else {
                if (pauseBtn) pauseBtn.style.display = '';
                if (resumeBtn) resumeBtn.style.display = 'none';
                if (stopBtn) stopBtn.style.display = '';
            }
        }

        function hideAllControlButtons() {
            if (pauseBtn) pauseBtn.style.display = 'none';
            if (resumeBtn) resumeBtn.style.display = 'none';
            if (stopBtn) stopBtn.style.display = 'none';
        }

        if (pauseBtn) {
            pauseBtn.addEventListener('click', () => setPaused(true));
        }
        if (resumeBtn) {
            resumeBtn.addEventListener('click', () => setPaused(false));
        }
        if (stopBtn) {
            stopBtn.addEventListener('click', async () => {
                try {
                    const r = await new Promise<Record<string, any>>(rs => chrome.storage.local.get([STORAGE_KEYS.EMBY_ENRICH_PROGRESS], d => rs(d)));
                    const p = r[STORAGE_KEYS.EMBY_ENRICH_PROGRESS] as any;
                    if (p) {
                        await new Promise<void>(rs => chrome.storage.local.set({
                            [STORAGE_KEYS.EMBY_ENRICH_PROGRESS]: { ...p, aborted: true, paused: false, done: true, lastUpdate: Date.now() }
                        }, () => rs()));
                    }
                    hideAllControlButtons();
                } catch {}
            });
        }

        // 覆盖 updateEnrichProgress：进度条出现时显示按钮，完成时隐藏
        const _origUpdateEnrichProgress = updateEnrichProgress;
        updateEnrichProgress = function(p: any) {
            _origUpdateEnrichProgress(p);
            if (p && !p.done) {
                if (p.paused) {
                    isPaused = true;
                }
                updateButtonVisibility();
            } else {
                hideAllControlButtons();
            }
        };

        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local') return;
            const c = changes[STORAGE_KEYS.EMBY_ENRICH_PROGRESS];
            if (c?.newValue) { showEnrichProgress(); updateEnrichProgress(c.newValue); if (!c.newValue.done && !checkTimer) startPolling(); }
        });
    }

    console.log('[EmbySettings] Emby 联动设置初始化完成');
}
