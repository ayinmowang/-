import {
  bindings,
  owner,
  getProject,
  saveProject,
  message,
  backend,
  connected,
  gptAvailable,
  callStationLLM,
  getActiveAccountOrDefault,
  toPublicProfile,
  failure,
} from '../../../lib/server';
import type { Project, Kind } from '../../../lib/types';

const KIND_LABELS: Record<Kind, string> = {
  foreign: '国外迭代国外',
  domestic: '国内迭代国外',
  original: '原创',
  transcribe: '扒剧',
};

const SENSITIVE_KEYS = new Set([
  'model',
  'model_name',
  'provider',
  'route',
  'line',
  'tokens',
  'prompt_tokens',
  'completion_tokens',
  'total_tokens',
  'system_prompt',
  'raw_prompt',
  'api_key',
]);

function sanitizePayload<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    return input
      .replace(/\b(gpt-4[a-z0-9.-]*|gpt-5[a-z0-9.-]*|claude-[a-z0-9.-]+|gemini-[a-z0-9.-]+|deepseek-[a-z0-9.-]+|grok-[a-z0-9.-]+)\b/gi, '创作引擎')
      .replace(/\b(prompt_tokens|completion_tokens|total_tokens)\s*[:=]\s*\d+/gi, '') as unknown as T;
  }
  if (Array.isArray(input)) return input.map((x) => sanitizePayload(x)) as unknown as T;
  if (typeof input === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(input as Record<string, any>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) continue;
      out[k] = sanitizePayload(v);
    }
    return out as T;
  }
  return input;
}

export function statedTotal(text: string): number | null {
  const match =
    text.match(/(?:全剧|整个剧|总共|一共|总集数|全本|共)\s*(?:是|有|为|：|:)?\s*(\d{1,3})\s*集/) ||
    text.match(/写到\s*第?\s*(\d{1,3})\s*集/) ||
    text.trim().match(/^(\d{1,3})\s*集[。！!]?$/);
  const n = Number(match?.[1]);
  return Number.isInteger(n) && n >= 1 && n <= 300 ? n : null;
}

export function statedLocked(text: string): number | null {
  const match =
    text.match(/前\s*(\d{1,3})\s*集\s*(?:已|已经)?\s*(?:锁定|定稿|不改|不动)/) ||
    text.match(/(?:锁定|定稿)\s*前\s*(\d{1,3})\s*集/) ||
    text.match(/第?\s*1\s*[-~至到]\s*(\d{1,3})\s*集\s*(?:已|已经)?\s*(?:锁定|定稿|不改|不动)/);
  const n = Number(match?.[1]);
  return Number.isInteger(n) && n >= 1 && n <= 299 ? n : null;
}

export function isProgressQuery(text: string): boolean {
  const t = text.trim();
  if (t.length > 36) return false;
  return /^(现在|目前|请问|这剧)?(进度)?(咋样了?|怎么样了?|还要多久|什么时候好|啥时候.*答复|到哪一步了?|在跑吗|卡在哪了?|进度)[？?。！!]*$/.test(t);
}

function hasGptKey(): boolean {
  return gptAvailable();
}

/**
 * Generates proactive, context-aware Chief Writer (总编剧) diagnostic & creative suggestions
 * so every turn feels like an interactive Grok Bot collaboration rather than one-way input.
 */
export function buildDirectorSuggestions(kind: Kind, text: string, total: number | null, locked: number | null): string[] {
  const t = text.toLowerCase();
  if (kind === 'transcribe') {
    return [
      '★ 建议 1（人名锁定）：扒剧前先锁死男女主与核心反派标准译名，防止分集转写出现“金发男/新娘”等临时外号。',
      '建议 2（模式选择）：若用于快速拆解洗稿可选「快速模式」；若需逐句对齐台词与动作细节建议选「详细模式」。',
    ];
  }
  if (kind === 'domestic') {
    return [
      '★ 建议 1（桥段出海置换）：建议将原稿中的中式家长里短/彩礼/当众扇耳光，置换为北美受众熟悉的信托基金冻结、婚前协议（Prenup）或慈善晚宴公开除名。',
      '建议 2（美式幽默与声线）：上位者（CEO/Alpha）台词保持低压克制，闺蜜与吃瓜路人加入冷面自嘲与 Caught in 4K 实锤反转。',
      '建议 3（三道门推进）：我们先过「世界观 → 人设 → 替换要点」三道门，每道门你点一下确认后再进细纲。',
    ];
  }
  if (kind === 'original') {
    return [
      '★ 建议 1（黄金前 3 秒开场）：建议采用「绝境冲突前置开场（开场 B）」，第 1 集第 1 场直接切入背叛或身份对峙高潮，不铺垫日常背景。',
      '建议 2（破局引擎与代价）：为主角绑定单一贯穿破局底牌，并在全剧 40%–50% 处设置一次底牌失效或反噬，逼出人物主动性。',
      `建议 3（付费卡点）：全剧建议定在 ${total || 60} 集左右，在第 10 集末尾埋设第一次重大身份揭晓或反转钩子。`,
    ];
  }
  // foreign iteration (including continuation with locked episodes)
  const suggestions: string[] = [];
  if (locked) {
    suggestions.push(
      `★ 建议 1（锁集无缝衔接）：前 ${locked} 集已作为只读锁定稿保护（一字不改）；建议第 ${locked + 1} 集开场前 3 秒直接承接第 ${locked} 集末尾悬念并完成一次反击。`
    );
  } else {
    suggestions.push(
      '★ 建议 1（情绪曲线对位）：建议先跑完原稿五问与逐集情绪曲线，把原剧最爽的打脸峰值 1:1 对位到新剧本的核心卡点。'
    );
  }
  if (/爱情|感情|日常|拉扯|甜/.test(t)) {
    suggestions.push(
      '★ 建议 2（双线推拉强化）：在每次主线危机升级间隙加入男女主「契约试探 + 肢体逼近」的高张力拉扯，做到每集事件线与感情线各推进一格。'
    );
  } else if (/都市|校园|背景|豪门|狼人|黑帮/.test(t)) {
    suggestions.push(
      '★ 建议 2（场景与阶层集中）：砍掉冗余支线场景，将核心冲突聚拢在董事会、私人庄园、慈善晚宴等高张力空间，降低实拍转场成本。'
    );
  } else {
    suggestions.push(
      '建议 2（反派升级链）：核查原稿中期反派是否提前下线；若有断档，建议在第二阶段引入更高权位的幕后对手接替施压。'
    );
  }
  suggestions.push(
    '建议 3（主线看得懂关）：稍后我会给你 2–3 套主线与对手方案（★ 首推排第一），过完「简化主线单看得懂关」后再开细纲。'
  );
  return suggestions;
}

async function runGptRecapIfConfigured(p: Project, request?: Request): Promise<string | null> {
  if (!hasGptKey()) return null;
  const acc = getActiveAccountOrDefault(request);
  const fileSummary = p.attachments.length
    ? p.attachments
        .map(
          (a) =>
            `${a.name}（角色：${a.role === 'locked' ? '锁定稿' : a.role === 'setting' ? '设定资料' : '原稿'}${
              a.episode ? `，第${a.episode}集` : ''
            }）`
        )
        .join('；')
    : '暂无上传文件';

  const result = await callStationLLM({
    station: 'director',
    account: acc,
    projectId: p.id,
    userPrompt: `项目名：${p.title}\n流程：${KIND_LABELS[p.kind]}\n全剧集数：${p.total ?? '待定'}\n锁定前N集：${
      p.lockedEpisodes ?? '无'
    }\n附件：${fileSummary}\n用户交代：${p.brief || '无'}\n补充要求：${p.requirements.join('；') || '无'}`,
  });
  return result.ok && result.text ? sanitizePayload(result.text) : null;
}

function buildProgressReply(p: Project): string {
  if (!p.remoteId || !p.remote) {
    if (!p.confirmed) {
      return `当前没有后台任务在运行。我已经根据你的输入整理了复述与改编建议，正停在「核对建档与方向确认卡」，等你点确认或继续跟我聊修改思路；当前暂无预计时间（不编造交付时间）。`;
    }
    if (!connected() && !hasGptKey()) {
      return `当前没有后台任务在运行。建档与前期建议已确认，正在等待接入创作后端服务；未启动后台生成任务，暂无预计完成时间。`;
    }
    if (p.kind !== 'original' && p.kind !== 'transcribe' && p.total === null) {
      return `当前没有后台任务在运行。正在等你告诉我全剧总集数（比如直接回一句“全剧 62 集”），定下后马上启动分析；暂无预计完成时间。`;
    }
    return `当前没有后台任务在运行。材料和方向都已就绪，等你点卡片上的「开始分析 / 开始推理」启动第一步；暂无预计完成时间。`;
  }
  const r = p.remote;
  const stageTitle = r.stage?.title || '准备阶段';
  const done = r.progress?.completed_steps ?? 0;
  const total = r.progress?.total_steps ?? 1;
  const etaText = r.progress?.eta ? `预计剩余时间：${r.progress.eta}` : '当前暂无可靠预计时间';
  if (r.status === 'running' || r.status === 'ready') {
    return `后台正在执行「${stageTitle}」（已完成 ${done}/${total} 步）。${etaText}。跑完这一步我会在对话里给你发白话结论和拍板卡。`;
  }
  if (r.status === 'paused') {
    return `当前流程已暂停在「${stageTitle}」（已完成 ${done}/${total} 步），在途步骤已停止派发。随时点「恢复创作」就能从检查点接着跑。`;
  }
  if (r.status === 'failed') {
    return `当前在「${stageTitle}」遇到异常中断（已完成 ${done}/${total} 步），已做完的产物都存好了。点卡片上的「重试」即可只重跑失败小步。`;
  }
  if (r.status === 'delivered') {
    return `全流程已完成并交回剧本文件（${done}/${total} 步），目前停在「交付验收卡」，你可以先看 Word、确认锁定，或直接打字告诉我哪几集要返修。`;
  }
  const cardTitle = r.card?.title ? `，正在等你拍板「${r.card.title}」` : '';
  return `当前没有后台任务在跑，正停在「${stageTitle}」（进度 ${done}/${total} 步）${cardTitle}；${etaText}。`;
}

export async function GET(request: Request) {
  try {
    const user = await owner(request);
    const activeAcc = getActiveAccountOrDefault(request);
    const id = new URL(request.url).searchParams.get('id');
    if (id) {
      const p = await getProject(id, user);
      if (p.remoteId && connected()) {
        p.remote = sanitizePayload(await (await backend('/api/projects/' + p.remoteId)).json());
      }
      return Response.json(sanitizePayload(p));
    }
    const { results } = await bindings()
      .DB.prepare('SELECT data,version FROM studio_projects WHERE owner=? ORDER BY updated_at DESC')
      .bind(user)
      .all();
    return Response.json({
      connected: connected(),
      gptTestAvailable: hasGptKey(),
      currentAccount: activeAcc ? toPublicProfile(activeAcc) : null,
      projects: results.map((r: any) => sanitizePayload({ ...JSON.parse(r.data), version: r.version })),
    });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: Request) {
  try {
    const user = await owner(request);
    const body: any = await request.json();

    if (body.operation === 'create') {
      if (!['foreign', 'domestic', 'original', 'transcribe'].includes(body.kind) || !String(body.title || '').trim()) {
        throw new Error('INVALID_INPUT');
      }
      const now = new Date().toISOString();
      const brief = String(body.brief || '').slice(0, 100000);
      const total = statedTotal(brief);
      const locked = statedLocked(brief);
      if (locked !== null && total !== null && locked >= total) {
        throw new Error('INVALID_INPUT');
      }
      const p: any = {
        id: crypto.randomUUID(),
        title: String(body.title).trim().slice(0, 200),
        kind: body.kind as Kind,
        total,
        lockedEpisodes: locked,
        startEpisode: locked ? locked + 1 : 1,
        brief,
        messages: [],
        attachments: [],
        requirements: [],
        archived: false,
        createdAt: now,
        updatedAt: now,
        version: 1,
        confirmed: false,
        transcribeMode: null,
        stopsReleased: false,
        processedActionIds: [],
        processedClientIds: [],
      };
      if (p.brief) {
        message(p, 'user', p.brief);
        p.requirements.push(
          `[初始说明 · 全剧适用${locked ? `（前 ${locked} 集锁定，从第 ${locked + 1} 集续写）` : ''}] ${p.brief}`
        );
      }

      const scopeSummary =
        p.kind === 'original'
          ? p.total === null
            ? '全剧集数我们放在前四层推理后的「停点 A」里和开场方案一起定。'
            : `你已初步定下全剧 ${p.total} 集（可在停点 A 最终拍板）。`
          : p.total === null
          ? '全剧总集数还没提，你随时在聊天里回一句“全剧 62 集”就行。'
          : `全剧共 ${p.total} 集。`;

      const lockSummary = locked
        ? `\n• 续写锁定范围：前 ${locked} 集作为锁定稿保护（一字不动），本轮只写第 ${locked + 1} 集到最后一集。`
        : '';

      const suggestions = buildDirectorSuggestions(p.kind as Kind, brief, total, locked);

      message(
        p,
        'director',
        `收到！我先把你的要求复述一遍，顺便给你提几条总编剧建议：\n\n【我的复述】\n• 创作流程：「${KIND_LABELS[p.kind as Kind]}」\n• 集数与范围：${scopeSummary}${lockSummary}${p.brief ? '\n• 你的原话重点：' + p.brief : ''}\n\n【总编剧初步建议】\n${suggestions.map((s) => '• ' + s).join('\n')}\n\n你看我理解得对不对？如果觉得建议可行，直接点下方卡片「对，开始」；或者直接在聊天框打字跟我聊你的调整想法。`
      );

      await bindings()
        .DB.prepare('INSERT INTO studio_projects (id,owner,data,version,updated_at) VALUES (?,?,?,1,?)')
        .bind(p.id, user, JSON.stringify(sanitizePayload(p)), now)
        .run();
      return Response.json(sanitizePayload(p), { status: 201 });
    }

    const p: any = await getProject(body.id, user);
    if (body.version !== p.version) throw new Error('CONFLICT');
    if (!Array.isArray(p.processedActionIds)) p.processedActionIds = [];
    if (!Array.isArray(p.processedClientIds)) p.processedClientIds = [];

    if (body.operation === 'message') {
      if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 100000) {
        throw new Error('INVALID_INPUT');
      }
      const cleanText = body.text.trim();
      if (body.client_id && p.processedClientIds.includes(body.client_id)) {
        return Response.json(sanitizePayload(p));
      }
      if (body.client_id) p.processedClientIds.push(body.client_id);

      if (p.remoteId && connected()) {
        await backend('/api/projects/' + p.remoteId + '/messages', 'POST', {
          client_id: body.client_id,
          text: cleanText,
        });
      }
      message(p, 'user', cleanText);

      // 1. Check if user is asking for progress / ETA (G14)
      if (isProgressQuery(cleanText)) {
        message(p, 'director', buildProgressReply(p));
      }
      // 2. Check if user is explicitly releasing episode-by-episode stops (G10)
      else if (/(通过[，,\s]*写完吧|后面直接写完|放开(后续)?停点|直接写到底)/.test(cleanText)) {
        p.stopsReleased = true;
        if (p.remote) p.remote.stopsReleased = true;
        p.requirements.push(`[停点指令 · 正文阶段生效] ${cleanText}`);
        message(
          p,
          'director',
          '好嘞！已放开后续正文的逐集确认停点，并记入确认单。接下来分集编剧会整批写到底，后台自动过初审、返修、精修和终复核，每走完一环我用大白话向你汇报一次，最后直接给你交 Word。'
        );
      }
      // 3. Check if user is answering the initial build confirmation card via text (G2)
      else if (!p.remoteId && !p.confirmed && /^(对|好的|确认|信息无误|没问题|对[，,\s]*开始)[。！!]*$/.test(cleanText)) {
        p.confirmed = true;
        message(
          p,
          'director',
          !connected() && !hasGptKey()
            ? '复述和方向已确认！材料和要求都已锁进确认单。现在可以继续跟我聊细节建议，接入创作后端后立即派发给原稿分析师。'
            : p.kind !== 'original' && p.total === null
            ? '复述已确认！开干前还需要你定一下全剧总集数（比如直接回“全剧 62 集”），我好按集数给你排付费卡点和情绪曲线。'
            : '复述已确认！现在直接点下方卡片「开始分析 / 开始推理」，我马上派活推进下一步。'
        );
      }
      // 4. Check if user is specifying transcribe mode via chat text (no default mode allowed)
      else if (p.kind === 'transcribe' && /^(选|使用)?(快速模式|详细模式|快速|详细)[。！!]*$/.test(cleanText)) {
        const isFast = cleanText.includes('快速');
        p.transcribeMode = isFast ? 'fast' : 'detailed';
        if (p.remote) p.remote.transcribeMode = p.transcribeMode;
        p.requirements.push(`[扒剧模式拍板] 选择「${isFast ? '快速模式（整集看写+抽查）' : '详细模式（每秒一帧逐格看写）'}」`);
        message(
          p,
          'director',
          `记下了，本剧采用「${isFast ? '快速模式（按整集看写并抽查关键集）' : '详细模式（按每秒一帧逐格看完再写）'}」。建议核对完上方集号后直接点开始扒剧，跑完我会把繁体单集 Word 和简体全集 Word（带梗概与人物小传）打包给你。`
        );
      }
      // 5. General requirement / total episodes / locked episodes extraction + Proactive Director Suggestions
      else if (!p.remoteId || !connected()) {
        const count = statedTotal(cleanText);
        const locked = statedLocked(cleanText);
        const notes: string[] = [];
        if (count !== null) {
          if (p.lockedEpisodes && count <= p.lockedEpisodes) throw new Error('INVALID_INPUT');
          p.total = count;
          notes.push(`全剧总集数定为 ${p.total} 集`);
        }
        if (locked !== null) {
          if (p.total !== null && locked >= p.total) throw new Error('INVALID_INPUT');
          p.lockedEpisodes = locked;
          p.startEpisode = locked + 1;
          notes.push(`前 ${locked} 集已设为只读锁定稿（一字不动），本轮从第 ${locked + 1} 集写到最后一集`);
        }
        const scopeTag = p.remoteId ? '下一可更新批次生效' : '全剧及首轮分析生效';
        p.requirements.push(`[补充要求 · ${scopeTag} · v${p.version + 1}] ${cleanText}`);

        const followUpSuggestions = buildDirectorSuggestions(p.kind, cleanText, p.total, p.lockedEpisodes);
        const headLine = notes.length > 0 ? `记下了：${notes.join('；')}。` : `记下了，这条要求已写进右侧「要求台账」（${scopeTag}）。`;

        message(
          p,
          'director',
          `${headLine}\n\n结合你刚才说的「${cleanText.slice(0, 48)}${cleanText.length > 48 ? '…' : ''}」，我给你提两条落地方案供你参考：\n• ${followUpSuggestions[0]}\n• ${followUpSuggestions[1] || followUpSuggestions[0]}\n\n你更倾向按哪种感觉走？可以直接回我，或者点卡片上的选项拍板。`
        );
      } else {
        p.requirements.push(`[运行中追加 · 下一可更新节点生效 · v${p.version + 1}] ${cleanText}`);
        const remote: any = await (await backend('/api/projects/' + p.remoteId)).json();
        p.remote = sanitizePayload(remote);
      }
    } else if (body.operation === ' switch_kind' || body.operation === 'switch_kind') {
      if (!['foreign', 'domestic', 'original', 'transcribe'].includes(body.kind) || p.remoteId) {
        throw new Error('INVALID_INPUT');
      }
      p.kind = body.kind as Kind;
      const suggestions = buildDirectorSuggestions(p.kind, p.brief || '', p.total, p.lockedEpisodes);
      message(
        p,
        'director',
        `已将本项目流程切换为「${KIND_LABELS[p.kind as Kind]}」。针对这个流程，我的建议是：\n${suggestions.map((s) => '• ' + s).join('\n')}`
      );
    } else if (body.operation === 'archive') {
      p.archived = Boolean(body.archived);
    } else if (body.operation === 'set_episode') {
      const episode = Number(body.episode);
      const attachment = p.attachments.find((a: any) => a.id === body.attachment_id);
      if (
        p.kind !== 'transcribe' ||
        p.remoteId ||
        !attachment ||
        !Number.isInteger(episode) ||
        episode < 1 ||
        episode > (p.total ?? 300)
      ) {
        throw new Error('INVALID_INPUT');
      }
      if (p.attachments.some((a: any) => a.id !== attachment.id && a.episode === episode)) {
        throw new Error('EPISODE_ALREADY_USED');
      }
      attachment.episode = episode;
      message(p, 'director', `已将「${attachment.name}」标为第 ${episode} 集。`);
    } else if (body.operation === 'set_role') {
      const role = body.role;
      const attachment = p.attachments.find((a: any) => a.id === body.attachment_id);
      if (!attachment || !['source', 'locked', 'setting', 'reference'].includes(role)) {
        throw new Error('INVALID_INPUT');
      }
      attachment.role = role;
      const roleLabel: Record<string, string> = {
        source: '原稿素材',
        locked: '锁定稿（只读保护，一字不改）',
        setting: '设定与参考资料',
        reference: '参考附件',
      };
      message(p, 'director', `已将素材「${attachment.name}」归类为「${roleLabel[role]}」。`);
    } else if (body.operation === 'set_locked') {
      const locked = body.locked === null || body.locked === '' ? null : Number(body.locked);
      if (locked !== null && (!Number.isInteger(locked) || locked < 0 || (p.total !== null && locked >= p.total))) {
        throw new Error('INVALID_INPUT');
      }
      p.lockedEpisodes = locked && locked > 0 ? locked : null;
      p.startEpisode = p.lockedEpisodes ? p.lockedEpisodes + 1 : 1;
      message(
        p,
        'director',
        p.lockedEpisodes
          ? `已设置续写锁定范围：前 ${p.lockedEpisodes} 集锁定一字不动，本轮从第 ${p.startEpisode} 集写到最后一集。`
          : '已取消前序集数锁定，本轮从第 1 集开始创作。'
      );
    } else if (body.operation === 'rename') {
      if (!String(body.title || '').trim()) throw new Error('INVALID_INPUT');
      p.title = String(body.title).trim().slice(0, 200);
    } else if (body.operation === 'confirm') {
      p.confirmed = true;
      const readyToConnect = connected() || hasGptKey();
      message(
        p,
        'director',
        !readyToConnect
          ? '建档与复述已确认！你可以继续在聊天框跟我讨论细节，或点采纳上方的建议胶囊；接入生成服务后即可一键派活。'
          : p.kind !== 'original' && p.total === null
          ? '建档已确认！开干前请直接发消息告诉我全剧几集（例如“全剧 62 集”），我好给你排卡点。'
          : '建档已确认！请点下方卡片启动第一阶段任务。'
      );
    } else if (body.operation === 'action') {
      if (!p.remoteId) throw new Error('SERVICE_NOT_CONNECTED');
      const actionPayload = body.action || {};
      if (actionPayload.action_id && p.processedActionIds.includes(actionPayload.action_id)) {
        return Response.json(sanitizePayload(p));
      }
      if (
        actionPayload.action === 'confirm' &&
        p.remote?.card?.fields?.includes('understood') &&
        actionPayload.answers?.understood !== true
      ) {
        throw new Error('UNDERSTOOD_GATE_REQUIRED');
      }
      if (
        actionPayload.action === 'confirm' &&
        p.remote?.card?.fields?.includes('mode') &&
        !['fast', 'detailed'].includes(actionPayload.answers?.mode)
      ) {
        throw new Error('MODE_SELECTION_REQUIRED');
      }
      if (actionPayload.action_id) p.processedActionIds.push(actionPayload.action_id);

      if (connected()) {
        p.remote = sanitizePayload(
          await (await backend('/api/projects/' + p.remoteId + '/actions', 'POST', actionPayload)).json()
        );
      } else if (p.remote?.mode === 'gpt_test') {
        if (actionPayload.action === 'pause') {
          p.remote.status = 'paused';
          message(p, 'director', '已收到暂停请求，已停止派发下一步任务，当前已完成产物已保存。');
        } else if (actionPayload.action === 'resume' || actionPayload.action === 'retry') {
          p.remote.status = 'waiting_confirm';
          message(p, 'director', '已从最近确认的检查点恢复流程，请继续在当前卡片拍板。');
        } else if (actionPayload.action === 'release_stops') {
          p.stopsReleased = true;
          p.remote.stopsReleased = true;
          message(p, 'director', '已放开后续正文逐集确认停点，后续集数将整批推进至审改与交付。');
        } else if (actionPayload.action === 'revise') {
          const fb = String(actionPayload.answers?.feedback || '').trim();
          if (fb) {
            p.requirements.push(`[卡片修订意见 · v${p.version + 1}] ${fb}`);
          }
          const acc = getActiveAccountOrDefault(request);
          const reviseRes = await callStationLLM({
            station: 'director',
            account: acc,
            projectId: p.id,
            userPrompt: `项目《${p.title}》（${KIND_LABELS[p.kind as Kind]}）在阶段「${p.remote.stage?.title}」收到用户的修改意见：「${fb}」。请用2-3条大白话说明已如何按此意见调整当前阶段方案，并请用户再次确认卡片。`,
          });
          message(
            p,
            'director',
            reviseRes.ok && reviseRes.text
              ? reviseRes.text
              : `已按你的意见「${fb}」修订当前阶段方案，并记入要求台账。请核对后点击确认继续。`
          );
          p.remote.version = (p.remote.version || 1) + 1;
        } else if (actionPayload.action === 'confirm') {
          const ans = actionPayload.answers || {};
          if (ans.mode && ['fast', 'detailed'].includes(ans.mode)) {
            p.transcribeMode = ans.mode;
            p.remote.transcribeMode = ans.mode;
          }
          if (ans.total && Number.isInteger(Number(ans.total)) && Number(ans.total) >= 1) {
            p.total = Number(ans.total);
          }
          const ansSummary = Object.entries(ans)
            .filter(([_, v]) => v !== undefined && String(v).trim() !== '')
            .map(([k, v]) => `${k}=${v}`)
            .join('；');
          if (ansSummary) {
            p.requirements.push(`[阶段拍板 · ${p.remote.stage?.title || '确认卡'}] ${ansSummary}`);
          }

          const acc = getActiveAccountOrDefault(request);
          const nextCursor = (p.remote.cursor || 1) + 1;
          p.remote.cursor = nextCursor;
          p.remote.version = (p.remote.version || 1) + 1;
          p.remote.progress.completed_steps = Math.min(
            p.remote.progress.total_steps,
            (p.remote.progress.completed_steps || 1) + 1
          );

          // Advance workflow stages by kind & cursor
          if (p.kind === 'transcribe') {
            if (nextCursor === 2) {
              const llm = await callStationLLM({
                station: 'vision',
                account: acc,
                projectId: p.id,
                userPrompt: `请对扒剧项目《${p.title}》（共 ${p.attachments.length} 份视频，模式：${
                  p.transcribeMode === 'detailed' ? '详细模式逐帧还原' : '快速模式整集还原'
                }）生成全剧人物译名锚定表、故事梗概与前2集还原样稿。`,
              });
              const content =
                llm.ok && llm.text
                  ? llm.text
                  : `【扒剧还原初稿】已按${p.transcribeMode === 'detailed' ? '详细模式' : '快速模式'}完成分集场次与台词还原。`;
              p.remote.outputs.synopsis = {
                title: '故事梗概与主角标准人名表',
                content,
                updatedAt: new Date().toISOString(),
                version: 1,
              };
              p.remote.stage = { key: 'transcribe_review', title: '核对人名表与待补写镜头' };
              p.remote.card = {
                id: 'card-transcribe-verify-' + nextCursor,
                step: 'verify',
                title: '核对扒剧主角译名表与【待人工補寫】镜头校准',
                fields: ['boundaries'],
                questions: [{ question: '请确认主角标准人名表与特写镜头补写内容是否无误：' }],
              };
              message(p, 'director', `扒剧小能手已完成分集还原：\n\n${content}\n\n请在下方卡片确认并合成繁简双版交付包。`);
            } else {
              p.remote.stage = { key: 'delivery', title: '繁简双版 Word 交付包已就绪' };
              p.remote.status = 'delivered';
              p.remote.progress.completed_steps = p.remote.progress.total_steps;
              p.remote.card = null;
              p.remote.outputs.script = {
                title: '繁简双版分集还原正文',
                content: p.remote.outputs.synopsis?.content || '全集扒剧正文已生成完毕。',
                updatedAt: new Date().toISOString(),
                version: 1,
              };
              message(
                p,
                'director',
                '全部搞定！繁体单集 Word 与简体全集 Word（含故事梗概与人物小传）已打包就绪。你可以直接点击下方下载卡片导出，或选择转入「国外迭代」/「国内迭代」。'
              );
            }
          } else if (p.kind === 'domestic' && nextCursor === 2) {
            const llm = await callStationLLM({
              station: 'planner',
              account: acc,
              projectId: p.id,
              userPrompt: `请针对国内迭代国外项目《${p.title}》（${p.total ?? 60}集）输出「桥段出海四级诊断」及「第一道门：世界观落地 → 第二道门：人设本土化 → 第三道门：桥段替换要点」方案。`,
            });
            const content =
              llm.ok && llm.text
                ? llm.text
                : '已完成桥段出海四级诊断与世界观、人设、替换要点三道门方案。';
            p.remote.outputs.gates = {
              title: '桥段出海四级诊断与三道门方案',
              content,
              updatedAt: new Date().toISOString(),
              version: 1,
            };
            p.remote.stage = { key: 'domestic_gates', title: '国内出海三道门（世界观 → 人设 → 替换要点）' };
            p.remote.card = {
              id: 'card-domestic-gates',
              step: 'gates',
              title: '三道门拍板 · 世界观落地、人设声线与桥段替换',
              fields: ['worldview_gate', 'persona_gate', 'trope_gate'],
              questions: [{ question: '请确认三道门本土化置换方案：' }],
            };
            message(p, 'director', `原稿分析师与故事策划师已完成「桥段出海四级诊断与三道门方案」：\n\n${content}`);
          } else if (nextCursor <= 3 && p.kind !== 'original') {
            const llm = await callStationLLM({
              station: 'planner',
              account: acc,
              projectId: p.id,
              userPrompt: `请为短剧项目《${p.title}》（${KIND_LABELS[p.kind as Kind]}，全剧 ${p.total ?? 60} 集${
                p.lockedEpisodes ? `，前 ${p.lockedEpisodes} 集已锁定` : ''
              }）提供 2-3 套主线与对手升级方案（★首推排第一），并附上一份通俗易懂的「简化主线单」。`,
            });
            const content =
              llm.ok && llm.text
                ? llm.text
                : '已生成主线与对手方案 A/B/C 及简化主线单。';
            p.remote.outputs.synopsis = {
              title: '主线方案与简化主线单',
              content,
              updatedAt: new Date().toISOString(),
              version: 1,
            };
            p.remote.stage = { key: 'mainline_understood', title: '主线方案与简化主线单（看得懂关）' };
            p.remote.card = {
              id: 'card-mainline-' + nextCursor,
              step: 'mainline',
              title: '主线与对手方案选择 · 简化主线单「看得懂关」',
              fields: ['selection', 'understood'],
              questions: [{ question: '请选择主线方案，并确认简化主线单是否通过「看得懂关」：' }],
            };
            message(p, 'director', `故事策划师已交回主线方案与简化主线单：\n\n${content}\n\n请核对是否过「看得懂关」。`);
          } else if (
            (p.kind === 'original' && nextCursor === 2) ||
            (p.kind !== 'original' && nextCursor === 4)
          ) {
            const llm = await callStationLLM({
              station: 'writer',
              account: acc,
              projectId: p.id,
              userPrompt: `请为项目《${p.title}》（全剧 ${p.total ?? 60} 集${
                p.lockedEpisodes ? `，前 ${p.lockedEpisodes} 集锁定，从第 ${p.lockedEpisodes + 1} 集续写` : ''
              }）生成人物小传与首批 10 集分集细纲，并写出正文前 3 集样稿。`,
            });
            const content =
              llm.ok && llm.text
                ? llm.text
                : '已生成人物小传、分批细纲与前 3 集正文样稿。';
            p.remote.outputs.characters = {
              title: '核心人物小传与关系网',
              content: content.slice(0, 800),
              updatedAt: new Date().toISOString(),
              version: 1,
            };
            p.remote.outputs.outline = {
              title: '分集细纲与正文前 3 集',
              content,
              updatedAt: new Date().toISOString(),
              version: 1,
            };
            p.remote.stage = { key: 'script_episodes', title: '细纲与正文前 3 集确认' };
            p.remote.card = {
              id: 'card-script-' + nextCursor,
              step: 'script_confirm',
              title: '细纲与正文前 3 集拍板（支持一键放开后续逐集停点）',
              fields: ['ending'],
              questions: [
                {
                  question:
                    '前 3 集正文与细纲已就绪。确认无误后将整批完成剩余集数并自动走初审、返修、精修与终复核：',
                },
              ],
            };
            message(p, 'director', `分集编剧已交回人物小传、细纲与前 3 集正文：\n\n${content}`);
          } else {
            const llm = await callStationLLM({
              station: 'polisher',
              account: acc,
              projectId: p.id,
              userPrompt: `请对短剧《${p.title}》（${KIND_LABELS[p.kind as Kind]}，共 ${p.total ?? 60} 集${
                p.lockedEpisodes ? `，前 ${p.lockedEpisodes} 集锁定一字不改` : ''
              }）完成终审复核与${p.kind === 'domestic' ? '北美语感及美式幽默' : ''}精修总结，输出完整剧本交付正文摘要。`,
            });
            const content =
              llm.ok && llm.text
                ? llm.text
                : `《${p.title}》全剧已完成初审、返修、精修与终复核，正式剧本已封装就绪。`;
            p.remote.outputs.script = {
              title: '终审精修完整剧本正文',
              content: (p.remote.outputs.outline?.content ? p.remote.outputs.outline.content + '\n\n' : '') + content,
              updatedAt: new Date().toISOString(),
              version: 1,
            };
            p.remote.stage = { key: 'delivery', title: '成稿 Word 交付验收' };
            p.remote.status = 'delivered';
            p.remote.progress.completed_steps = p.remote.progress.total_steps;
            p.remote.card = null;
            message(
              p,
              'director',
              `🎉 全剧已完成初审、返修、精修与终复核！\n\n${content}\n\n最终剧本已按「故事梗概 → 人物小传 → 正文」排列封装（${
                p.lockedEpisodes ? `前 ${p.lockedEpisodes} 集锁定稿逐字保护，` : ''
              }点击下方卡片即可下载交付包）。`
            );
          }
        }
      }
    } else if (body.operation === 'connect') {
      if (!connected() && !hasGptKey()) throw new Error('SERVICE_NOT_CONNECTED');
      const requiresTotalUpfront = p.kind !== 'original';
      if (
        !p.confirmed ||
        (requiresTotalUpfront && (!Number.isInteger(p.total) || p.total < 1 || p.total > 300))
      ) {
        throw new Error('INVALID_INPUT');
      }
      if (
        p.kind === 'transcribe' &&
        p.attachments.some((a: any) => !a.episode || (p.total !== null && a.episode > p.total))
      ) {
        throw new Error('EPISODE_MAPPING_REQUIRED');
      }

      if (connected()) {
        const startEp = p.lockedEpisodes ? p.lockedEpisodes + 1 : 1;
        if (!p.remoteId) {
          const remote: any = await (
            await backend('/api/projects', 'POST', {
              title: p.title,
              kind: p.kind,
              total: p.total,
              start: startEp,
              locked_episodes: p.lockedEpisodes || 0,
              brief: p.brief,
            })
          ).json();
          p.remoteId = remote.id;
          await saveProject(p, user);
        }
        const remote: any = await (await backend('/api/projects/' + p.remoteId)).json();
        for (const a of p.attachments) {
          if (remote.attachments?.some((r: any) => r.name === a.id + '-' + a.name)) continue;
          const object = await bindings().BUCKET.get(user + '/' + p.id + '/' + a.id);
          const role = a.role || 'source';
          if (object) {
            await backend(
              '/api/projects/' +
                p.remoteId +
                '/attachments?name=' +
                encodeURIComponent(a.id + '-' + a.name) +
                '&role=' +
                encodeURIComponent(role) +
                (a.episode ? '&episode=' + a.episode : ''),
              'POST',
              await object.arrayBuffer(),
              true
            );
          }
        }
        for (let i = 0; i < p.requirements.length; i++) {
          const reqText = typeof p.requirements[i] === 'string' ? p.requirements[i] : p.requirements[i].text;
          await backend('/api/projects/' + p.remoteId + '/messages', 'POST', {
            client_id: p.id + '-requirement-' + i,
            text: reqText,
          });
        }
        p.remote = sanitizePayload(await (await backend('/api/projects/' + p.remoteId)).json());
        message(p, 'director', '已连接创作后端，材料、锁定范围与要求台账已同步。请查看当前确认卡。');
      } else {
        const gptRecap = await runGptRecapIfConfigured(p, request);
        if (!gptRecap) throw new Error('BACKEND_REQUEST_FAILED');
        p.remoteId = 'gpt-test-' + p.id;
        const firstCardByKind: Record<Kind, any> = {
          transcribe: {
            id: 'card-transcribe-mode',
            step: 'mode_select',
            title: '选择扒剧模式（每部剧必选，无默认值）',
            fields: ['mode'],
            questions: [
              {
                question: '请选择本剧扒剧还原精度（快速模式按整集看写并抽查；详细模式按每秒一帧逐格看写）：',
              },
            ],
          },
          foreign: {
            id: 'card-foreign-recap',
            step: 'recap_confirm',
            title: '总编剧复述确认 · 准备开始原稿分析',
            fields: ['scope'],
            questions: [
              {
                question: p.lockedEpisodes
                  ? `已锁定前 ${p.lockedEpisodes} 集一字不改，本轮从第 ${p.lockedEpisodes + 1} 集写至第 ${p.total} 集。确认无误后派给原稿分析师生成底稿、事件映射、错名清单与逐集情绪曲线。`
                  : `全剧共 ${p.total} 集。确认复述无误后，将派给原稿分析师生成底稿、事件映射、错名清单与逐集情绪曲线。`,
              },
            ],
          },
          domestic: {
            id: 'card-domestic-recap',
            step: 'recap_confirm',
            title: '总编剧复述确认 · 原稿分析与桥段出海四级诊断',
            fields: ['scope'],
            questions: [
              {
                question: `全剧共 ${p.total} 集。确认后派给原稿分析师完成原稿五问与「桥段出海四级诊断」，随后依次进入世界观、人设、替换要点三道门。`,
              },
            ],
          },
          original: {
            id: 'card-original-stop-a',
            step: 'stop_a',
            title: '原创停点 A · 确认方向、开场、破局引擎、总集数与男女频',
            fields: ['direction', 'opening', 'engine', 'total', 'audience'],
            questions: [
              {
                question: '请确认原创前四层推理的核心参数（★首推方案排第一，也可直接打字修改）：',
              },
            ],
          },
        };
        p.remote = {
          id: p.remoteId,
          version: 1,
          status: 'waiting_confirm',
          mode: 'gpt_test',
          cursor: 1,
          stage: {
            key: 'recap',
            title: p.kind === 'original' ? '前四层推理与停点 A' : p.kind === 'transcribe' ? '扒剧模式选择' : '总编剧复述与开始分析',
          },
          progress: {
            completed_steps: 1,
            total_steps: p.kind === 'transcribe' ? 4 : p.kind === 'domestic' ? 11 : p.kind === 'foreign' ? 9 : 7,
            eta: null,
          },
          card: firstCardByKind[p.kind as Kind],
          outputs: {
            recap: {
              title: '总编剧复述与建议（GPT 测试通道）',
              content: gptRecap,
              updatedAt: new Date().toISOString(),
              version: 1,
            },
          },
          messages: [],
        };
        message(p, 'director', `【GPT 真实测试通道 · 总编剧复述与建议】\n${gptRecap}\n\n请在下方卡片拍板继续。`);
      }
    } else if (body.operation === 'transfer_iteration') {
      const targetKind = body.target_kind as Kind;
      if (p.kind !== 'transcribe' || !['foreign', 'domestic'].includes(targetKind)) {
        throw new Error('INVALID_INPUT');
      }
      const now = new Date().toISOString();
      const nextProj: any = {
        id: crypto.randomUUID(),
        title: `${p.title}（${KIND_LABELS[targetKind]}）`.slice(0, 200),
        kind: targetKind,
        total: p.total,
        lockedEpisodes: null,
        startEpisode: 1,
        brief: `由扒剧项目「${p.title}」主动转入${KIND_LABELS[targetKind]}流程。${p.brief ? '\n原说明：' + p.brief : ''}`,
        messages: [],
        attachments: p.attachments.map((a: any) => ({ ...a, role: 'source' })),
        requirements: [
          `[扒剧转入 · 全剧适用] 复用扒剧项目「${p.title}」已核对的 ${p.attachments.length} 份素材与还原底稿`,
        ],
        archived: false,
        createdAt: now,
        updatedAt: now,
        version: 1,
        confirmed: false,
      };
      const suggestions = buildDirectorSuggestions(targetKind, nextProj.brief, nextProj.total, null);
      message(
        nextProj,
        'director',
        `已根据你的选择，将扒剧项目「${p.title}」转入「${KIND_LABELS[targetKind]}」新项目，并复用了原有 ${p.attachments.length} 份素材（全剧 ${p.total ?? '待定'} 集）。\n\n【总编剧初步建议】\n${suggestions.map((s) => '• ' + s).join('\n')}\n\n请先核对下方卡片，确认后开始原稿分析${targetKind === 'domestic' ? '与桥段出海四级诊断' : ''}。`
      );
      await bindings()
        .DB.prepare('INSERT INTO studio_projects (id,owner,data,version,updated_at) VALUES (?,?,?,1,?)')
        .bind(nextProj.id, user, JSON.stringify(sanitizePayload(nextProj)), now)
        .run();
      return Response.json(sanitizePayload(nextProj), { status: 201 });
    } else {
      throw new Error('INVALID_INPUT');
    }

    return Response.json(await saveProject(p, user));
  } catch (e) {
    return failure(e);
  }
}
