export async function initEmbySettings(): Promise<void> {
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
