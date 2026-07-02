/**
 * Emby/Jellyfin playback listener - MAIN world content script
 * Detects playback events on Emby/Jellyfin media server pages for status tracking.
 */
(() => {
  'use strict';

  // Guard: only run on Emby/Jellyfin pages
  const host = location.hostname.toLowerCase();
  const isLocalhost = host === 'localhost' || host === '127.0.0.1';
  if (!isLocalhost) return;

  try {
    // Listen for media playback events
    document.addEventListener('play', (event) => {
      const target = event.target as HTMLElement;
      if (target?.tagName === 'VIDEO' || target?.tagName === 'AUDIO') {
        // Playback started - could be used for Emby status tracking
      }
    }, true);
  } catch {
    // Silently ignore errors in MAIN world context
  }
})();
