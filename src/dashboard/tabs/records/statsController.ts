import type { VideoRecord } from '../../../types';
import type { RecordsAdvancedCondition, RecordsAdvancedFieldKey, RecordsAdvancedComparator } from './advancedConditionModel';
import { STATE } from '../../state';
import { matchCode } from '../../../features/embyLibrary/domain/matcher';
import { normalizeCode } from '../../../features/embyLibrary/domain/matcher';
import { refreshWatchedCodesFromStorage, refreshPushedVideoIds } from './filterModel';
import { getDrive115AppLogger } from '../../../features/drive115/app';

interface RecordsStats {
  total: number;
  viewed: number;
  browsed: number;
  want: number;
  thisWeek: number;
  thisMonth: number;
  inEmby: number;
  embyWatched: number;
  notDownloaded: number;
  pushed: number;
}

interface ServerRecordsStats {
  total?: number;
  byStatus?: Partial<Record<string, number>>;
  last7Days?: number;
  last30Days?: number;
}

export interface CreateRecordsStatsControllerOptions {
  container: HTMLElement | null;
  searchInput: HTMLInputElement;
  filterSelect: HTMLSelectElement;
  selectedTags: Set<string>;
  tokenSelectedTags: Set<string>;
  selectedListIds: Set<string>;
  tokenSelectedListIds: Set<string>;
  refreshTagsFilter: () => void;
  refreshListsFilter: () => void;
  setAdvancedConditions: (conditions: RecordsAdvancedCondition[]) => void;
  renderAdvancedConditions: () => void;
  onFilterApplied: () => void;
  getRecords: () => VideoRecord[];
  isServerModeActive: () => boolean;
  loadServerStats: () => Promise<ServerRecordsStats>;
  now?: () => number;
  initialActiveFilter?: string | null;
}

export interface RecordsStatsController {
  updateStats: () => Promise<void>;
  applyFilterByType: (filterType: string) => void;
}

function buildMemoryStats(records: VideoRecord[], now: number, pushedVideoIds: Set<string>): RecordsStats {
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;

  const embyState = STATE.embyLibraryState;
  const hasEmbyState = embyState && embyState.entries && embyState.entries.length > 0;

  const watchedState = STATE.embyWatchedState;
  const hasWatchedState = watchedState && Array.isArray(watchedState.codes) && watchedState.codes.length > 0;

  let embyWatched = 0;
  if (hasWatchedState) {
    const watchedCodeSet = new Set(watchedState.codes);
    embyWatched = records.filter(record => {
      if (!record.id) return false;
      const normalized = normalizeCode(record.id);
      return watchedCodeSet.has(normalized);
    }).length;
  }

  const inEmbyCount = hasEmbyState ? records.filter(record => matchCode(record.id, embyState!)).length : 0;

  const pushedCount = pushedVideoIds.size > 0
    ? records.filter(record => record.id && pushedVideoIds.has(record.id.toUpperCase())).length
    : 0;
  
  return {
    total: records.length,
    viewed: records.filter(record => record.status === 'viewed').length,
    browsed: records.filter(record => record.status === 'browsed').length,
    want: records.filter(record => record.status === 'want').length,
    thisWeek: records.filter(record => record.createdAt && record.createdAt >= oneWeekAgo).length,
    thisMonth: records.filter(record => record.createdAt && record.createdAt >= oneMonthAgo).length,
    inEmby: inEmbyCount,
    embyWatched,
    notDownloaded: records.length - inEmbyCount,
    pushed: pushedCount,
  };
}

function buildServerStats(serverStats: ServerRecordsStats, pushedVideoIds: Set<string>): RecordsStats {
  const embyState = STATE.embyLibraryState;
  const hasEmbyState = embyState && embyState.entries && embyState.entries.length > 0;
  
  let inEmby = 0;
  if (hasEmbyState) {
    inEmby = STATE.records.filter(record => matchCode(record.id, embyState!)).length;
  }
  
  const watchedState = STATE.embyWatchedState;
  const hasWatchedState = watchedState && Array.isArray(watchedState.codes) && watchedState.codes.length > 0;
  let embyWatched = 0;
  if (hasWatchedState) {
    const watchedCodeSet = new Set(watchedState.codes);
    embyWatched = STATE.records.filter(record => {
      if (!record.id) return false;
      const normalized = normalizeCode(record.id);
      return watchedCodeSet.has(normalized);
    }).length;
  }
  
  const total = serverStats.total || 0;

  const pushed = pushedVideoIds.size > 0
    ? STATE.records.filter(record => record.id && pushedVideoIds.has(record.id.toUpperCase())).length
    : 0;
  
  return {
    total,
    viewed: serverStats.byStatus?.viewed ?? 0,
    browsed: serverStats.byStatus?.browsed ?? 0,
    want: serverStats.byStatus?.want ?? 0,
    thisWeek: serverStats.last7Days || 0,
    thisMonth: serverStats.last30Days || 0,
    inEmby,
    embyWatched,
    notDownloaded: total - inEmby,
    pushed,
  };
}

function renderStatsCards(container: HTMLElement, stats: RecordsStats, activeFilter: string | null): void {
  const activeClass = (filter: string) => filter === activeFilter ? ' active' : '';
  container.innerHTML = `
    <div class="stat-card new-works-stat clickable${activeClass('all')}" data-filter="all" title="点击查看所有番号">
      <div class="stat-value">${stats.total}</div>
      <div class="stat-label">总番号数</div>
    </div>
    <div class="stat-card new-works-stat clickable${activeClass('notDownloaded')}" data-filter="notDownloaded" title="点击查看未下载（收藏但未入库Emby）">
      <div class="stat-value">${stats.notDownloaded}</div>
      <div class="stat-label">未下载</div>
    </div>
    <div class="stat-card new-works-stat clickable${activeClass('embyWatched')}" data-filter="embyWatched" title="点击查看 Emby 中已观看的番号（永久记录，删除文件也不丢失）">
        <div class="stat-value">${stats.embyWatched}</div>
        <div class="stat-label">已观看(Emby)</div>
      </div>
    <div class="stat-card new-works-stat clickable${activeClass('inEmby')}" data-filter="inEmby" title="点击查看已入库Emby的番号">
        <div class="stat-value">${stats.inEmby}</div>
        <div class="stat-label">已入库Emby</div>
      </div>
    <div class="stat-card new-works-stat clickable${activeClass('want')}" data-filter="want" title="点击查看我想看">
      <div class="stat-value">${stats.want}</div>
      <div class="stat-label">我想看</div>
    </div>
    <div class="stat-card new-works-stat clickable${activeClass('thisWeek')}" data-filter="thisWeek" title="点击查看本周新增">
      <div class="stat-value">${stats.thisWeek}</div>
      <div class="stat-label">本周新增</div>
    </div>
    <div class="stat-card new-works-stat clickable${activeClass('thisMonth')}" data-filter="thisMonth" title="点击查看本月新增">
      <div class="stat-value">${stats.thisMonth}</div>
      <div class="stat-label">本月新增</div>
    </div>
    <div class="stat-card new-works-stat clickable${activeClass('pushed')}" data-filter="pushed" title="点击查看已推送到115网盘的番号">
      <div class="stat-value">${stats.pushed}</div>
      <div class="stat-label">已推送</div>
    </div>
  `;
}

async function getPushedVideoIds(): Promise<Set<string>> {
  try {
    await refreshPushedVideoIds();
    const logger = getDrive115AppLogger();
    const logs = await logger.getLogsByType('push_success' as any);
    const ids = new Set<string>();
    logs.forEach(log => {
      if (log.videoId) {
        ids.add(log.videoId.toUpperCase());
      }
    });
    return ids;
  } catch (e) {
    console.warn('Failed to get pushed video ids:', e);
    return new Set();
  }
}

export function createRecordsStatsController(options: CreateRecordsStatsControllerOptions): RecordsStatsController {
  const now = options.now || Date.now;
  let activeFilter: string | null = options.initialActiveFilter || null;
  let pushedVideoIdsCache: Set<string> = new Set();

  const clearQuickFilters = () => {
    options.searchInput.value = '';
    options.selectedTags.clear();
    options.tokenSelectedTags.clear();
    options.selectedListIds.clear();
    options.tokenSelectedListIds.clear();
    options.refreshTagsFilter();
    options.refreshListsFilter();
  };

  const clearAdvancedConditions = () => {
    options.setAdvancedConditions([]);
    options.renderAdvancedConditions();
  };

  const setRecentCondition = (range: 'week' | 'month') => {
    const delta = range === 'week' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    const idPrefix = range === 'week' ? 'cond_week' : 'cond_month';
    options.setAdvancedConditions([{
      id: `${idPrefix}_${Date.now()}`,
      field: 'createdAt',
      op: 'gte',
      value: String(now() - delta),
    }]);
    options.renderAdvancedConditions();
  };

  const highlightCard = (card: Element) => {
    options.container?.querySelectorAll('.stat-card').forEach(item => item.classList.remove('active'));
    card.classList.add('active');
  };

  const applyFilter = (filterType: string, card: Element) => {
    activeFilter = filterType;
    clearQuickFilters();

    if (filterType === 'all') {
      options.filterSelect.value = 'all';
      clearAdvancedConditions();
    } else if (filterType === 'viewed' || filterType === 'browsed' || filterType === 'want') {
      options.filterSelect.value = filterType;
      clearAdvancedConditions();
    } else if (filterType === 'notDownloaded') {
      options.filterSelect.value = 'all';
      options.setAdvancedConditions([{
        id: `cond_not_downloaded_${Date.now()}`,
        field: 'inEmby' as RecordsAdvancedFieldKey,
        op: 'eq' as RecordsAdvancedComparator,
        value: 'false',
      }]);
      highlightCard(card);
      options.onFilterApplied();
      return;
    } else if (filterType === 'inEmby') {
      console.log('[DEBUG-FILTER] applyFilter inEmby branch');
      options.filterSelect.value = 'all';
      options.setAdvancedConditions([{
        id: `cond_emby_${Date.now()}`,
        field: 'inEmby',
        op: 'eq',
        value: 'true',
      } as RecordsAdvancedCondition]);
      highlightCard(card);
      options.onFilterApplied();
      return;
    } else if (filterType === 'embyWatched') {
      console.log('[DEBUG-FILTER] applyFilter embyWatched branch, calling refreshWatchedCodesFromStorage');
      options.filterSelect.value = 'all';
      highlightCard(card);
      refreshWatchedCodesFromStorage().then(() => {
        console.log('[DEBUG-FILTER] embyWatched refresh complete, setting conditions');
        options.setAdvancedConditions([{
          id: `cond_emby_watched_${Date.now()}`,
          field: 'embyWatched',
          op: 'eq',
          value: 'true',
        } as RecordsAdvancedCondition]);
        options.onFilterApplied();
        console.log('[DEBUG-FILTER] embyWatched onFilterApplied called');
      });
      return;
    } else if (filterType === 'thisWeek') {
      options.filterSelect.value = 'all';
      setRecentCondition('week');
    } else if (filterType === 'thisMonth') {
      options.filterSelect.value = 'all';
      setRecentCondition('month');
    } else if (filterType === 'pushed') {
      options.filterSelect.value = 'all';
      highlightCard(card);
      getPushedVideoIds().then((ids) => {
        pushedVideoIdsCache = ids;
        options.setAdvancedConditions([{
          id: `cond_pushed_${Date.now()}`,
          field: 'pushed' as RecordsAdvancedFieldKey,
          op: 'eq' as RecordsAdvancedComparator,
          value: 'true',
        } as RecordsAdvancedCondition]);
        options.onFilterApplied();
      });
      return;
    }

    highlightCard(card);
    options.onFilterApplied();
  };

  const bindCards = () => {
    options.container?.querySelectorAll('.stat-card.clickable').forEach((card) => {
      card.addEventListener('click', () => {
        const filterType = card.getAttribute('data-filter');
        if (!filterType) return;
        applyFilter(filterType, card);
      });
    });
  };

  const updateStats = async () => {
    const container = options.container;
    if (!container) return;

    pushedVideoIdsCache = await getPushedVideoIds();

    let stats: RecordsStats;
    if (options.isServerModeActive()) {
      try {
        stats = buildServerStats(await options.loadServerStats(), pushedVideoIdsCache);
      } catch {
        stats = buildMemoryStats(options.getRecords(), now(), pushedVideoIdsCache);
      }
    } else {
      stats = buildMemoryStats(options.getRecords(), now(), pushedVideoIdsCache);
    }

    renderStatsCards(container, stats, activeFilter);
    console.log('[DEBUG-FILTER] updateStats rendered, activeFilter:', activeFilter, 'embyWatched:', stats.embyWatched, 'inEmby:', stats.inEmby, 'pushed:', stats.pushed, 'total:', stats.total);
    bindCards();
  };

  const applyFilterByType = (filterType: string): void => {
    console.log('[DEBUG-FILTER] applyFilterByType called, filterType:', filterType, 'container exists:', !!options.container);
    if (!options.container) return;
    const card = options.container.querySelector(`.stat-card[data-filter="${filterType}"]`);
    console.log('[DEBUG-FILTER] card found in DOM:', !!card);
    if (card) {
      console.log('[DEBUG-FILTER] calling applyFilter with card');
      applyFilter(filterType, card);
    } else {
      activeFilter = filterType;
      updateStats();
      if (filterType === 'all') {
        options.filterSelect.value = 'all';
        clearAdvancedConditions();
        options.onFilterApplied();
      } else if (filterType === 'viewed' || filterType === 'browsed' || filterType === 'want') {
        options.filterSelect.value = filterType;
        clearAdvancedConditions();
        options.onFilterApplied();
      } else if (filterType === 'notDownloaded') {
        options.filterSelect.value = 'all';
        options.setAdvancedConditions([{
          id: `cond_not_downloaded_${Date.now()}`,
          field: 'inEmby',
          op: 'eq',
          value: 'false',
        } as RecordsAdvancedCondition]);
        options.onFilterApplied();
      } else if (filterType === 'inEmby') {
        options.filterSelect.value = 'all';
        options.setAdvancedConditions([{
          id: `cond_emby_${Date.now()}`,
          field: 'inEmby',
          op: 'eq',
          value: 'true',
        } as RecordsAdvancedCondition]);
        options.onFilterApplied();
      } else if (filterType === 'embyWatched') {
        options.filterSelect.value = 'all';
        refreshWatchedCodesFromStorage().then(() => {
          options.setAdvancedConditions([{
            id: `cond_emby_watched_${Date.now()}`,
            field: 'embyWatched',
            op: 'eq',
            value: 'true',
          } as RecordsAdvancedCondition]);
          options.onFilterApplied();
          updateStats();
        });
      } else if (filterType === 'thisWeek' || filterType === 'thisMonth') {
        options.filterSelect.value = 'all';
        setRecentCondition(filterType === 'thisWeek' ? 'week' : 'month');
        options.onFilterApplied();
      } else if (filterType === 'pushed') {
        options.filterSelect.value = 'all';
        getPushedVideoIds().then((ids) => {
          pushedVideoIdsCache = ids;
          options.setAdvancedConditions([{
            id: `cond_pushed_${Date.now()}`,
            field: 'pushed' as RecordsAdvancedFieldKey,
            op: 'eq' as RecordsAdvancedComparator,
            value: 'true',
          } as RecordsAdvancedCondition]);
          options.onFilterApplied();
          updateStats();
        });
      }
    }
  };

  return { updateStats, applyFilterByType };
}
