let _initialized = false;

export async function initEmbySettings(): Promise<void> {
    if (_initialized) return;
    _initialized = true;

    const { initEmbySettings: initFn } = await import('./EmbySettings');
    await initFn();
}

export async function getEmbySettings(): Promise<{
    init: () => Promise<void>;
    panelId: string;
    panelName: string;
}> {
    const { initEmbySettings } = await import('./EmbySettings');
    return {
        init: async () => {
            await initEmbySettings();
        },
        panelId: 'emby-settings',
        panelName: 'Emby联动',
    };
}

export { initEmbySettings as default };
