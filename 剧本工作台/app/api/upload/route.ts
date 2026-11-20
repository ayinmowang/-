import fs from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { Readable } from 'node:stream';
import { buildDocxBuffer, projectToDocxInput } from '../../../lib/docx';
import {
  bindings,
  owner,
  getProject,
  saveProject,
  message,
  failure,
  getMaxUploadBytes,
  sanitizeForClient,
} from '../../../lib/server';
import type { AttachmentRole, Project } from '../../../lib/types';

const BUCKET_DIR = path.join(process.cwd(), '.data', 'buckets');

const DANGEROUS_EXTS = new Set(['exe', 'bat', 'cmd', 'dll', 'com', 'msi']);
const DANGEROUS_MIMES = new Set([
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
]);
const TRANSCRIBE_ALLOWED_EXTS = new Set([
  'mp4',
  'mov',
  'webm',
  'mkv',
  'avi',
  'srt',
  'ass',
  'vtt',
  'docx',
  'txt',
  'md',
]);

function sanitizeAttachmentName(rawName: string): string {
  const cleaned = String(rawName || '')
    .replace(/\0/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '');
  const base = path.posix.basename(cleaned.replace(/\\/g, '/')).replace(/^\.+/, '');
  return base || '未命名素材';
}

function validateUploadType(fileName: string, mimeType: string, projectKind?: string): void {
  const ext = path.extname(fileName).toLowerCase().replace(/^\./, '');
  const normalizedMime = String(mimeType || '').toLowerCase().split(';')[0].trim();
  if (DANGEROUS_EXTS.has(ext) || DANGEROUS_MIMES.has(normalizedMime)) {
    throw new Error('FILE_TYPE_REJECTED');
  }
  if (projectKind === 'transcribe' && !TRANSCRIBE_ALLOWED_EXTS.has(ext)) {
    throw new Error('FILE_TYPE_REJECTED');
  }
}

function resolveLocalBucketPath(key: string): string {
  const safeName = String(key || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '_');
  if (!safeName) throw new Error('INVALID_INPUT');
  return path.join(BUCKET_DIR, safeName);
}

function hasCustomBucketBinding(): boolean {
  const g = globalThis as any;
  return Boolean(g.__STUDIO_BINDINGS__ && g.__STUDIO_BINDINGS__.BUCKET);
}

async function streamToDiskWithLimit(
  stream: ReadableStream<Uint8Array> | null,
  destPath: string,
  maxBytes: number
): Promise<number> {
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  if (!stream) {
    if (0 > maxBytes) throw new Error('FILE_TOO_LARGE');
    await fs.promises.writeFile(destPath, Buffer.alloc(0));
    return 0;
  }

  const ws = fs.createWriteStream(destPath);
  const reader = stream.getReader();
  let totalBytes = 0;
  let cleanedUp = false;

  const abortAndCleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    await reader.cancel().catch(() => {});
    ws.destroy();
    await fs.promises.unlink(destPath).catch(() => {});
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await abortAndCleanup();
        throw new Error('FILE_TOO_LARGE');
      }
      if (!ws.write(value)) {
        await once(ws, 'drain');
      }
    }
    ws.end();
    await once(ws, 'finish');
    return totalBytes;
  } catch (err) {
    await abortAndCleanup();
    throw err;
  }
}

async function readStreamToBufferWithLimit(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('FILE_TOO_LARGE');
      }
      chunks.push(value);
    }
    const out = new Uint8Array(totalBytes);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  }
}

function detectEpisodeFromName(name: string): number | undefined {
  // Strip extension
  const base = name.replace(/\.[^.]+$/, '').trim();
  // Do NOT guess composite scene names like "1-1" or "20261113" or "微信视频2026..."
  if (/^\d+\s*[-_]\s*\d+$/.test(base) || /微信视频|WeChat|\d{6,}/i.test(base)) {
    return undefined;
  }
  const match =
    base.match(/(?:第|^|[_\-\s])0*(\d{1,3})\s*[集话期]/) ||
    base.match(/(?:^|[_\-\s])(?:ep|episode)\s*0*(\d{1,3})(?:$|[_\-\s])/i) ||
    base.match(/^0*(\d{1,3})$/) ||
    base.match(/[\u4e00-\u9fa5a-zA-Z][_\-\s]0*(\d{1,3})$/);
  const n = Number(match?.[1]);
  return Number.isInteger(n) && n >= 1 && n <= 300 ? n : undefined;
}

function detectRoleFromName(name: string, kind: string): 'source' | 'locked' | 'setting' {
  if (kind === 'original') return 'setting';
  if (/(锁定|定稿|locked|前\d+集)/i.test(name)) return 'locked';
  if (/(设定|人物|大纲|参考|setting|bible)/i.test(name)) return 'setting';
  return 'source';
}

export async function GET(request: Request) {
  try {
    const user = await owner(request);
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const fileId = url.searchParams.get('file');
    const exportParam = url.searchParams.get('export');
    const formatParam = url.searchParams.get('format');
    const isDocxExport = exportParam === 'docx' || formatParam === 'docx';
    const isExport = exportParam === '1';
    if (!id) throw new Error('INVALID_INPUT');
    const p = await getProject(id, user);

    if (isDocxExport) {
      const docxBuf = buildDocxBuffer(projectToDocxInput(p));
      const exportRawName = `${p.title || 'script'}-完整剧本.docx`;
      const encodedFileName = encodeURIComponent(exportRawName);
      const asciiExportFallback =
        exportRawName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'script.docx';
      return new Response(new Uint8Array(docxBuf), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${asciiExportFallback}"; filename*=UTF-8''${encodedFileName}`,
        },
      });
    }

    if (isExport) {
      // Export structured script document (Synopsis -> Character Bios -> Locked Episodes -> Body)
      const outputs = p.remote?.outputs || {};
      const episodesText =
        Array.isArray(p.episodes) && p.episodes.length > 0
          ? [...p.episodes]
              .sort((a, b) => a.episodeNumber - b.episodeNumber)
              .map((ep) => {
                const epText = typeof ep.body === 'string' ? ep.body : (ep as any).content || '';
                const lockTag = ep.locked ? '【锁定稿】' : '';
                return `### 第 ${ep.episodeNumber} 集${ep.title ? ` · ${ep.title}` : ''} ${lockTag}\n${epText}`.trim();
              })
              .join('\n\n')
          : '';
      const sections: string[] = [
        `# 《${p.title}》交付剧本包`,
        `流程类型：${p.kind} | 全剧集数：${p.total ?? '待确认'} 集${p.lockedEpisodes ? ` | 前 ${p.lockedEpisodes} 集已锁定（一字不动），本轮续写：第 ${p.lockedEpisodes + 1}–${p.total ?? '末'} 集` : ''}`,
        `导出时间：${new Date().toISOString()}`,
        '',
        '## 一、故事梗概（Synopsis）',
        outputs.synopsis?.content || outputs.recap?.content || p.brief || '（待生成梗概）',
        '',
        '## 二、人物小传（Character Bios）',
        outputs.characters?.content || '（待生成人物小传）',
        '',
        '## 三、剧本正文（Script Body）',
        p.lockedEpisodes ? `> 【锁定稿保护声明】第 1–${p.lockedEpisodes} 集为已锁定定稿，导出层逐字原样保留。` : '',
        outputs.script?.content || episodesText || outputs.outline?.content || '（待生成剧本正文）',
        ...(outputs.gates?.content
          ? ['', '## 四、桥段出海四级诊断与三道门方案（Gates）', outputs.gates.content]
          : []),
      ].filter(Boolean);

      const safeMarkdown = sanitizeForClient(sections.join('\n\n'));
      const exportRawName = `${p.title}-完整剧本.md`;
      const encodedFileName = encodeURIComponent(exportRawName);
      const asciiExportFallback =
        exportRawName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'script-export.md';
      return new Response(safeMarkdown, {
        status: 200,
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${asciiExportFallback}"; filename*=UTF-8''${encodedFileName}`,
        },
      });
    }

    if (fileId) {
      const att = p.attachments.find((a) => a.id === fileId);
      if (!att) throw new Error('NOT_FOUND');
      const bucketKey = `${user}/${p.id}/${att.id}`;
      const encodedName = encodeURIComponent(att.name);
      const asciiFallback = att.name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'attachment';
      const commonHeaders: Record<string, string> = {
        'Content-Type': att.type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`,
      };

      if (!hasCustomBucketBinding()) {
        const safeFile = resolveLocalBucketPath(bucketKey);
        try {
          const stat = await fs.promises.stat(safeFile);
          commonHeaders['Content-Length'] = String(stat.size);
          if (stat.size === 0) {
            return new Response(new Uint8Array(0), { status: 200, headers: commonHeaders });
          }
          const webStream = Readable.toWeb(fs.createReadStream(safeFile)) as ReadableStream;
          return new Response(webStream, { status: 200, headers: commonHeaders });
        } catch {}
      }

      const obj = await bindings().BUCKET.get(bucketKey);
      const buf = obj ? await obj.arrayBuffer() : new TextEncoder().encode('').buffer;
      return new Response(buf, { status: 200, headers: commonHeaders });
    }

    throw new Error('INVALID_INPUT');
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: Request) {
  try {
    const user = await owner(request);
    const url = new URL(request.url);
    const contentType = request.headers.get('content-type') || '';
    const isMultipart = contentType.toLowerCase().includes('multipart/form-data');

    let id = (url.searchParams.get('id') || '').trim();
    let name = url.searchParams.get('name') || '';
    let explicitRole = url.searchParams.get('role') as AttachmentRole | null;
    let fileType = contentType || 'application/octet-stream';

    if (explicitRole && !['source', 'locked', 'setting', 'reference'].includes(explicitRole)) {
      throw new Error('INVALID_INPUT');
    }

    const contentLenHeader = Number(request.headers.get('content-length') || 0);
    let p: Project | null = null;
    if (id) {
      p = await getProject(id, user);
      const earlyMaxBytes = getMaxUploadBytes(p.kind);
      if (
        Number.isFinite(contentLenHeader) &&
        contentLenHeader > 0 &&
        contentLenHeader > (isMultipart ? earlyMaxBytes + 1024 * 1024 : earlyMaxBytes)
      ) {
        throw new Error('FILE_TOO_LARGE');
      }
    }

    const attId = crypto.randomUUID();
    let uploadedBytes = 0;

    if (isMultipart) {
      const formData = await request.formData().catch(() => null);
      if (!formData) throw new Error('INVALID_INPUT');
      if (!id) id = String(formData.get('id') || '').trim();
      if (!id) throw new Error('INVALID_INPUT');
      if (!explicitRole && formData.get('role')) {
        explicitRole = String(formData.get('role')).trim() as AttachmentRole;
      }
      if (explicitRole && !['source', 'locked', 'setting', 'reference'].includes(explicitRole)) {
        throw new Error('INVALID_INPUT');
      }
      const fileEntry = formData.get('file');
      if (!fileEntry || typeof fileEntry === 'string' || typeof (fileEntry as any).arrayBuffer !== 'function') {
        throw new Error('INVALID_INPUT');
      }
      if (!p) p = await getProject(id, user);
      const maxBytes = getMaxUploadBytes(p.kind);
      const uploadedFile = fileEntry as File;
      const formName = String(formData.get('name') || '').trim();
      name = sanitizeAttachmentName(name || formName || uploadedFile.name || '未命名素材');
      fileType = uploadedFile.type || 'application/octet-stream';
      validateUploadType(name, fileType, p.kind);
      if (uploadedFile.size > maxBytes) throw new Error('FILE_TOO_LARGE');

      const bucketKey = `${user}/${p.id}/${attId}`;
      const fileStream = typeof uploadedFile.stream === 'function' ? uploadedFile.stream() : null;
      if (!hasCustomBucketBinding() && fileStream) {
        uploadedBytes = await streamToDiskWithLimit(fileStream, resolveLocalBucketPath(bucketKey), maxBytes);
      } else {
        const ab = await uploadedFile.arrayBuffer();
        if (ab.byteLength > maxBytes) throw new Error('FILE_TOO_LARGE');
        uploadedBytes = ab.byteLength;
        await bindings().BUCKET.put(bucketKey, ab);
      }
    } else {
      if (!id) throw new Error('INVALID_INPUT');
      if (!p) p = await getProject(id, user);
      const maxBytes = getMaxUploadBytes(p.kind);
      if (Number.isFinite(contentLenHeader) && contentLenHeader > maxBytes) {
        throw new Error('FILE_TOO_LARGE');
      }
      name = sanitizeAttachmentName(name || '未命名素材');
      validateUploadType(name, fileType, p.kind);
      const bucketKey = `${user}/${p.id}/${attId}`;
      if (!hasCustomBucketBinding()) {
        uploadedBytes = await streamToDiskWithLimit(request.body, resolveLocalBucketPath(bucketKey), maxBytes);
      } else {
        const bytes = await readStreamToBufferWithLimit(request.body, maxBytes);
        uploadedBytes = bytes.byteLength;
        await bindings().BUCKET.put(bucketKey, bytes);
      }
    }

    let episode = p.kind === 'transcribe' ? detectEpisodeFromName(name) : undefined;
    // Prevent duplicate auto-assigned episode numbers
    if (episode !== undefined && p.attachments.some((a) => a.episode === episode)) {
      episode = undefined;
    }
    if (episode !== undefined && p.total !== null && episode > p.total) {
      episode = undefined;
    }

    const role = explicitRole || detectRoleFromName(name, p.kind);
    const attachment = {
      id: attId,
      name,
      size: uploadedBytes,
      type: fileType,
      role,
      episode,
      uploadedAt: new Date().toISOString(),
    };
    p.attachments.push(attachment);

    if (p.kind === 'transcribe') {
      if (episode !== undefined) {
        message(p, 'director', `已归档素材「${name}」，自动识别为第 ${episode} 集（可在右侧素材栏随时修改）。`);
      } else {
        message(p, 'director', `已归档素材「${name}」，未能从文件名确定唯一集号，请在下方「补录或核对素材集号」卡片中填写第几集。`);
      }
    } else {
      const roleText = role === 'locked' ? '前序锁定稿（一字不动）' : role === 'setting' ? '设定与参考资料' : '原稿素材';
      message(p, 'director', `已归档「${name}」（用途：${roleText}，可在右侧素材栏切换用途）。`);
    }

    return Response.json(await saveProject(p, user));
  } catch (e) {
    return failure(e);
  }
}
