/**
 * 磁力链接质量评分系统
 * 根据文件大小、做种数/下载数比例、字幕/画质关键词、上传者信誉等维度给磁力链接打分
 */
import type { MagnetResult } from '../domain/types';

export interface QualityScoreOptions {
  /** 种子质量评分权重配置 */
  weights?: {
    seedRatio: number; // 做种/下载比例权重 (0-1)
    fileSize: number; // 文件大小合理性权重 (0-1)
    qualityKeywords: number; // 画质/字幕关键词权重 (0-1)
    uploaderReputation: number; // 上传者信誉权重 (0-1)
    filenameQuality: number; // 文件名质量权重 (0-1)
  };
}

export interface ScoredMagnetResult extends MagnetResult {
  qualityScore: number; // 0-100 综合评分
  scoreBreakdown: {
    seedRatioScore: number;
    fileSizeScore: number;
    qualityKeywordScore: number;
    uploaderScore: number;
    filenameScore: number;
  };
  flags: string[]; // 质量标签: 4K, FHD, 字幕, 破解版, AI增强 等
}

const DEFAULT_WEIGHTS: Required<QualityScoreOptions['weights']> = {
  seedRatio: 0.30,
  fileSize: 0.25,
  qualityKeywords: 0.25,
  uploaderReputation: 0.10,
  filenameQuality: 0.10,
};

// 画质关键词匹配表
const QUALITY_PATTERNS: Array<{ pattern: RegExp; flag: string; score: number }> = [
  { pattern: /\b(4k|2160p|uhd)\b/i, flag: '4K', score: 25 },
  { pattern: /\b(1080p|fhd|full\s*hd)\b/i, flag: 'FHD', score: 20 },
  { pattern: /\b(720p|hd)\b/i, flag: 'HD', score: 10 },
  { pattern: /\b(subtitle|sub|chs|cht|中字|中文|字幕|eng\s*sub|ja\s*sub)\b/i, flag: '字幕', score: 20 },
  { pattern: /\b(uncensored|无码|無碼|decensored|破坏|破解)\b/i, flag: '破解/无码', score: 15 },
  { pattern: /\b(ai\s*(enhanced|upscaled)|人工智能|超解像)\b/i, flag: 'AI增强', score: 10 },
  { pattern: /\b(blu-ray|bdrip|bd|蓝光)\b/i, flag: '蓝光', score: 15 },
  { pattern: /\b(dvdrip|dvd)\b/i, flag: 'DVD', score: -5 },
  { pattern: /\b(cam|ts|tc)\b/i, flag: '枪版', score: -20 },
  { pattern: /\b(hevc|x265|h265|av1)\b/i, flag: 'HEVC/AV1', score: 5 },
];

// 知名上传者列表（sukebei 等站点）
const REPUTABLE_UPLOADERS = [
  /anonymous/i, // 匿名发布（中性）
  /javbus/i,    // JavBus 相关
  /sukebei/i,   // Sukebei 官方
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 解析文件大小为字节数
 */
export function parseSizeBytes(sizeStr: string): number {
  if (!sizeStr) return 0;
  const match = sizeStr.match(/([\d.]+)\s*(GB|MB|KB|B|TB)/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
  };
  return Math.round(value * (multipliers[unit] || 1));
}

/**
 * 评估文件大小合理性（典型 JAV 文件大小：1GB-8GB 为合理范围）
 */
function scoreFileSize(sizeBytes: number): number {
  if (sizeBytes <= 0) return 0;
  const gb = sizeBytes / (1024 * 1024 * 1024);

  if (gb >= 3 && gb <= 7) return 100;  // 理想范围
  if (gb >= 2 && gb <= 10) return 80;   // 合理范围
  if (gb >= 1 && gb <= 15) return 50;   // 可接受
  if (gb < 0.5) return 10;              // 太小（可能是样本）
  if (gb > 20) return 30;               // 太大（可能是合集）
  return 25;                             // 其他
}

/**
 * 评估做种/下载比例
 * seedRatio = seeders / (seeders + leechers)
 * 高做种比例 = 更健康的种子
 */
function scoreSeedRatio(seeders: number, leechers: number): number {
  if (seeders === 0 && leechers === 0) return 50; // 未知 = 中等
  const total = seeders + leechers;
  if (total === 0) return 50;

  // 做种数越多越好（对数缩放）
  const seedScore = Math.min(100, Math.log2(seeders + 1) * 20);

  // 做种/下载比例
  const ratio = total > 0 ? seeders / total : 0;
  const ratioScore = ratio * 100;

  // 综合：做种数量 + 比例
  return Math.round(seedScore * 0.6 + ratioScore * 0.4);
}

/**
 * 评估文件名/标题中的质量关键词
 */
function scoreQualityKeywords(name: string): { score: number; flags: string[] } {
  let totalScore = 0;
  const flags: string[] = [];

  for (const { pattern, flag, score } of QUALITY_PATTERNS) {
    if (pattern.test(name)) {
      totalScore += score;
      flags.push(flag);
    }
  }

  // 基础分60，根据关键词上下调整
  const finalScore = clamp(60 + totalScore, 0, 100);

  return { score: finalScore, flags };
}

/**
 * 评估上传者信誉
 */
function scoreUploader(source: string, name: string): number {
  // 根据来源给基础分
  const sourceScores: Record<string, number> = {
    sukebei: 70,  // sukebei 是较知名的磁力站
    javbus: 65,
    btdig: 55,    // btdig 爬虫聚合
    btsow: 55,
    torrentz2: 50,
  };
  const baseScore = sourceScores[source.toLowerCase()] ?? 50;

  // 检查是否匹配知名上传者
  for (const pattern of REPUTABLE_UPLOADERS) {
    if (pattern.test(name)) {
      return clamp(baseScore + 10, 0, 100);
    }
  }

  return baseScore;
}

/**
 * 评估文件名/标题完整性
 */
function scoreFilename(name: string): number {
  if (!name) return 0;
  let score = 50; // 基础分

  // 包含番号格式（如 ABC-123）加分
  if (/[A-Z]{2,5}[-\s]?\d{2,5}/.test(name)) score += 20;

  // 包含分辨率信息加分
  if (/\d{3,4}p/.test(name)) score += 10;

  // 文件名长度合理（不太短也不太长）
  const len = name.length;
  if (len > 20 && len < 200) score += 10;
  else if (len > 200) score -= 5;

  // 不包含乱码字符
  if (!/[^\x00-\x7F\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(name)) score += 5;

  return clamp(score, 0, 100);
}

/**
 * 对单个磁力结果进行质量评分
 */
export function scoreMagnetResult(
  result: MagnetResult,
  options: QualityScoreOptions = {},
): ScoredMagnetResult {
  const seeders = result.seeders ?? 0;
  const leechers = result.leechers ?? 0;
  const sizeBytes = result.sizeBytes || parseSizeBytes(result.size);
  const name = result.name || '';

  const seedRatioScore = scoreSeedRatio(seeders, leechers);
  const fileSizeScore = scoreFileSize(sizeBytes);
  const { score: qualityKeywordScore, flags } = scoreQualityKeywords(name);
  const uploaderScore = scoreUploader(result.source, name);
  const filenameScore = scoreFilename(name);

  // 使用默认权重或自定义权重
  const w = options.weights;
  const seedWeight = w?.seedRatio ?? 0.30;
  const sizeWeight = w?.fileSize ?? 0.25;
  const qualityWeight = w?.qualityKeywords ?? 0.25;
  const uploaderWeight = w?.uploaderReputation ?? 0.10;
  const filenameWeight = w?.filenameQuality ?? 0.10;

  const qualityScore = Math.round(
    seedRatioScore * seedWeight +
    fileSizeScore * sizeWeight +
    qualityKeywordScore * qualityWeight +
    uploaderScore * uploaderWeight +
    filenameScore * filenameWeight,
  );

  return {
    ...result,
    sizeBytes: sizeBytes || result.sizeBytes,
    qualityScore: clamp(qualityScore, 0, 100),
    scoreBreakdown: {
      seedRatioScore,
      fileSizeScore,
      qualityKeywordScore,
      uploaderScore,
      filenameScore,
    },
    flags,
  };
}

/**
 * 对磁力搜索结果列表进行质量评分并排序（高分优先）
 */
export function scoreAndSortResults(
  results: MagnetResult[],
  options?: QualityScoreOptions,
): ScoredMagnetResult[] {
  return results
    .map((r) => scoreMagnetResult(r, options))
    .sort((a, b) => b.qualityScore - a.qualityScore);
}

/**
 * 按质量分数过滤结果（只保留分数 >= minScore 的结果）
 */
export function filterByQuality(
  results: ScoredMagnetResult[],
  minScore: number = 50,
): ScoredMagnetResult[] {
  return results.filter((r) => r.qualityScore >= minScore);
}

/**
 * 获取质量排行榜（Top N）
 */
export function getTopQualityResults(
  results: ScoredMagnetResult[],
  topN: number = 5,
): ScoredMagnetResult[] {
  return results.slice(0, topN);
}