/**
 * 列表增强的存储级默认设置（与 ListEnhancementConfig 的运行时配置分开）
 * 用于 src/utils/config.ts 中的 DEFAULT_SETTINGS.listEnhancement
 */
export const DEFAULT_LIST_ENHANCEMENT_SETTINGS = {
  enabled: true,
  enableClickEnhancement: true,
  enableClickEnhancementList: true,
  enableClickEnhancementDetail: true,
  enableVideoPreview: true,
  enableScrollPaging: false,
  enableListOptimization: true,
  previewDelay: 1000,
  previewVolume: 0.2,
  enableRightClickBackground: true,
  enableActorWatermark: false,
  actorWatermarkPosition: 'top-right' as const,
  actorWatermarkOpacity: 0.4,
  hideBlacklistedActorsInList: false,
  hideNonFavoritedActorsInList: false,
  hideUnrecognizedActorsInList: true,
  treatSubscribedAsFavorited: true,
  listDisplayControl: {
    enabled: true,
    columnCount: 4,
    containerWidth: 100,
    enableContainerExpansion: false,
  },
  showStatusBadge: true,
  enableStatusQuickAction: false,
};