import type { KeywordFilterRule } from '../../../types';

export const DEFAULT_CONTENT_FILTER_SETTINGS = {
  enabled: false,
  keywordRules: [] as KeywordFilterRule[],
} as const;