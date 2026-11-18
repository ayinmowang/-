import { bindings, owner, getProject, saveProject, message, failure } from '../../../lib/server';

export function detectEpisodeFromName(name: string): number | undefined {
  // Strip extension
  const base = name.replace(/\.[^.]+$/, '').trim();
  // Do NOT guess composite scene names like "1-1" or "20261113" or "微信视频2026..."
  if (/^\d+\s*[-_]\s*\d+$/.test(base) || /微信视频|WeChat|\d{6,}/i.test(base)) {
    return undefined;
  }
  const match =
    base.match(/(?:第|^|[_\-\s])0*(\d{1,3})\s*集/) ||
    base.match(/(?:^|[_\-\s])(?:ep|episode)\s*0*(\d{1,3})(?:$|[_\-\s])/i) ||
    base.match(/^0*(\d{1,3})$/);
  const n = Number(match?.[1]);
  return Number.isInteger(n) && n >= 1 && n <= 300 ? n : undefined;
}

export function detectRoleFromName(name: string, kind: string): 'source' | 'locked' | 'setting' {
  if (kind === 'original') return 'setting';
  if (/(锁定|定稿|locked|前\d+集)/i.test(name)) return 'locked';
  if (/(设定|人物|大纲|参考|setting|bible)/i.test(name)) return 'setting';
  return 'source';
}

export async function GET(request: Request) {
  try {
    const user = await owner();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const fileId = url.searchParams.get('file');
    const isExport = url.searchParams.get('export') === '1';
    if (!id) throw new Error('INVALID_INPUT');
    const p = await getProject(id, user);

    if (isExport) {
      // Export structured script document (Synopsis -> Character Bios -> Locked Episodes -> Body)
      const outputs = p.remote?.outputs || {};
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
        outputs.script?.content || outputs.outline?.content || '（待生成剧本正文）',
      ].filter(Boolean);

      return new Response(sections.join('\n\n'), {
        status: 200,
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(p.title)}-完整剧本.md"`,
        },
      });
    }

    if (fileId) {
      const att = p.attachments.find((a) => a.id === fileId);
      if (!att) throw new Error('NOT_FOUND');
      const obj = await bindings().BUCKET.get(`${user}/${p.id}/${att.id}`);
      const buf = obj ? await obj.arrayBuffer() : new TextEncoder().encode('').buffer;
      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': att.type || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(att.name)}"`,
        },
      });
    }

    throw new Error('INVALID_INPUT');
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: Request) {
  try {
    const user = await owner();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const name = url.searchParams.get('name') || '未命名素材';
    const explicitRole = url.searchParams.get('role') as 'source' | 'locked' | 'setting' | null;
    if (!id) throw new Error('INVALID_INPUT');

    const p = await getProject(id, user);
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 20 * 1024 * 1024) throw new Error('FILE_TOO_LARGE');

    const attId = crypto.randomUUID();
    await bindings().BUCKET.put(`${user}/${p.id}/${attId}`, buf);

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
      size: buf.byteLength,
      type: request.headers.get('content-type') || 'application/octet-stream',
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
