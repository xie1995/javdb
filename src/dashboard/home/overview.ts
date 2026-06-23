// src/dashboard/home/overview.ts
// 首页统计与分区概览

import { dbViewedStats, dbViewedGetAll, dbActorsStats, dbNewWorksStats, ensureBackgroundReady } from '../dbClient';
import { normalizeCode, matchCode } from '../../features/embyLibrary/domain/matcher';
import { STORAGE_KEYS } from '../../utils/config';
import type { LibraryIndex, EmbyWatchedData } from '../../features/embyLibrary/domain/types';

export async function initStatsOverview(): Promise<void> {
  const container = document.getElementById('stats-overview');
  if (!container) return;

  try {
    try { await ensureBackgroundReady(); } catch (e) {
        console.warn('[HomeOverview] ensureBackgroundReady failed in initStatsOverview:', e);
    }
    const s = await dbViewedStats();
    const total = s.total ?? 0;
    const viewed = s.byStatus?.viewed ?? 0;
    const browsed = s.byStatus?.browsed ?? 0;
    const want = s.byStatus?.want ?? 0;

    container.innerHTML = `
            <div data-stat="total">
                <span class="stat-value">${total}</span>
                <span class="stat-label">总记录</span>
            </div>
            <div data-stat="viewed">
                <span class="stat-value">${viewed}</span>
                <span class="stat-label">收藏的番号总数</span>
            </div>
            <div data-stat="browsed">
                <span class="stat-value">${browsed}</span>
                <span class="stat-label">已浏览</span>
            </div>
            <div data-stat="want">
                <span class="stat-value">${want}</span>
                <span class="stat-label">想看</span>
            </div>
        `;
  } catch (error) {
    console.error('初始化统计概览时出错:', error);
    container.innerHTML = `
            <div data-stat="total">
                <span class="stat-value">0</span>
                <span class="stat-label">总记录</span>
            </div>
            <div data-stat="viewed">
                <span class="stat-value">0</span>
                <span class="stat-label">收藏的番号总数</span>
            </div>
            <div data-stat="browsed">
                <span class="stat-value">0</span>
                <span class="stat-label">已浏览</span>
            </div>
            <div data-stat="want">
                <span class="stat-value">0</span>
                <span class="stat-label">想看</span>
            </div>
        `;
  }
}



function navigateToRecords(filterType: string): void {
  switch (filterType) {
    case 'all':
      localStorage.setItem('recordsFilter', JSON.stringify({ type: 'all' }));
      break;
    case 'embyWatched':
      localStorage.setItem('recordsFilter', JSON.stringify({ type: 'embyWatched' }));
      break;
    case 'inEmby':
      localStorage.setItem('recordsFilter', JSON.stringify({ type: 'inEmby' }));
      break;
    case 'notDownloaded':
      localStorage.setItem('recordsFilter', JSON.stringify({ type: 'notDownloaded' }));
      break;
  }

  const targetHash = '#tab-records';
  const currentHash = window.location.hash;
  if (currentHash === targetHash) {
    window.dispatchEvent(new CustomEvent('records:filter-change'));
  } else {
    window.location.hash = targetHash;
  }
}

let kpiClickListenerBound = false;

function handleKpiClick(e: Event): void {
    const target = e.target as HTMLElement;
    const item = target.closest('.home-kpi-side-item.clickable') as HTMLElement;
    if (item) {
        const filter = item.getAttribute('data-filter');
        if (filter) {
            navigateToRecords(filter);
        }
    }
}

// 首页：迁移"番号库/演员库/新作品"的概览统计到首页
export async function initHomeSectionsOverview(): Promise<void> {

  try {
    try { await ensureBackgroundReady(); } catch (e) {
        console.warn('[HomeOverview] ensureBackgroundReady failed in initHomeSectionsOverview:', e);
    }
    let recordsTotal = 0;
    let recordsViewed = 0;
    let recordsBrowsed = 0;
    let recordsWant = 0;
    let recordsLast7 = 0;
    let actorsTotal = 0;
    let worksTotal = 0;
    let embyWatchedCount = 0;
    let inEmbyCount = 0;

    const heroTotalEl = document.getElementById('homeHeroTotal');
    const heroSnapshotEl = document.getElementById('homeHeroSnapshot');
    const heroViewedEl = document.getElementById('homeHeroViewed');
    const heroBrowsedEl = document.getElementById('homeHeroBrowsed');
    const heroWantEl = document.getElementById('homeHeroWant');
    const heroLast7El = document.getElementById('homeHeroLast7');

    

    const syncHero = (): void => {
      if (heroTotalEl) heroTotalEl.textContent = String(recordsTotal || 0);
      if (heroViewedEl) heroViewedEl.textContent = String(recordsTotal || 0);
      if (heroBrowsedEl) heroBrowsedEl.textContent = String(embyWatchedCount || 0);
      if (heroWantEl) heroWantEl.textContent = String(inEmbyCount || 0);
      if (heroLast7El) heroLast7El.textContent = String((recordsTotal - inEmbyCount) || 0);
      if (heroSnapshotEl) {
        heroSnapshotEl.textContent = `演员 ${actorsTotal || 0} · 新作品 ${worksTotal || 0}`;
      }
    };

    await new Promise<void>((resolve) => {
      chrome.storage.local.get([STORAGE_KEYS.EMBY_WATCHED_PERMANENT, STORAGE_KEYS.EMBY_LIBRARY_INDEX], (result) => {
        const watchedData = result[STORAGE_KEYS.EMBY_WATCHED_PERMANENT] as EmbyWatchedData | undefined;
        if (watchedData && typeof watchedData === 'object' && Array.isArray(watchedData.codes)) {
          (window as any).STATE = (window as any).STATE || {};
          (window as any).STATE.embyWatchedState = watchedData;
        }
        const libraryData = result[STORAGE_KEYS.EMBY_LIBRARY_INDEX] as LibraryIndex | undefined;
        if (libraryData && typeof libraryData === 'object' && Array.isArray(libraryData.entries)) {
          (window as any).STATE = (window as any).STATE || {};
          (window as any).STATE.embyLibraryState = libraryData;
        }
        resolve();
      });
    });

    try {
        const s = await dbViewedStats();
        recordsTotal = s.total ?? 0;
        recordsViewed = s.byStatus?.viewed ?? 0;
        recordsBrowsed = s.byStatus?.browsed ?? 0;
        recordsWant = s.byStatus?.want ?? 0;
        recordsLast7 = s.last7Days ?? 0;

        const watchedState = (window as any).STATE?.embyWatchedState as EmbyWatchedData | undefined;
        if (watchedState && Array.isArray(watchedState.codes)) {
          const watchedCodeSet = new Set(watchedState.codes);
          const allRecords = await dbViewedGetAll();
          embyWatchedCount = allRecords.filter((record: { id?: string }) => {
            if (!record.id) return false;
            const normalized = normalizeCode(record.id);
            return watchedCodeSet.has(normalized);
          }).length;

          const embyState = (window as any).STATE?.embyLibraryState as LibraryIndex | undefined;
          if (embyState && embyState.entries && embyState.entries.length > 0) {
            inEmbyCount = allRecords.filter((record: { id?: string }) => record.id ? matchCode(record.id, embyState) : false).length;
          }
        }

        const recordsBox = document.getElementById('homeRecordsStatsContainer');
        if (recordsBox) {
          recordsBox.innerHTML = `
                    <div class="stat-item" data-stat="total"><span class="stat-value">${recordsTotal}</span><span class="stat-label">总记录</span></div>
                    <div class="stat-item" data-stat="viewed"><span class="stat-value">${recordsViewed}</span><span class="stat-label">已观看</span></div>
                    <div class="stat-item" data-stat="browsed"><span class="stat-value">${recordsBrowsed}</span><span class="stat-label">已浏览</span></div>
                    <div class="stat-item" data-stat="want"><span class="stat-value">${recordsWant}</span><span class="stat-label">想看</span></div>
                    <div class="stat-item" data-stat="last7"><span class="stat-value">${recordsLast7}</span><span class="stat-label">近7天新增</span></div>
                    <div class="stat-item" data-stat="last30"><span class="stat-value">${s.last30Days ?? 0}</span><span class="stat-label">近30天新增</span></div>
                `;
        }
        syncHero();
      } catch (e) {
        console.error('[HomeOverview] Failed to load records stats:', e);
      }

    // 演员库概览
    const actorsBox = document.getElementById('homeActorsStatsContainer');
    if (actorsBox) {
      try {
        const a = await dbActorsStats();
        actorsTotal = a.total ?? 0;
        const female = a.byGender?.female ?? 0;
        const male = a.byGender?.male ?? 0;
        const unknown = a.byGender?.unknown ?? 0;
        const censored = a.byCategory?.censored ?? 0;
        const uncensored = a.byCategory?.uncensored ?? 0;
        actorsBox.innerHTML = `
                    <div class="stat-item" data-stat="total"><span class="stat-value">${a.total ?? 0}</span><span class="stat-label">总演员数</span></div>
                    <div class="stat-item" data-stat="female"><span class="stat-value">${female}</span><span class="stat-label">女性</span></div>
                    <div class="stat-item" data-stat="male"><span class="stat-value">${male}</span><span class="stat-label">男性</span></div>
                    <div class="stat-item" data-stat="unknown"><span class="stat-value">${unknown}</span><span class="stat-label">未知</span></div>
                    <div class="stat-item" data-stat="censored"><span class="stat-value">${censored}</span><span class="stat-label">有码</span></div>
                    <div class="stat-item" data-stat="uncensored"><span class="stat-value">${uncensored}</span><span class="stat-label">无码</span></div>
                    <div class="stat-item" data-stat="blacklisted"><span class="stat-value">${a.blacklisted ?? 0}</span><span class="stat-label">黑名单</span></div>
                    <div class="stat-item" data-stat="recentlyAdded"><span class="stat-value">${a.recentlyAdded ?? 0}</span><span class="stat-label">最近新增</span></div>
                    <div class="stat-item" data-stat="recentlyUpdated"><span class="stat-value">${a.recentlyUpdated ?? 0}</span><span class="stat-label">最近更新</span></div>
                `;
        syncHero();
      } catch (e) {
        actorsBox.innerHTML = '<div class="stat-item"><span class="stat-label">加载失败</span><span class="stat-value">-</span></div>';
      }
    }

    // 新作品概览
    const worksBox = document.getElementById('homeNewWorksStatsContainer');
    if (worksBox) {
      try {
        const w = await dbNewWorksStats();
        worksTotal = w.total ?? 0;
        worksBox.innerHTML = `
                    <div class="stat-item" data-stat="total"><span class="stat-value">${w.total ?? 0}</span><span class="stat-label">总记录</span></div>
                    <div class="stat-item" data-stat="unread"><span class="stat-value">${w.unread ?? 0}</span><span class="stat-label">未读</span></div>
                    <div class="stat-item" data-stat="today"><span class="stat-value">${w.today ?? 0}</span><span class="stat-label">今日发现</span></div>
                    <div class="stat-item" data-stat="week"><span class="stat-value">${w.week ?? 0}</span><span class="stat-label">本周发现</span></div>
                `;
        syncHero();
      } catch (e) {
        worksBox.innerHTML = '<div class="stat-item"><span class="stat-label">加载失败</span><span class="stat-value">-</span></div>';
      }
    }
    syncHero();

    if (!kpiClickListenerBound) {
        document.addEventListener('click', handleKpiClick);
        kpiClickListenerBound = true;
    }
  } catch (e) {
    console.error('[HomeOverview] initHomeSectionsOverview failed:', e);
  }
}
