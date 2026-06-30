/**
 * 演员同步和演员页增强的存储级默认设置
 */
export const DEFAULT_ACTOR_SYNC_SETTINGS = {
  enabled: true,
  autoSync: false,
  syncInterval: 1440,
  batchSize: 20,
  maxRetries: 3,
  requestInterval: 3,
  urls: {
    collectionActors: 'https://javdb.com/users/collection_actors',
    actorDetail: 'https://javdb.com/actors/{{ACTOR_ID}}',
  },
};

export const DEFAULT_ACTOR_ENHANCEMENT_SETTINGS = {
  enabled: false,
  autoApplyTags: false,
  defaultTags: [] as string[],
  defaultSortType: 0,
  enableTimeSegmentationDivider: false,
  timeSegmentationMonths: 6,
} as const;