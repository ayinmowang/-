import { NextResponse } from 'next/server';

const FORBIDDEN_KEYS = new Set(['model', 'provider', 'route', 'tokens', 'prompt_tokens', 'completion_tokens', 'system_prompt']);

function sanitizePayload(val: any): any {
  if (Array.isArray(val)) return val.map(sanitizePayload);
  if (val && typeof val === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (FORBIDDEN_KEYS.has(k.toLowerCase())) continue;
      out[k] = sanitizePayload(v);
    }
    return out;
  }
  return val;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { action, id, kind = 'transcribe', text = '', mode = '' } = body;

  if (action === 'transcribe' && !mode) {
    return NextResponse.json({ error: '扒剧每部剧必选「快速模式」或「详细模式」，不设默认项。', code: 'TRANSCRIBE_MODE_REQUIRED' }, { status: 400 });
  }

  return NextResponse.json(
    sanitizePayload({
      ok: true,
      id: id || 'proj-' + Date.now(),
      kind,
      action,
      reply: `已处理「${action || 'chat'}」请求：${String(text).slice(0, 60)}`,
      updatedAt: new Date().toISOString(),
    })
  );
}
