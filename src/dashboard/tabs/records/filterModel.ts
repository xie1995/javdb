import type { ListRecord, VideoRecord, VideoStatus } from '../../../types';
import {
  matchesLabelRecord,
  matchesSeriesRecord,
} from '../../../shared/utils/listRecordHelpers';
import {
  evaluateRecordsAdvancedCondition,
  type RecordsAdvancedCondition,
} from './advancedConditionModel';
import { STATE } from '../../state';
import { matchCode } from '../../../features/embyLibrary/domain/matcher';
import { normalizeCode } from '../../../features/embyLibrary/domain/matcher';
import { STORAGE_KEYS } from '../../../utils/config';

let cachedWatchedCodes: Set<string> | null = null;
let watchedCodesCacheTime = 0;

function getWatchedCodesSet(): Set<string> | null {
  if (cachedWatchedCodes && Date.now() - watchedCodesCacheTime < 30000) {
    return cachedWatchedCodes;
  }
  const watchedState = (STATE as any).embyWatchedState;
  if (watchedState && watchedState.codes && Array.isArray(watchedState.codes) && watchedState.codes.length > 0) {
    cachedWatchedCodes = new Set(watchedState.codes as string[]);
    watchedCodesCacheTime = Date.now();
    return cachedWatchedCodes;
  }
  return null;
}

export function refreshWatchedCodesFromStorage(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.EMBY_WATCHED_PERMANENT], (result) => {
      const watchedData = result[STORAGE_KEYS.EMBY_WATCHED_PERMANENT];
      if (watchedData && typeof watchedData === 'object' && (watchedData as Record<string, unknown>).codes) {
        (STATE as any).embyWatchedState = watchedData as Record<string, unknown>;
        cachedWatchedCodes = new Set((watchedData as any).codes as string[]);
        watchedCodesCacheTime = Date.now();
        console.log('[filterModel] Watched codes refreshed from storage:', cachedWatchedCodes.size, 'codes');
      } else {
        console.log('[filterModel] Watched codes: no data in storage');
      }
      resolve();
    });
  });
}

export interface FilterAndSortRecordsInput {
  records: VideoRecord[];
  searchTerm: string;
  status: 'all' | VideoStatus;
  selectedTags: Set<string>;
  selectedListIds: Set<string>;
  selectedSeriesIds: Set<string>;
  selectedLabelIds: Set<string>;
  seriesIdToRecord: Map<string, ListRecord>;
  labelIdToRecord: Map<string, ListRecord>;
  advancedConditions: RecordsAdvancedCondition[];
  favoritesFilterActive: boolean;
  sortValue: string;
}

function matchesSearch(record: VideoRecord, searchTerm: string, tagsLower: string[]): boolean {
  if (!searchTerm) return true;
  return Boolean(
    (record.id && record.id.toLowerCase().includes(searchTerm)) ||
    (record.title && record.title.toLowerCase().includes(searchTerm)) ||
    tagsLower.some(tag => tag.includes(searchTerm))
  );
}

function matchesSelectedTags(tagsLower: string[], selectedTags: Set<string>): boolean {
  if (selectedTags.size === 0) return true;
  const selectedTagsLower = Array.from(selectedTags).map(tag => String(tag).toLowerCase());
  return selectedTagsLower.every(token => tagsLower.some(tag => tag.includes(token)));
}

function matchesSelectedLists(record: VideoRecord, selectedListIds: Set<string>): boolean {
  if (selectedListIds.size === 0) return true;
  const recordListIds = Array.isArray(record.listIds) ? record.listIds : [];
  if (recordListIds.length === 0) return false;
  return Array.from(selectedListIds).some(id => recordListIds.includes(String(id)));
}

function matchesSelectedSeries(
  record: VideoRecord,
  selectedSeriesIds: Set<string>,
  seriesIdToRecord: Map<string, ListRecord>,
): boolean {
  if (selectedSeriesIds.size === 0) return true;
  return Array.from(selectedSeriesIds).some((seriesId) => {
    const series = seriesIdToRecord.get(String(seriesId));
    if (series) return matchesSeriesRecord(record, series);

    const url = String(record.seriesUrl || '');
    if (url.endsWith(`/series/${seriesId}`) || url.includes(`/series/${seriesId}?`)) return true;
    return String(record.series || '').trim().toLowerCase() === String(seriesId).trim().toLowerCase();
  });
}

function matchesSelectedLabels(
  record: VideoRecord,
  selectedLabelIds: Set<string>,
  labelIdToRecord: Map<string, ListRecord>,
): boolean {
  if (selectedLabelIds.size === 0) return true;
  return Array.from(selectedLabelIds).some((prefix) => {
    const label = labelIdToRecord.get(String(prefix).toUpperCase());
    if (label) return matchesLabelRecord(record, label);

    const id = String(record.id || '').toUpperCase();
    const normalizedPrefix = String(prefix || '').toUpperCase();
    return id === normalizedPrefix || id.startsWith(`${normalizedPrefix}-`);
  });
}

function sortRecords(records: VideoRecord[], sortValue: string): VideoRecord[] {
  return [...records].sort((a, b) => {
    try {
      switch (sortValue) {
        case 'createdAt_desc':
          return (b.createdAt || 0) - (a.createdAt || 0);
        case 'createdAt_asc':
          return (a.createdAt || 0) - (b.createdAt || 0);
        case 'updatedAt_asc':
          return (a.updatedAt || 0) - (b.updatedAt || 0);
        case 'id_asc':
          return (a.id || '').localeCompare(b.id || '');
        case 'id_desc':
          return (b.id || '').localeCompare(a.id || '');
        case 'updatedAt_desc':
        default:
          return (b.updatedAt || 0) - (a.updatedAt || 0);
      }
    } catch {
      return 0;
    }
  });
}

function matchesInEmbyCondition(record: VideoRecord): boolean {
  const embyState = (STATE as any).embyLibraryState;
  if (!embyState || !embyState.entries || embyState.entries.length === 0) {
    return false;
  }
  return matchCode(record.id, embyState);
}

function matchesEmbyWatchedCondition(record: VideoRecord): boolean {
  const watchedCodeSet = getWatchedCodesSet();
  if (!watchedCodeSet) return false;
  const normalized = normalizeCode(record.id);
  return watchedCodeSet.has(normalized);
}

export function filterAndSortRecords(input: FilterAndSortRecordsInput): VideoRecord[] {
  const searchTerm = input.searchTerm.toLowerCase();
  const records = Array.isArray(input.records) ? input.records : [];

  const filtered = records.filter((record) => {
    if (!record || typeof record !== 'object') return false;

    const tags = Array.isArray(record.tags) ? record.tags : [];
    const tagsLower = tags.map(tag => String(tag).toLowerCase());
    const matchesStatus = input.status === 'all' || record.status === input.status;
    const matchesFavorite = !input.favoritesFilterActive || record.isFavorite === true;

    const basicMatch =
      matchesSearch(record, searchTerm, tagsLower) &&
      matchesStatus &&
      matchesSelectedTags(tagsLower, input.selectedTags) &&
      matchesSelectedLists(record, input.selectedListIds) &&
      matchesSelectedSeries(record, input.selectedSeriesIds, input.seriesIdToRecord) &&
      matchesSelectedLabels(record, input.selectedLabelIds, input.labelIdToRecord) &&
      matchesFavorite;

    if (!basicMatch) return false;

    if (input.advancedConditions.length === 0) return true;

    for (const condition of input.advancedConditions) {
      if (condition.field === 'inEmby') {
        const shouldBeInEmby = condition.value === 'true';
        const isInEmby = matchesInEmbyCondition(record);
        if (isInEmby !== shouldBeInEmby) return false;
      } else if (condition.field === 'embyWatched') {
        const shouldBeWatched = condition.value === 'true';
        const isWatched = matchesEmbyWatchedCondition(record);
        if (isWatched !== shouldBeWatched) return false;
      } else {
        if (!evaluateRecordsAdvancedCondition(record, condition)) return false;
      }
    }
    return true;
  });

  return sortRecords(filtered, input.sortValue);
}
