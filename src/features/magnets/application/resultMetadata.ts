import { appendMagnetResults, extractMagnetHash } from './resultMerge';
import type { MagnetResult } from '../domain/types';

const ZH_REGEX = /中文|字幕|中字|(-|_)c(?!d)/i;

export function parseSizeToBytes(sizeStr: string): number {
  const match = sizeStr.match(/([0-9.]+)\s*(TB|GB|MB|KB|B)/i);
  if (!match) return 0;
  const size = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase() as 'TB' | 'GB' | 'MB' | 'KB' | 'B';
  const multipliers: Record<string, number> = {
    TB: 1024 * 1024 * 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    MB: 1024 * 1024,
    KB: 1024,
    B: 1,
  };
  return size * (multipliers[unit] || 0);
}

export function detectMagnetSubtitle(name: string): boolean {
  return ZH_REGEX.test(name);
}

export function detectMagnetQuality(name: string): string | undefined {
  const qualityPatterns = [
    { pattern: /4K|2160p/i, quality: '4K' },
    { pattern: /1080p/i, quality: '1080p' },
    { pattern: /720p/i, quality: '720p' },
    { pattern: /480p/i, quality: '480p' },
  ];

  for (const { pattern, quality } of qualityPatterns) {
    if (pattern.test(name)) {
      return quality;
    }
  }

  return undefined;
}

export function isCrackedVersion(name: string): boolean {
  const crackKeywords = ['破解', 'crack', 'uncensored', '无码', '無碼', 'leaked'];
  const normalizedName = name.toLowerCase();
  return crackKeywords.some(keyword => normalizedName.includes(keyword.toLowerCase()));
}

export function parseRelativeMagnetDate(relativeStr: string, baseDate = new Date()): string {
  const date = new Date(baseDate.getTime());
  const lowerStr = relativeStr.toLowerCase();
  const match = lowerStr.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s*ago/);
  if (!match) return '2024-01-01';

  const amount = parseInt(match[1]);
  const unit = match[2];
  switch (unit) {
    case 'minute':
      date.setMinutes(date.getMinutes() - amount);
      break;
    case 'hour':
      date.setHours(date.getHours() - amount);
      break;
    case 'day':
      date.setDate(date.getDate() - amount);
      break;
    case 'week':
      date.setDate(date.getDate() - amount * 7);
      break;
    case 'month':
      date.setMonth(date.getMonth() - amount);
      break;
    case 'year':
      date.setFullYear(date.getFullYear() - amount);
      break;
  }

  return date.toISOString().split('T')[0];
}

export function normalizeMagnetDate(dateStr: string, source: string, baseDate = new Date()): string {
  if (!dateStr) return '';

  switch (source) {
    case 'JavDB':
    case 'Sukebei':
      return dateStr;
    case 'BTdig':
      return parseRelativeMagnetDate(dateStr, baseDate);
    case 'BTSOW':
      if (dateStr.includes('ago') || dateStr.includes('found')) {
        return parseRelativeMagnetDate(dateStr, baseDate);
      }
      return dateStr;
    default:
      return dateStr;
  }
}

export function getVideoIdMatchCandidates(videoId: string): string[] {
  const normalizedVideoId = String(videoId || '').toUpperCase();
  const candidates = new Set<string>([normalizedVideoId]);
  const compact = normalizedVideoId.replace(/[^A-Z0-9]/g, '');

  const fc2Match = compact.match(/^FC2(?:PPV)?(\d+)$/);
  if (fc2Match) {
    const numericId = fc2Match[1];
    candidates.add(`FC2-${numericId}`);
    candidates.add(`FC2PPV${numericId}`);
    candidates.add(`FC2-PPV-${numericId}`);
    candidates.add(`FC2 PPV ${numericId}`);
  }

  return Array.from(candidates).filter(Boolean);
}

export function isValidMagnetResultName(name: string, videoId: string): boolean {
  if (!name || !videoId) return false;
  const normalizedName = name.toUpperCase();
  const candidates = getVideoIdMatchCandidates(videoId);
  return candidates.some((candidate) => normalizedName.includes(candidate));
}

export function deduplicateMagnetResults(results: MagnetResult[]): MagnetResult[] {
  const uniqueResults: MagnetResult[] = [];
  appendMagnetResults(uniqueResults, results);
  return uniqueResults;
}

import { scoreAndSortResults, scoreMagnetResult } from './qualityScore';

export function sortMagnetResults(results: MagnetResult[], useQualityScore = true): MagnetResult[] {
  // 使用质量评分系统排序（优先），有做种数据的外部源结果按质量评分排序
  if (useQualityScore) {
    return scoreAndSortResults(results) as MagnetResult[];
  }

  // Fallback: 传统排序逻辑（字幕优先、破解优先、大小、日期、做种数）
  return results.sort((a, b) => {
    if (a.hasSubtitle && !b.hasSubtitle) return -1;
    if (!a.hasSubtitle && b.hasSubtitle) return 1;

    const aIsCracked = isCrackedVersion(a.name);
    const bIsCracked = isCrackedVersion(b.name);
    if (aIsCracked && !bIsCracked) return -1;
    if (!aIsCracked && bIsCracked) return 1;

    if (a.sizeBytes !== b.sizeBytes) {
      return b.sizeBytes - a.sizeBytes;
    }

    if (a.date && b.date) {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    }

    return (b.seeders || 0) - (a.seeders || 0);
  });
}

export function extractHashFromMagnet(magnet: string): string {
  return extractMagnetHash(magnet);
}

export function extractFileCountFromText(text: string): number {
  if (!text) return Infinity;
  const patterns = [
    /(\d+)\s*個文件/,
    /(\d+)\s*个文件/,
    /(\d+)\s*files?/i,
    /(\d+)\s*file\b/i,
    /\[(\d+)\s*files?\]/i,
    /（(\d+)\s*文件）/,
    /\((\d+)\s*files?\)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const count = parseInt(match[1], 10);
      if (!isNaN(count) && count > 0) {
        return count;
      }
    }
  }
  return Infinity;
}

export function extractFileCountFromName(name: string): number {
  return extractFileCountFromText(name);
}

export function getMagnetFileCount(magnet: MagnetResult): number {
  if (magnet.fileCount !== undefined && magnet.fileCount > 0) {
    return magnet.fileCount;
  }
  return extractFileCountFromName(magnet.name);
}

export function selectOptimalMagnet(magnets: MagnetResult[]): MagnetResult | null {
  if (magnets.length === 0) return null;
  const sorted = [...magnets].sort((a, b) => {
    const fileCountA = getMagnetFileCount(a);
    const fileCountB = getMagnetFileCount(b);
    if (fileCountA !== fileCountB) {
      return fileCountA - fileCountB;
    }
    return b.sizeBytes - a.sizeBytes;
  });
  return sorted[0];
}
