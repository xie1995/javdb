/**
 * 批量导出下载清单 - 将"想看"清单中的番号导出为磁力链接文本文件
 * 方便在 qBittorrent、Aria2 等下载工具中批量导入
 */
import type { VideoRecord } from '../../types';

export interface BatchExportOptions {
  /** 按状态过滤 */
  statusFilter?: VideoRecord['status'][];
  /** 是否仅导出有磁力链接的记录 */
  onlyWithMagnet?: boolean;
  /** 导出格式 */
  format?: 'txt' | 'json' | 'csv';
  /** 最大导出条数 */
  maxCount?: number;
}

interface BatchExportResult {
  content: string;
  filename: string;
  mimeType: string;
  count: number;
  skippedNoMagnet: number;
}

/**
 * 从视频记录列表中生成导出内容
 */
export function buildBatchExportContent(
  records: VideoRecord[],
  options: BatchExportOptions = {},
): BatchExportResult {
  const { statusFilter, onlyWithMagnet = false, format = 'txt', maxCount = 500 } = options;

  let filtered = records;

  // 按状态过滤
  if (statusFilter && statusFilter.length > 0) {
    filtered = filtered.filter((r) => statusFilter.includes(r.status));
  }

  // 限制条数
  let skippedNoMagnet = 0;
  if (format === 'txt' && onlyWithMagnet) {
    const withMagnet = filtered.filter((r) => {
      const hasMagnet = !!(r as any).magnetLink;
      if (!hasMagnet) skippedNoMagnet++;
      return hasMagnet;
    });
    filtered = withMagnet;
  }

  const exportRecords = filtered.slice(0, maxCount);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  let content: string;
  let filename: string;
  let mimeType: string;

  switch (format) {
    case 'txt': {
      const lines = exportRecords.map((r) => {
        const id = r.id || '';
        const title = r.title || '';
        const magnet = (r as any).magnetLink || '';
        if (magnet) return magnet;
        // 没有磁力链接时，输出番号作为搜索结果关键字
        return `# ${id} - ${title}\n# (无磁力链接，请手动搜索)`;
      });
      content = lines.join('\n\n');
      filename = `javdb-download-list-${timestamp}.txt`;
      mimeType = 'text/plain';
      break;
    }
    case 'json': {
      content = JSON.stringify(
        exportRecords.map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          magnetLink: (r as any).magnetLink || null,
          releaseDate: r.releaseDate,
        })),
        null,
        2,
      );
      filename = `javdb-export-${timestamp}.json`;
      mimeType = 'application/json';
      break;
    }
    case 'csv': {
      const header = '番号,标题,状态,磁力链接,发行日期';
      const rows = exportRecords.map((r) => {
        const id = r.id || '';
        const title = `"${(r.title || '').replace(/"/g, '""')}"`;
        const status = r.status || '';
        const magnet = (r as any).magnetLink || '';
        const releaseDate = r.releaseDate || '';
        return [id, title, status, magnet, releaseDate].join(',');
      });
      content = [header, ...rows].join('\n');
      filename = `javdb-export-${timestamp}.csv`;
      mimeType = 'text/csv';
      break;
    }
  }

  return { content, filename, mimeType, count: exportRecords.length, skippedNoMagnet };
}

/**
 * 触发浏览器下载
 */
export function triggerDownload(result: BatchExportResult): void {
  const blob = new Blob([result.content], { type: result.mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 导出番号列表为下载清单的便捷函数
 */
export async function exportDownloadList(
  records: VideoRecord[],
  options: BatchExportOptions = {},
): Promise<BatchExportResult> {
  const result = buildBatchExportContent(records, options);
  triggerDownload(result);
  return result;
}