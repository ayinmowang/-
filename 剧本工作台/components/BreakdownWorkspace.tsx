'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Clapperboard,
  Download,
  FileText,
  Film,
  Grid,
  List,
  LoaderCircle,
  Plus,
  Search,
  Send,
  Sparkles,
  Upload,
  Zap,
} from 'lucide-react';
import WarmShell from './WarmShell';
import {
  MULTIMODAL_VIDEO_CAP_BYTES,
  describeFallbackLimits,
  extractVideoFramesWithCanvas,
} from '../lib/browser-video-frames';
import { formatCreatorUploadError } from '../lib/upload-error-text';
import {
  classifySourceMaterialName,
  countSourceMaterials,
  formatCoveredEpisodeRange,
  getSourceMaterialAttachments,
  isSourceAttachmentMapped,
  sourceAttachmentEpisodeNumbers,
} from '../lib/source-materials';
import type {
  CreatorPromptCatalog,
  CreatorTierSummary,
  Kind,
  Project,
  PublicAccountProfile,
} from '../lib/types';

type LeftTab = 'materials' | 'characters' | 'synopsis' | 'outline';

async function studioApi(path: string, body?: any) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || 'REQUEST_FAILED');
  return data;
}

function formatBytes(n: number) {
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export default function BreakdownWorkspace() {
  const router = useRouter();
  const [account, setAccount] = useState<PublicAccountProfile | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tierCatalog, setTierCatalog] = useState<CreatorTierSummary[]>([]);
  const [promptCatalog, setPromptCatalog] = useState<CreatorPromptCatalog | null>(null);
  const [active, setActive] = useState<Project | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'video' | 'book'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [ffmpegAvailable, setFfmpegAvailable] = useState<boolean | null>(null);
  const [maxUploadBytes, setMaxUploadBytes] = useState<number | null>(null);
  const [uploadAbortCtrl, setUploadAbortCtrl] = useState<AbortController | null>(null);

  // Create modal
  const [createType, setCreateType] = useState<'video' | 'book' | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newText, setNewText] = useState('');
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);

  // 3-pane state
  const [leftTab, setLeftTab] = useState<LeftTab>('materials');
  const [leftDropOpen, setLeftDropOpen] = useState(false);
  const [selectedMode, setSelectedMode] = useState<'fast' | 'detailed' | ''>('');
  const [epDrafts, setEpDrafts] = useState<Record<string, string>>({});
  const [editorBody, setEditorBody] = useState('');
  const [pageWidthMode, setPageWidthMode] = useState(true);
  const [chatInput, setChatInput] = useState('');
  const [teardownResult, setTeardownResult] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!busy) {
      setElapsedSec(0);
      return;
    }
    const start = Date.now();
    const t = setInterval(() => setElapsedSec(Math.max(1, Math.floor((Date.now() - start) / 1000))), 1000);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  async function refreshList() {
    setLoading(true);
    try {
      const data = await studioApi('/api/studio');
      setAccount(data.currentAccount || null);
      setTierCatalog(data.tierCatalog || []);
      setPromptCatalog(data.promptCatalog || null);
      if (typeof data.ffmpegAvailable === 'boolean') {
        setFfmpegAvailable(data.ffmpegAvailable);
      }
      if (typeof data.maxUploadBytes === 'number' && data.maxUploadBytes > 0) {
        setMaxUploadBytes(data.maxUploadBytes);
      }
      const list: Project[] = (data.projects || []).filter((p: Project) => !p.archived && p.kind === 'transcribe');
      setProjects(list);
    } catch (e: any) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshList();
  }, []);

  function syncActiveProject(p: Project) {
    setActive(p);
    setProjects((prev) => [p, ...prev.filter((x) => x.id !== p.id)]);
    const sortedEpisodes = [...(p.episodes || [])].sort(
      (a, b) => Number(a.episodeNumber || 0) - Number(b.episodeNumber || 0),
    );
    const joinedEpisodes = sortedEpisodes
      .map((ep) => String(ep.body || '').trim())
      .filter(Boolean)
      .join('\n\n');
    const fullScriptBody =
      p.remote?.outputs?.script?.content ||
      joinedEpisodes ||
      p.remote?.outputs?.synopsis?.content ||
      '';
    setEditorBody(fullScriptBody);
  }

  async function openProject(p: Project) {
    setBusy(true);
    setBusyLabel('正在打开拆书 · 扒剧工作台…');
    try {
      const full = await studioApi(`/api/studio?id=${p.id}`);
      if (typeof full.ffmpegAvailable === 'boolean') {
        setFfmpegAvailable(full.ffmpegAvailable);
      }
      if (typeof full.maxUploadBytes === 'number' && full.maxUploadBytes > 0) {
        setMaxUploadBytes(full.maxUploadBytes);
      }
      syncActiveProject(full);
      setSelectedMode(full.transcribeMode || '');
      setTeardownResult('');
    } catch (e: any) {
      setError(e.message || '打开失败');
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  }

  async function uploadToProject(proj: Project, files: File[]): Promise<Project> {
    let cur = proj;
    const ctrl = new AbortController();
    setUploadAbortCtrl(ctrl);
    setError('');
    const hasSubtitleInBatch = files.some((item) => /\.(srt|vtt|ass|txt)$/i.test(item.name));
    const capBytes = typeof maxUploadBytes === 'number' && maxUploadBytes > 0 ? maxUploadBytes : MULTIMODAL_VIDEO_CAP_BYTES;

    try {
      for (let i = 0; i < files.length; i++) {
        if (ctrl.signal.aborted) {
          throw new Error('已取消上传与关键帧提取');
        }
        const f = files[i];
        const isVideo =
          (typeof f.type === 'string' && f.type.startsWith('video/')) ||
          /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(f.name);
        const needCanvasFallback = isVideo && (f.size > MULTIMODAL_VIDEO_CAP_BYTES || ffmpegAvailable === false);

        if (needCanvasFallback) {
          const limitNotes = describeFallbackLimits({
            hasAudioTrack: null,
            hasSubtitleSource: hasSubtitleInBatch,
            ffmpegAvailable,
          });
          setToast(limitNotes.join(' '));
          setBusyLabel(
            `第 ${i + 1}/${files.length} 份 · ${f.name} · 正在用浏览器提取关键帧（${limitNotes[0]}）`,
          );

          const extracted = await extractVideoFramesWithCanvas(f, {
            maxFrames: 10,
            signal: ctrl.signal,
            onProgress: ({ current, total, timestampSec }) => {
              setBusyLabel(
                `第 ${i + 1}/${files.length} 份 · ${f.name} · 浏览器抽帧 ${current}/${total}（${timestampSec.toFixed(1)}s）`,
              );
            },
          });

          const baseStem = f.name.replace(/\.[^.]+$/, '') || 'video';
          for (let k = 0; k < extracted.frames.length; k++) {
            if (ctrl.signal.aborted) {
              throw new Error('已取消上传与关键帧提取');
            }
            const frame = extracted.frames[k];
            if (!frame.blob) continue;
            const frameName = `${baseStem}-kf-${String(k + 1).padStart(2, '0')}-${Math.round(frame.timestampSec * 10)}ds.jpg`;
            setBusyLabel(
              `第 ${i + 1}/${files.length} 份 · ${f.name} · 上传关键帧 ${k + 1}/${extracted.frames.length}`,
            );
            const fr = await fetch(
              `/api/upload?id=${cur.id}&name=${encodeURIComponent(frameName)}&role=setting`,
              {
                method: 'POST',
                headers: { 'Content-Type': frame.blob.type || 'image/jpeg' },
                body: frame.blob,
                signal: ctrl.signal,
              },
            );
            const fData = await fr.json();
            if (!fr.ok) throw new Error(formatCreatorUploadError(fData.message || fData.error || 'KEYFRAME_UPLOAD_FAILED'));
            cur = fData;
            syncActiveProject(cur);
          }

          if (f.size > capBytes) {
            setToast(`${limitNotes.join(' ')}（原视频超出单文件上限，已保留提取的关键帧附件）`);
            continue;
          }
        }

        setBusyLabel(`第 ${i + 1}/${files.length} 份 · ${f.name} · 正在流式上传素材`);
        const r = await fetch(`/api/upload?id=${cur.id}&name=${encodeURIComponent(f.name)}`, {
          method: 'POST',
          headers: { 'Content-Type': f.type || 'application/octet-stream' },
          body: f,
          signal: ctrl.signal,
        });
        const data = await r.json();
        if (!r.ok) throw new Error(formatCreatorUploadError(data.message || data.error || 'UPLOAD_FAILED'));
        cur = data;
        syncActiveProject(cur);
      }
      return cur;
    } catch (err) {
      if (ctrl.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        const msg = '已取消当前上传/抽帧任务';
        setError(msg);
        throw new Error(msg);
      }
      throw err;
    } finally {
      setUploadAbortCtrl((prev) => (prev === ctrl ? null : prev));
    }
  }

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    if (!createType || busy) return;
    const derivedTitle =
      newTitle.trim() ||
      (queuedFiles[0] ? queuedFiles[0].name.replace(/\.[^.]+$/, '').slice(0, 24) : '') ||
      (createType === 'video' ? '新建视频扒剧任务' : '新建拆书分析任务');
    setBusy(true);
    setError('');
    setBusyLabel(createType === 'video' ? '正在建立扒剧任务并上传视频…' : '正在建立拆书任务…');
    try {
      let proj: Project = await studioApi('/api/studio', {
        operation: 'create',
        title: derivedTitle,
        kind: 'transcribe',
        brief: createType === 'book' ? `[拆书分析] ${newText.trim()}` : newText.trim(),
      });
      if (queuedFiles.length > 0) {
        proj = await uploadToProject(proj, queuedFiles);
      }
      syncActiveProject(proj);
      setCreateType(null);
      setNewTitle('');
      setNewText('');
      setQueuedFiles([]);
      setToast('任务已就绪，请核对集号或直接选择模式开始');

      // If book breakdown with pasted text, immediately run teardown tool
      if (createType === 'book' && newText.trim()) {
        setBusyLabel('正在拆解原稿文风、节奏与情绪曲线…');
        const toolRes = await studioApi('/api/studio', {
          operation: 'studio_tool',
          id: proj.id,
          version: proj.version,
          tool: 'teardown',
          sourceName: derivedTitle,
          text: newText.trim(),
        });
        if (toolRes.result) {
          setTeardownResult(toolRes.result);
          setEditorBody(toolRes.result);
        }
        if (toolRes.project) syncActiveProject(toolRes.project);
      }
    } catch (err: any) {
      setError(formatCreatorUploadError(err.message || '建立任务失败'));
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  }

  async function saveEpisodeNum(attId: string) {
    if (!active) return;
    const val = Number(epDrafts[attId]);
    if (!Number.isInteger(val) || val < 1 || val > 300) {
      setError('请输入 1–300 之间的有效集号');
      return;
    }
    setBusy(true);
    setBusyLabel(`正在保存第 ${val} 集集号…`);
    try {
      const updated = await studioApi('/api/studio', {
        operation: 'set_episode',
        id: active.id,
        version: active.version,
        attachment_id: attId,
        episode: val,
      });
      syncActiveProject(updated);
      setEpDrafts((prev) => {
        const next = { ...prev };
        delete next[attId];
        return next;
      });
      setToast(`已更新为第 ${val} 集`);
    } catch (e: any) {
      setError(e.message || '保存集号失败');
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  }

  async function startTranscribeDirect() {
    if (!active || !selectedMode || busy) return;
    setBusy(true);
    setError('');
    try {
      let cur = active;
      if (!cur.confirmed) {
        setBusyLabel('正在确认素材清单…');
        cur = await studioApi('/api/studio', { operation: 'confirm', id: cur.id, version: cur.version });
        syncActiveProject(cur);
      }
      if (!cur.remoteId) {
        setBusyLabel('正在连接扒剧工位…');
        cur = await studioApi('/api/studio', { operation: 'connect', id: cur.id, version: cur.version });
        syncActiveProject(cur);
      }
      setBusyLabel(
        selectedMode === 'detailed'
          ? '扒剧工位正在按「详细模式」逐帧拆解画面、动作与台词，并封装 Word 交付包…'
          : '扒剧工位正在按「快速模式」整集还原场次、动作与台词，并封装 Word 交付包…'
      );
      cur = await studioApi('/api/studio', {
        operation: 'action',
        id: cur.id,
        version: cur.version,
        action: {
          version: cur.remote?.version || 1,
          action_id: crypto.randomUUID(),
          action: 'confirm',
          answers: { mode: selectedMode },
        },
      });
      syncActiveProject(cur);
      setToast('扒剧已完成，规范 Word（.docx）已可直接下载！');
    } catch (e: any) {
      setError(e.message || '扒剧执行未完成，请稍后重试');
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  }

  async function handleTransfer(targetKind: 'foreign' | 'domestic') {
    if (!active || busy) return;
    setBusy(true);
    setBusyLabel(`正在转入「${targetKind === 'foreign' ? '国外迭代' : '国内迭代'}」创作台…`);
    try {
      const nextProj = await studioApi('/api/studio', {
        operation: 'transfer_iteration',
        id: active.id,
        version: active.version,
        target_kind: targetKind,
      });
      setToast('已转入创作台并复用素材');
      router.push(`/studio?id=${nextProj.id}`);
    } catch (e: any) {
      setError(e.message || '转入失败');
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  }

  async function saveEditorBody() {
    if (!active || busy) return;
    setBusy(true);
    setBusyLabel('正在保存当前还原稿…');
    try {
      const updated = await studioApi('/api/studio', {
        operation: 'save_transcript_script',
        id: active.id,
        version: active.version,
        script: editorBody,
      });
      syncActiveProject(updated);
      setToast('已保存修改并生成历史快照');
    } catch (e: any) {
      setError(e.message || '保存失败');
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  }

  async function sendChat() {
    if (!active || !chatInput.trim() || busy) return;
    const text = chatInput.trim();
    setChatInput('');
    setBusy(true);
    setBusyLabel('总编剧正在处理你的说明…');
    try {
      const updated = await studioApi('/api/studio', {
        operation: 'message',
        id: active.id,
        version: active.version,
        text,
        client_id: crypto.randomUUID(),
      });
      syncActiveProject(updated);
    } catch (e: any) {
      setError(e.message || '发送失败');
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  }

  const filteredProjects = projects.filter((p) => {
    const matchesQ = p.title.toLowerCase().includes(query.toLowerCase());
    if (!matchesQ) return false;
    const isBook = p.brief?.startsWith('[拆书分析]');
    if (filterMode === 'book') return isBook;
    if (filterMode === 'video') return !isBook;
    return true;
  });

  const isDelivered = active?.remote?.status === 'delivered' || active?.remote?.stage?.key === 'delivery';
  const hasMissingEp = Boolean(
    getSourceMaterialAttachments(active?.attachments).some((a) => !isSourceAttachmentMapped(a)),
  );
  const leftLabels: Record<LeftTab, string> = {
    materials: '素材与集号',
    characters: '人物锚定表',
    synopsis: '故事梗概',
    outline: '拆解大纲',
  };

  // HALL VIEW (Warm Bookshelf)
  if (!active) {
    return (
      <WarmShell
        activeNav="breakdown"
        title="拆书 · 扒剧"
        subtitle="视频一键扒剧直出规范 Word（.docx）· 原稿拆书提炼文风与情绪曲线"
        account={account}
        authenticated={Boolean(account)}
      >
        <div style={{ width: '100%', maxWidth: 1180, margin: '0 auto', padding: '24px 20px 56px' }}>
          {/* Warm Hero Banner */}
          <div
            style={{
              background: 'linear-gradient(135deg, #FAF5EC 0%, #F2E7D5 100%)',
              border: '1px solid var(--warm-border, #e6dfd3)',
              borderRadius: 20,
              padding: '32px 32px 28px',
              marginBottom: 24,
            }}
          >
            <div style={{ fontSize: 12, letterSpacing: 1.5, opacity: 0.68, marginBottom: 6 }}>
              🎬 VIDEO BREAKDOWN &amp; MANUSCRIPT TEARDOWN
            </div>
            <h1 style={{ fontFamily: 'serif', fontSize: 34, margin: '0 0 8px', color: '#5A2B1D' }}>
              拆书 · 扒剧专区
            </h1>
            <p style={{ margin: '0 0 22px', fontSize: 14, opacity: 0.78 }}>
              上传分集视频不限体积，选好模式直接交付可下载 Word（.docx）；也可上传原稿拆书，一键转入创作台改编迭代。
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setCreateType('video')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '11px 22px',
                  borderRadius: 999,
                  background: '#D49B54',
                  color: '#2C2420',
                  border: 'none',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                <Film size={16} /> + 新建视频扒剧
              </button>
              <button
                type="button"
                onClick={() => setCreateType('book')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '11px 22px',
                  borderRadius: 999,
                  background: '#fff',
                  color: '#2C2420',
                  border: '1px solid #d8cfc0',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                <BookOpen size={16} /> + 新建拆书 / 拆原稿
              </button>
            </div>
          </div>

          {error && (
            <div style={{ padding: 12, borderRadius: 10, background: '#fee2e2', color: '#991b1b', marginBottom: 16 }}>
              {error}
            </div>
          )}

          {/* Filter & Search Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {(
                [
                  ['all', `全部任务 (${projects.length})`],
                  ['video', '🎬 视频扒剧'],
                  ['book', '📖 拆书分析'],
                ] as const
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilterMode(k)}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 999,
                    border: filterMode === k ? '1.5px solid #8C3B2B' : '1px solid var(--warm-border, #e6dfd3)',
                    background: filterMode === k ? 'rgba(140,59,43,0.1)' : 'var(--warm-card, #fff)',
                    color: filterMode === k ? '#8C3B2B' : 'inherit',
                    fontWeight: filterMode === k ? 700 : 500,
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  {lbl}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索扒剧或拆书任务…"
                  style={{
                    padding: '7px 12px 7px 30px',
                    borderRadius: 999,
                    border: '1px solid var(--warm-border, #d8cfc0)',
                    background: 'var(--warm-card, #fff)',
                    fontSize: 13,
                  }}
                />
              </div>
              <button
                type="button"
                aria-label="网格视图"
                onClick={() => setViewMode('grid')}
                style={{
                  padding: 7,
                  borderRadius: 8,
                  border: '1px solid var(--warm-border, #d8cfc0)',
                  background: viewMode === 'grid' ? 'rgba(140,59,43,0.12)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <Grid size={15} />
              </button>
              <button
                type="button"
                aria-label="列表视图"
                onClick={() => setViewMode('list')}
                style={{
                  padding: 7,
                  borderRadius: 8,
                  border: '1px solid var(--warm-border, #d8cfc0)',
                  background: viewMode === 'list' ? 'rgba(140,59,43,0.12)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <List size={15} />
              </button>
            </div>
          </div>

          {/* Task Grid / List */}
          {loading ? (
            <div style={{ padding: 48, textAlign: 'center', opacity: 0.65 }}>正在加载拆书与扒剧任务…</div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: viewMode === 'grid' ? 'repeat(auto-fill, minmax(260px, 1fr))' : '1fr',
                gap: 16,
              }}
            >
              {filteredProjects.map((p) => {
                const done = p.remote?.status === 'delivered';
                return (
                  <div
                    key={p.id}
                    onClick={() => openProject(p)}
                    style={{
                      background: 'var(--warm-card, #fff)',
                      border: '1px solid var(--warm-border, #e6dfd3)',
                      borderRadius: 16,
                      padding: 18,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span
                          style={{
                            fontSize: 11,
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: 'rgba(140,59,43,0.1)',
                            color: '#8C3B2B',
                            fontWeight: 600,
                          }}
                        >
                          {p.brief?.startsWith('[拆书分析]') ? '📖 拆书分析' : '🎬 视频扒剧'}
                        </span>
                        <span style={{ fontSize: 11, color: done ? '#15803d' : '#b45309', fontWeight: 600 }}>
                          {done ? '✓ 已交付 Word' : '待处理'}
                        </span>
                      </div>
                      <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>{p.title}</h3>
                      <div style={{ fontSize: 12, opacity: 0.68 }}>
                        {countSourceMaterials(p.attachments)} 份源素材 · {p.total ? `共 ${p.total} 集` : '集数待定'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid rgba(230,223,211,0.5)' }}>
                      <span style={{ fontSize: 11, opacity: 0.58 }}>
                        {new Date(p.updatedAt).toLocaleDateString('zh-CN')}
                      </span>
                      {done && (
                        <a
                          href={`/api/upload?id=${p.id}&export=docx`}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 12,
                            color: '#8C3B2B',
                            fontWeight: 700,
                            textDecoration: 'none',
                          }}
                        >
                          <Download size={13} /> 下载 Word
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Dashed New Card */}
              <button
                type="button"
                onClick={() => setCreateType('video')}
                style={{
                  minHeight: 150,
                  borderRadius: 16,
                  border: '1.5px dashed #cfc5b4',
                  background: 'transparent',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  color: 'inherit',
                  opacity: 0.78,
                }}
              >
                <Plus size={22} />
                <strong style={{ fontSize: 14 }}>新建扒剧 / 拆书任务</strong>
                <span style={{ fontSize: 12, opacity: 0.7 }}>拖入视频直出规范 Word</span>
              </button>
            </div>
          )}

          {/* Create Modal */}
          {createType && (
            <div
              onClick={() => !busy && setCreateType(null)}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(28, 22, 18, 0.48)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 90,
                padding: 16,
              }}
            >
              <form
                onSubmit={handleCreateTask}
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: '100%',
                  maxWidth: 520,
                  background: 'var(--warm-card, #fff)',
                  borderRadius: 18,
                  padding: 26,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
              >
                <h2 style={{ margin: 0, fontFamily: 'serif', fontSize: 21 }}>
                  {createType === 'video' ? '🎬 新建视频扒剧任务' : '📖 新建拆书 / 拆原稿分析'}
                </h2>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                  任务名称（可留空自动取文件名）
                  <input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder={createType === 'video' ? '如：天降神運重生致富' : '如：爆款女频逆袭原稿拆解'}
                    style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #d8cfc0' }}
                  />
                </label>
                <div>
                  <button
                    type="button"
                    onClick={() => modalFileRef.current?.click()}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '9px 14px',
                      borderRadius: 10,
                      border: '1px dashed #8C3B2B',
                      background: 'rgba(140,59,43,0.06)',
                      color: '#8C3B2B',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    <Upload size={14} />
                    {createType === 'video' ? '选择分集视频 / 字幕（不限大小）' : '上传参考原稿（.docx / .txt / .md）'}
                  </button>
                  <input
                    ref={modalFileRef}
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const list = Array.from(e.target.files || []);
                      if (list.length) setQueuedFiles((prev) => [...prev, ...list]);
                      e.target.value = '';
                    }}
                  />
                  {queuedFiles.length > 0 && (
                    <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                      已选 {queuedFiles.length} 份：{queuedFiles.map((f) => `${f.name} (${formatBytes(f.size)})`).join('、')}
                    </div>
                  )}
                </div>
                {createType === 'book' && (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                    直接粘贴待拆解参考文本（选填）
                    <textarea
                      rows={5}
                      value={newText}
                      onChange={(e) => setNewText(e.target.value)}
                      placeholder="粘贴小说章节或原稿片段，系统将自动提炼情绪曲线、钩子与可执行文风指南…"
                      style={{ padding: 10, borderRadius: 10, border: '1px solid #d8cfc0', fontSize: 13 }}
                    />
                  </label>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setCreateType(null)}
                    style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid #d8cfc0', background: 'transparent', cursor: 'pointer' }}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: '#8C3B2B', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
                  >
                    {busy ? `处理中 (${elapsedSec}s)…` : '进入工作台 →'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </WarmShell>
    );
  }

  // 3-COLUMN BREAKDOWN WORKBENCH (Matches Studio layout)
  return (
    <WarmShell
      activeNav="breakdown"
      title={active.title}
      backHref="/breakdown"
      backLabel="返回拆书·扒剧"
      editableTitle={active.title}
      onRenameTitle={async (nextName) => {
        const u = await studioApi('/api/studio', { operation: 'rename', id: active.id, version: active.version, title: nextName });
        syncActiveProject(u);
      }}
      account={account}
      authenticated={Boolean(account)}
      fullBleed
    >
      <div
        className="v3-three-pane"
        style={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: '240px minmax(0, 1fr) 360px',
          height: 'calc(100vh - 58px)',
          overflow: 'hidden',
        }}
      >
        {/* LEFT COLUMN: Materials / Characters / Synopsis */}
        <aside
          style={{
            borderRight: '1px solid var(--warm-border, #e6dfd3)',
            background: 'var(--warm-sidebar, #f4efe6)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '12px', borderBottom: '1px solid var(--warm-border, #e6dfd3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
            <button
              type="button"
              onClick={() => setLeftDropOpen((o) => !o)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 999,
                border: '1px solid #d8cfc0',
                background: 'var(--warm-card, #fff)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Clapperboard size={14} color="#8C3B2B" /> {leftLabels[leftTab]} <ChevronDown size={13} />
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid #d8cfc0',
                background: 'var(--warm-card, #fff)',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              + 传素材
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={async (e) => {
                const list = Array.from(e.target.files || []);
                e.target.value = '';
                if (!list.length) return;
                setBusy(true);
                try {
                  await uploadToProject(active, list);
                  setError('');
                  setToast(`已添加 ${list.length} 份素材`);
                } catch (err: any) {
                  setError(formatCreatorUploadError(err.message || '上传失败'));
                } finally {
                  setBusy(false);
                  setBusyLabel('');
                }
              }}
            />
            {leftDropOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 48,
                  left: 12,
                  width: 170,
                  background: 'var(--warm-card, #fff)',
                  border: '1px solid var(--warm-border, #d8cfc0)',
                  borderRadius: 12,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                  zIndex: 40,
                  padding: 6,
                }}
              >
                {(['materials', 'characters', 'synopsis', 'outline'] as LeftTab[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setLeftTab(k);
                      setLeftDropOpen(false);
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: 'none',
                      background: leftTab === k ? 'rgba(140,59,43,0.1)' : 'transparent',
                      color: leftTab === k ? '#8C3B2B' : 'inherit',
                      fontWeight: leftTab === k ? 700 : 500,
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    {leftLabels[k]}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {leftTab === 'materials' && (
              <>
                {active.attachments.length === 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.65, padding: 12, textAlign: 'center' }}>
                    尚未上传视频或原稿，点击右上角「+ 传素材」添加。
                  </div>
                ) : (
                  active.attachments.map((att) => (
                    <div
                      key={att.id}
                      style={{
                        padding: 10,
                        borderRadius: 10,
                        background: 'var(--warm-card, #fff)',
                        border: '1px solid var(--warm-border, #e6dfd3)',
                        fontSize: 12,
                      }}
                    >
                      <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{att.name}</div>
                      <div style={{ opacity: 0.65, marginTop: 3 }}>{formatBytes(att.size)}</div>
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {(() => {
                          const coveredEps = sourceAttachmentEpisodeNumbers(att);
                          if (coveredEps.length > 1 && epDrafts[att.id] === undefined) {
                            const isManuscript = classifySourceMaterialName(att.name || '') === 'manuscript';
                            return (
                              <span style={{ color: '#15803d', fontWeight: 700 }}>
                                {isManuscript
                                  ? `1份源文稿，已识别${formatCoveredEpisodeRange(coveredEps)}`
                                  : `已识别${formatCoveredEpisodeRange(coveredEps)}`}
                              </span>
                            );
                          }
                          if (coveredEps.length === 1 && epDrafts[att.id] === undefined) {
                            const epNum = coveredEps[0];
                            return (
                              <>
                                <span style={{ color: '#15803d', fontWeight: 700 }}>✓ 第 {epNum} 集</span>
                                <button
                                  type="button"
                                  onClick={() => setEpDrafts({ ...epDrafts, [att.id]: String(epNum) })}
                                  style={{ fontSize: 11, border: 'none', background: 'transparent', color: '#8C3B2B', cursor: 'pointer', textDecoration: 'underline' }}
                                >
                                  修改
                                </button>
                              </>
                            );
                          }
                          return (
                            <>
                              <input
                                type="number"
                                min={1}
                                max={300}
                                placeholder="集号"
                                value={epDrafts[att.id] ?? ''}
                                onChange={(e) => setEpDrafts({ ...epDrafts, [att.id]: e.target.value })}
                                style={{ width: 64, padding: '3px 6px', borderRadius: 6, border: '1px solid #d8cfc0', fontSize: 12 }}
                              />
                              <button
                                type="button"
                                onClick={() => saveEpisodeNum(att.id)}
                                style={{ padding: '3px 8px', borderRadius: 6, border: 'none', background: '#8C3B2B', color: '#fff', fontSize: 11, cursor: 'pointer' }}
                              >
                                保存
                              </button>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
            {leftTab === 'characters' && (
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                {(active.characterNodes || []).length > 0 ? (
                  active.characterNodes!.map((c) => (
                    <div key={c.id} style={{ padding: 10, borderRadius: 10, background: 'var(--warm-card, #fff)', border: '1px solid #e6dfd3', marginBottom: 8 }}>
                      <strong>{c.title}</strong>
                      <p style={{ margin: '4px 0 0', opacity: 0.78, whiteSpace: 'pre-wrap' }}>{c.body}</p>
                    </div>
                  ))
                ) : (
                  <p style={{ opacity: 0.6 }}>扒剧完成后将自动沉淀人物锚定表。</p>
                )}
              </div>
            )}
            {leftTab === 'synopsis' && (
              <div style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {active.remote?.outputs?.synopsis?.content || '完成扒剧或拆书后将自动展示故事梗概。'}
              </div>
            )}
            {leftTab === 'outline' && (
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                {(active.outlineNodes || []).length > 0 ? (
                  active.outlineNodes!.map((o) => (
                    <div key={o.id} style={{ padding: 10, borderRadius: 10, background: 'var(--warm-card, #fff)', border: '1px solid #e6dfd3', marginBottom: 8 }}>
                      <strong>{o.title}</strong>
                      <p style={{ margin: '4px 0 0', opacity: 0.78, whiteSpace: 'pre-wrap' }}>{o.body}</p>
                    </div>
                  ))
                ) : (
                  <p style={{ opacity: 0.6 }}>拆解大纲将自动归档在此。</p>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* CENTER COLUMN: Clean Script Preview + Direct Word (.docx) Delivery Bar */}
        <section style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--warm-bg, #f9f6f0)' }}>
          <div
            style={{
              padding: '10px 18px',
              borderBottom: '1px solid var(--warm-border, #e6dfd3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {(() => {
                const isDelivered =
                  active.remote?.status === 'delivered' ||
                  active.remote?.stage?.key === 'delivery';
                return (
                  <>
                    <a
                      href={`/api/upload?id=${active.id}&export=docx`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '8px 16px',
                        borderRadius: 999,
                        border: isDelivered ? 'none' : '1px dashed #8C3B2B',
                        background: isDelivered ? '#8C3B2B' : '#f7efe8',
                        color: isDelivered ? '#fff' : '#8C3B2B',
                        textDecoration: 'none',
                        fontWeight: 700,
                        fontSize: 13,
                      }}
                    >
                      <Download size={14} />{' '}
                      {isDelivered ? '下载规范 Word (.docx)' : '下载未完成占位稿 (.docx)'}
                    </a>
                    <button
                      type="button"
                      disabled={busy || !isDelivered}
                      title={isDelivered ? undefined : '扒剧项目交付后才可转入'}
                      onClick={() => handleTransfer('foreign')}
                      style={{
                        padding: '7px 12px',
                        borderRadius: 999,
                        border: '1px solid #d8cfc0',
                        background: 'var(--warm-card, #fff)',
                        fontSize: 12,
                        cursor: busy || !isDelivered ? 'not-allowed' : 'pointer',
                        opacity: isDelivered ? 1 : 0.55,
                        fontWeight: 600,
                      }}
                    >
                      转入「国外迭代」→
                    </button>
                    <button
                      type="button"
                      disabled={busy || !isDelivered}
                      title={isDelivered ? undefined : '扒剧项目交付后才可转入'}
                      onClick={() => handleTransfer('domestic')}
                      style={{
                        padding: '7px 12px',
                        borderRadius: 999,
                        border: '1px solid #d8cfc0',
                        background: 'var(--warm-card, #fff)',
                        fontSize: 12,
                        cursor: busy || !isDelivered ? 'not-allowed' : 'pointer',
                        opacity: isDelivered ? 1 : 0.55,
                        fontWeight: 600,
                      }}
                    >
                      转入「国内迭代」→
                    </button>
                  </>
                );
              })()}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span
                style={{
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid #d8cfc0',
                  background: 'transparent',
                  fontSize: 12,
                  color: '#5C5048',
                }}
              >
                完整分场剧本（共{' '}
                {active.episodes?.length ||
                  active.total ||
                  Math.max(
                    0,
                    ...getSourceMaterialAttachments(active.attachments).flatMap((a) =>
                      sourceAttachmentEpisodeNumbers(a),
                    ),
                  )}{' '}
                集）
              </span>
              <button
                type="button"
                onClick={() => setPageWidthMode((v) => !v)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid #d8cfc0',
                  background: pageWidthMode ? 'rgba(140,59,43,0.1)' : 'transparent',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                页宽正文
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={saveEditorBody}
                style={{
                  padding: '6px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#2C2420',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                保存修改
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
            <div style={{ maxWidth: pageWidthMode ? 760 : '100%', margin: '0 auto' }}>
              {error && (
                <div style={{ padding: 10, borderRadius: 10, background: '#fee2e2', color: '#991b1b', marginBottom: 14, fontSize: 13 }}>
                  {error}
                </div>
              )}
              {toast && (
                <div style={{ padding: 10, borderRadius: 10, background: 'rgba(22,163,74,0.12)', color: '#15803d', marginBottom: 14, fontSize: 13 }}>
                  <Check size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {toast}
                </div>
              )}
              <textarea
                value={editorBody || teardownResult}
                onChange={(e) => setEditorBody(e.target.value)}
                placeholder="选择右侧「快速模式」或「详细模式」开始扒剧，完成后规范分场剧本将自动呈现在这里，同时可直接点击上方下载真 .docx Word 文件…"
                style={{
                  width: '100%',
                  minHeight: 'calc(100vh - 200px)',
                  padding: 24,
                  borderRadius: 14,
                  border: '1px solid var(--warm-border, #e6dfd3)',
                  background: 'var(--warm-card, #fff)',
                  fontSize: 15,
                  lineHeight: 1.85,
                  resize: 'vertical',
                  fontFamily: 'inherit',
                }}
              />
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: Ultra-Clean Mode Picker + Employee-to-Boss Report Chat */}
        <aside
          style={{
            borderLeft: '1px solid var(--warm-border, #e6dfd3)',
            background: 'var(--warm-card, #fff)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--warm-border, #e6dfd3)', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={15} color="#8C3B2B" /> 扒剧 · 拆书助手
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Ultra-clean Mode Card (NO extra textareas, NO Step 3 empty card!) */}
            {!isDelivered && (
              <div
                style={{
                  padding: 16,
                  borderRadius: 14,
                  background: 'var(--warm-surface, #faf7f2)',
                  border: '1px solid var(--warm-border, #e6dfd3)',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>选择扒剧模式</div>
                <div style={{ fontSize: 12, opacity: 0.72, marginBottom: 12 }}>
                  选好模式直接开跑，无异常将直接交付可下载 Word（.docx）。
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                  <button
                    type="button"
                    onClick={() => setSelectedMode('fast')}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: selectedMode === 'fast' ? '2px solid #8C3B2B' : '1px solid #d8cfc0',
                      background: selectedMode === 'fast' ? 'rgba(140,59,43,0.08)' : '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13 }}>⚡ 快速模式（推荐）</div>
                    <div style={{ fontSize: 11, opacity: 0.72, marginTop: 2 }}>整集看写 + 关键集抽查，出稿更快</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedMode('detailed')}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: selectedMode === 'detailed' ? '2px solid #8C3B2B' : '1px solid #d8cfc0',
                      background: selectedMode === 'detailed' ? 'rgba(140,59,43,0.08)' : '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13 }}>🔍 详细模式</div>
                    <div style={{ fontSize: 11, opacity: 0.72, marginTop: 2 }}>逐帧拆解画面、微表情与完整台词</div>
                  </button>
                </div>
                {hasMissingEp && (
                  <div style={{ fontSize: 12, color: '#b45309', marginBottom: 10 }}>
                    提示：左侧有素材尚未识别集号，请先填好集号再开始。
                  </div>
                )}
                <button
                  type="button"
                  disabled={busy || !selectedMode || hasMissingEp}
                  onClick={startTranscribeDirect}
                  style={{
                    width: '100%',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '10px 16px',
                    borderRadius: 10,
                    background: !selectedMode || hasMissingEp ? '#cbd5e1' : '#8C3B2B',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 700,
                    cursor: !selectedMode || hasMissingEp ? 'not-allowed' : 'pointer',
                    fontSize: 13,
                  }}
                >
                  <Zap size={14} /> 开始扒剧并直出 Word <ArrowRight size={14} />
                </button>
              </div>
            )}

            {/* Direct Word Download Card on Delivery */}
            {isDelivered && (
              <a
                href={`/api/upload?id=${active.id}&export=docx`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 14,
                  borderRadius: 14,
                  background: 'rgba(140,59,43,0.08)',
                  border: '1.5px solid #8C3B2B',
                  textDecoration: 'none',
                  color: '#5A2B1D',
                }}
              >
                <FileText size={24} color="#8C3B2B" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{active.title}.docx</div>
                  <div style={{ fontSize: 11, opacity: 0.78, marginTop: 2 }}>点击直接下载规范 Word 剧本</div>
                </div>
                <Download size={18} color="#8C3B2B" />
              </a>
            )}

            {/* Live Waiting Timer Banner */}
            {busy && (
              <div
                role="status"
                style={{
                  padding: 14,
                  borderRadius: 12,
                  background: 'rgba(212,155,84,0.14)',
                  border: '1px solid #D49B54',
                  fontSize: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#8C3B2B' }}>
                    <LoaderCircle className="spin" size={15} /> 正在处理 · 已用时 {elapsedSec} 秒
                  </div>
                  {uploadAbortCtrl && (
                    <button
                      type="button"
                      onClick={() => {
                        uploadAbortCtrl.abort();
                        setBusyLabel('正在取消…');
                        setError('已取消当前上传/抽帧任务');
                      }}
                      style={{
                        padding: '3px 10px',
                        borderRadius: 6,
                        border: '1px solid rgba(140,59,43,0.45)',
                        background: '#FFF8F6',
                        color: '#8C3B2B',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      取消
                    </button>
                  )}
                </div>
                <div style={{ marginTop: 4, opacity: 0.85 }}>{busyLabel || '正在处理中，请稍候…'}</div>
              </div>
            )}

            {/* Concise Employee-to-Boss Messages */}
            {active.messages.map((m) => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '92%',
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: m.role === 'user' ? '#8C3B2B' : 'var(--warm-surface, #faf7f2)',
                  color: m.role === 'user' ? '#fff' : 'inherit',
                  border: m.role === 'user' ? 'none' : '1px solid var(--warm-border, #e6dfd3)',
                  fontSize: 13,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {m.text}
                {m.file && (
                  <a
                    href={m.file.url}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginTop: 8,
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: '#fff',
                      color: '#8C3B2B',
                      fontWeight: 700,
                      textDecoration: 'none',
                      fontSize: 12,
                      border: '1px solid #e6dfd3',
                    }}
                  >
                    <Download size={14} /> {m.file.name}
                  </a>
                )}
              </div>
            ))}
          </div>

          {/* Bottom Simple Input */}
          <div style={{ padding: 12, borderTop: '1px solid var(--warm-border, #e6dfd3)', display: 'flex', gap: 8 }}>
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  sendChat();
                }
              }}
              placeholder="有补充要求或修改意见直接说…"
              style={{
                flex: 1,
                padding: '9px 12px',
                borderRadius: 10,
                border: '1px solid #d8cfc0',
                background: 'var(--warm-surface, #faf7f2)',
                fontSize: 13,
              }}
            />
            <button
              type="button"
              disabled={busy || !chatInput.trim()}
              onClick={sendChat}
              aria-label="发送"
              style={{
                padding: '9px 12px',
                borderRadius: 10,
                border: 'none',
                background: '#8C3B2B',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              <Send size={15} />
            </button>
          </div>
        </aside>
      </div>
    </WarmShell>
  );
}
