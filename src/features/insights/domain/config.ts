export const DEFAULT_INSIGHTS_SETTINGS = {
  topN: 10,
  changeThresholdRatio: 0.08,
  minTagCount: 3,
  risingLimit: 5,
  fallingLimit: 5,
  statusScope: 'viewed' as const,
  source: 'auto' as const,
  minMonthlySamples: 10,
  autoMonthlyEnabled: false,
  autoCompensateOnStartupEnabled: false,
  autoMonthlyMinuteOfDay: 10,
  prompts: {
    persona: 'doctor' as const,
    enableCustom: false,
    systemOverride: '',
    rulesOverride: '',
  },
};