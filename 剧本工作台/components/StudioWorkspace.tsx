'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronDown,
  Clock,
  Download,
  FileText,
  Flame,
  Grid,
  History,
  Lightbulb,
  List,
  LoaderCircle,
  Lock,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
  Zap,
} from 'lucide-react';
import WarmShell from './WarmShell';
import type {
  CreatorPromptCatalog,
  CreatorTierSummary,
  ExecutionMode,
  Kind,
  Project,
  PublicAccountProfile,
  StudioAssetNode,
  StudioEpisode,
  ThinkingLevel,
} from '../lib/types';

type LeftMode = 'toc' | 'outline' | 'characters' | 'world';
type RightTab = 'chat' | 'skills' | 'rules';
type ToolModalType = '' | 'inspire' | 'ai-rate' | 'trending' | 'teardown' | 'history';

const KIND_LABELS: Record<Kind, string> = {
  foreign: '国外迭代国外',
  domestic: '国内迭代国外',
  transcribe: '扒剧',
  original: '原创',
};

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: '关闭',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最高',
};

const TRENDING_PLATFORMS = ['抖音', '红果短剧', '海外短剧', '番茄小说', '起点中文', '七猫小说', '晋江文学', '微博', 'B站', '飞卢小说'];

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

export default function StudioWorkspace() {
  const [account, setAccount] = useState<PublicAccountProfile | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tierCatalog, setTierCatalog] = useState<CreatorTierSummary[]>([]);
  const [promptCatalog, setPromptCatalog] = useState<CreatorPromptCatalog | null>(null);
  const [active, setActive] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Bookshelf state
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'updated' | 'name'>('updated');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKind, setNewKind] = useState<Kind>('foreign');
  const [newTitle, setNewTitle] = useState('');
  const [newBrief, setNewBrief] = useState('');

  // Left panel
  const [leftMode, setLeftMode] = useState<LeftMode>('toc');
  const [leftDropOpen, setLeftDropOpen] = useState(false);
  const [selectedEpId, setSelectedEpId] = useState<string>('');
  const [selectedAsset, setSelectedAsset] = useState<{ tree: 'outline' | 'characters' | 'world'; node: StudioAssetNode } | null>(null);

  // Center editor
  const [epTitle, setEpTitle] = useState('');
  const [epBody, setEpBody] = useState('');
  const [pageWidth, setPageWidth] = useState(true);
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'justify'>('left');
  const [toolModal, setToolModal] = useState<ToolModalType>('');
  const [toolOutput, setToolOutput] = useState<any>(null);
  const [trendingPlatform, setTrendingPlatform] = useState('抖音');
  const [teardownSource, setTeardownSource] = useState('');
  const [teardownText, setTeardownText] = useState('');

  // Right panel
  const [rightTab, setRightTab] = useState<RightTab>('chat');
  const [skillSearch, setSkillSearch] = useState('');
  const [globalRules, setGlobalRules] = useState('');
  const [projectRules, setProjectRules] = useState('');
  const [chatText, setChatText] = useState('');

  const importFileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!busy) {
      setElapsedSec(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setElapsedSec(Math.max(1, Math.floor((Date.now() - start) / 1000))), 1000);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  async function loadAll() {
    setLoading(true);
    try {
      const data = await studioApi('/api/studio');
      setAccount(data.currentAccount || null);
      setTierCatalog(data.tierCatalog || []);
      setPromptCatalog(data.promptCatalog || null);
      const list: Project[] = (data.projects || []).filter((p: Project) => !p.archived && p.kind !== 'transcribe');
      setProjects(list);

      const urlId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('id') : null;
      if (urlId) {
        const found = (data.projects || []).find((p: Project) => p.id === urlId);
        if (found) await openProject(found);
      }

      try {
        const profRes = await fetch('/api/profile');
        if (profRes.ok) {
          const prof = await profRes.json();
          setGlobalRules(prof.globalRules || '');
        }
      } catch {}
    } catch (e: any) {
      setError(e.message || '加载工作区失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  function syncProject(p: Project, keepSelection = true) {
    setActive(p);
    if (p.kind !== 'transcribe') {
      setProjects((prev) => [p, ...prev.filter((x) => x.id !== p.id)]);
    }
    setProjectRules(p.projectRules || '');
    const eps = p.episodes || [];
    if (eps.length > 0) {
      const match = keepSelection ? eps.find((e) => e.id === selectedEpId) || eps[0] : eps[0];
      setSelectedEpId(match.id);
      if (!selectedAsset) {
        setEpTitle(match.title);
        setEpBody(match.body || '');
      }
    }
  }

  async function openProject(p: Project) {
    setBusy(true);
    setBusyText('正在打开创作台…');
    try {
      const full = await studioApi(`/api/studio?id=${p.id}`);
      if (full.tierCatalog) setTierCatalog(full.tierCatalog);
      if (full.promptCatalog) setPromptCatalog(full.promptCatalog);
      setSelectedAsset(null);
      syncProject(full, false);
    } catch (e: any) {
      setError(e.message || '打开项目失败');
    } finally {
      setBusy(false);
      setBusyText('');
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || busy) return;
    setBusy(true);
    setBusyText('正在建立新剧本作品…');
    setError('');
    try {
      const created: Project = await studioApi('/api/studio', {
        operation: 'create',
        title: newTitle.trim(),
        kind: newKind,
        brief: newBrief.trim(),
      });
      setShowCreateModal(false);
      setNewTitle('');
      setNewBrief('');
      syncProject(created, false);
      setToast('新作品已建立，可以开始创作');
    } catch (err: any) {
      setError(err.message || '建档失败');
    } finally {
      setBusy(false);
      setBusyText('');
    }
  }

  const currentEpisode: StudioEpisode | null =
    active?.episodes?.find((e) => e.id === selectedEpId) || active?.episodes?.[0] || null;
  const isCurrentLocked = Boolean(
    currentEpisode && (currentEpisode.locked || (active?.lockedEpisodes && currentEpisode.episodeNumber <= active.lockedEpisodes))
  );

  async function saveCurrentContent() {
    if (!active || busy) return;
    setBusy(true);
    setBusyText(selectedAsset ? '正在保存资产设定…' : '正在保存本集正文并生成历史快照…');
    setError('');
    try {
      if (selectedAsset) {
        const updated = await studioApi('/api/studio', {
          operation: 'save_asset_node',
          id: active.id,
          version: active.version,
          tree: selectedAsset.tree,
          node: { id: selectedAsset.node.id, title: epTitle, body: epBody },
        });
        syncProject(updated, true);
        setToast('已保存并同步云端');
      } else {
        if (isCurrentLocked) {
          setError('当前集为前 N 集锁定稿（一字不动保护），不可直接修改。');
          return;
        }
        const updated = await studioApi('/api/studio', {
          operation: 'save_episode',
          id: active.id,
          version: active.version,
          episodeId: currentEpisode?.id,
          episodeNumber: currentEpisode?.episodeNumber || 1,
          title: epTitle || `第 ${currentEpisode?.episodeNumber || 1} 集`,
          body: epBody,
        });
        syncProject(updated, true);
        setToast('本集已保存，历史版本快照已更新');
      }
    } catch (e: any) {
      setError(e.message || '保存失败');
    } finally {
      setBusy(false);
      setBusyText('');
    }
  }

  async function addNewEpisode() {
    if (!active || busy) return;
    const nextNum = Math.max(0, ...(active.episodes || []).map((e) => e.episodeNumber)) + 1;
    setBusy(true);
    setBusyText(`正在新建第 ${nextNum} 集…`);
    try {
      const updated: Project = await studioApi('/api/studio', {
        operation: 'save_episode',
        id: active.id,
        version: active.version,
        episodeNumber: nextNum,
        title: `第 ${nextNum} 集`,
        body: '',
      });
      const createdEp = (updated.episodes || []).find((e) => e.episodeNumber === nextNum);
      setSelectedAsset(null);
      setActive(updated);
      if (createdEp) {
        setSelectedEpId(createdEp.id);
        setEpTitle(createdEp.title);
        setEpBody(createdEp.body || '');
      }
      setToast(`已新建第 ${nextNum} 集`);
    } catch (e: any) {
      setError(e.message || '新建集数失败');
    } finally {
      setBusy(false);
      setBusyText('');
    }
  }

  async function addAssetNode(tree: 'outline' | 'characters' | 'world') {
    if (!active || busy) return;
    const label = tree === 'outline' ? '新大纲节点' : tree === 'characters' ? '新角色卡' : '新背景设定';
    setBusy(true);
    try {
      const updated: Project = await studioApi('/api/studio', {
        operation: 'save_asset_node',
        id: active.id,
        version: active.version,
        tree,
        node: { title: label, body: '' },
      });
      const key = tree === 'outline' ? 'outlineNodes' : tree === 'characters' ? 'characterNodes' : 'worldNodes';
      const nodes = updated[key] || [];
      const last = nodes[nodes.length - 1];
      setActive(updated);
      if (last) {
        setSelectedAsset({ tree, node: last });
        setEpTitle(last.title);
        setEpBody(last.body || '');
      }
      setToast(`已创建「${label}」`);
    } catch (e: any) {
      setError(e.message || '新建失败');
    } finally {
      setBusy(false);
    }
  }

  async function runStudioTool(tool: string, extra: Record<string, any> = {}) {
    if (!active || busy) return;
    setBusy(true);
    setBusyText('正在执行增强工具分析，请稍候…');
    setError('');
    try {
      const res = await studioApi('/api/studio', {
        operation: 'studio_tool',
        id: active.id,
        version: active.version,
        tool,
        text: extra.text ?? epBody,
        ...extra,
      });
      if (tool === 'format' && typeof res.formatted === 'string') {
        setEpBody(res.formatted);
        setToast('已完成短剧规范一键排版');
      } else {
        setToolOutput(res);
      }
      if (res.project) syncProject(res.project, true);
    } catch (e: any) {
      setError(e.message || '工具执行失败');
    } finally {
      setBusy(false);
      setBusyText('');
    }
  }

  async function updateExecution(next: { preferredTierId?: string; thinkingLevel?: ThinkingLevel; executionMode?: ExecutionMode }) {
    if (!active || busy) return;
    try {
      const updated = await studioApi('/api/studio', {
        operation: 'set_execution',
        id: active.id,
        version: active.version,
        preferredTierId: next.preferredTierId ?? active.preferredTierId,
        thinkingLevel: next.thinkingLevel ?? active.thinkingLevel ?? 'medium',
        executionMode: next.executionMode ?? active.executionMode ?? 'auto',
      });
      syncProject(updated, true);
    } catch (e: any) {
      setError(e.message || '切换控制项失败');
    }
  }

  async function sendChat(overridePrompt?: string) {
    if (!active || busy) return;
    const text = (overridePrompt ?? chatText).trim();
    if (!text) return;
    if (!overridePrompt) setChatText('');
    setBusy(true);
    setBusyText(active.executionMode === 'plan' ? '总编剧正在思考规划建议（计划模式，不修改正文）…' : '总编剧正在响应并准备同步写入…');
    try {
      const updated = await studioApi('/api/studio', {
        operation: 'message',
        id: active.id,
        version: active.version,
        text,
        client_id: crypto.randomUUID(),
      });
      syncProject(updated, true);
    } catch (e: any) {
      setError(e.message || '发送失败');
    } finally {
      setBusy(false);
      setBusyText('');
    }
  }

  function wrapSelection(prefix: string, suffix: string) {
    const el = textareaRef.current;
    if (!el || isCurrentLocked) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const sel = epBody.slice(start, end) || '内容';
    const next = epBody.slice(0, start) + prefix + sel + suffix + epBody.slice(end);
    setEpBody(next);
  }

  const filteredProjects = projects
    .filter((p) => p.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (sortBy === 'name' ? a.title.localeCompare(b.title) : b.updatedAt.localeCompare(a.updatedAt)));

  // 1. BOOKSHELF HALL (/studio)
  if (!active) {
    return (
      <WarmShell
        activeNav="studio"
        title="创作台"
        subtitle="总编剧 · 剧本工作台 — 国外迭代 · 国内出海 · 原创全流程"
        account={account}
        authenticated={Boolean(account)}
      >
        <div style={{ width: '100%', maxWidth: 1180, margin: '0 auto', padding: '24px 20px 56px' }}>
          <div
            style={{
              background: 'linear-gradient(135deg, #FAF5EC 0%, #F2E7D5 100%)',
              border: '1px solid var(--warm-border, #e6dfd3)',
              borderRadius: 20,
              padding: '34px 34px 30px',
              marginBottom: 24,
            }}
          >
            <div style={{ fontSize: 12, letterSpacing: 1.5, opacity: 0.65, marginBottom: 6 }}>
              📖 My Bookshelf
            </div>
            <h1 style={{ fontFamily: 'serif', fontSize: 38, margin: '0 0 8px', color: '#5A2B1D' }}>
              我的剧架
            </h1>
            <p style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 500 }}>在这里，记录你的每一个短剧故事</p>
            <p style={{ margin: '0 0 22px', fontSize: 13, opacity: 0.7 }}>灵感会过期，但好剧本会留下来。</p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '11px 24px',
                  borderRadius: 999,
                  background: '#D49B54',
                  color: '#2C2420',
                  border: 'none',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                <Plus size={16} /> 新建作品
              </button>
            </div>
          </div>

          {error && (
            <div style={{ padding: 12, borderRadius: 10, background: '#fee2e2', color: '#991b1b', marginBottom: 16 }}>
              {error}
            </div>
          )}

          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16, borderBottom: '1px solid var(--warm-border, #e6dfd3)', paddingBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#8C3B2B', borderBottom: '2px solid #8C3B2B', paddingBottom: 8, marginBottom: -11 }}>
              我的作品 {projects.length}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索作品名称…"
                  style={{ padding: '7px 12px 7px 30px', borderRadius: 999, border: '1px solid #d8cfc0', background: 'var(--warm-card, #fff)', fontSize: 13 }}
                />
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'updated' | 'name')}
                style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #d8cfc0', background: 'var(--warm-card, #fff)', fontSize: 12 }}
              >
                <option value="updated">最近更新</option>
                <option value="name">按名称</option>
              </select>
              <button type="button" aria-label="网格视图" onClick={() => setViewMode('grid')} style={{ padding: 7, borderRadius: 8, border: '1px solid #d8cfc0', background: viewMode === 'grid' ? 'rgba(140,59,43,0.1)' : 'transparent', cursor: 'pointer' }}>
                <Grid size={15} />
              </button>
              <button type="button" aria-label="列表视图" onClick={() => setViewMode('list')} style={{ padding: 7, borderRadius: 8, border: '1px solid #d8cfc0', background: viewMode === 'list' ? 'rgba(140,59,43,0.1)' : 'transparent', cursor: 'pointer' }}>
                <List size={15} />
              </button>
            </div>
          </div>

          {loading ? (
            <div style={{ padding: 48, textAlign: 'center', opacity: 0.65 }}>正在打开我的剧架…</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: viewMode === 'grid' ? 'repeat(auto-fill, minmax(250px, 1fr))' : '1fr', gap: 16 }}>
              {filteredProjects.map((p) => (
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
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(140,59,43,0.1)', color: '#8C3B2B', fontWeight: 600 }}>
                        {KIND_LABELS[p.kind]}
                      </span>
                      {p.lockedEpisodes && (
                        <span style={{ fontSize: 11, color: '#b45309', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <Lock size={11} /> 锁前 {p.lockedEpisodes} 集
                        </span>
                      )}
                    </div>
                    <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>{p.title}</h3>
                    <p style={{ margin: 0, fontSize: 12, opacity: 0.68 }}>
                      {p.total ? `全剧 ${p.total} 集` : '集数待定'} · {(p.episodes || []).length} 集正文
                    </p>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid rgba(230,223,211,0.5)', fontSize: 11, opacity: 0.65 }}>
                    <span>{new Date(p.updatedAt).toLocaleDateString('zh-CN')}</span>
                    <a
                      href={`/api/upload?id=${p.id}&export=docx`}
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: '#8C3B2B', fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                    >
                      <Download size={12} /> Word
                    </a>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                style={{
                  minHeight: 156,
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
                <strong style={{ fontSize: 14 }}>新建作品</strong>
                <span style={{ fontSize: 12, opacity: 0.7 }}>开启你的下一个故事</span>
              </button>
            </div>
          )}

          {/* Create Modal */}
          {showCreateModal && (
            <div
              onClick={() => !busy && setShowCreateModal(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(28,22,18,0.48)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 90, padding: 16 }}
            >
              <form
                onSubmit={handleCreate}
                onClick={(e) => e.stopPropagation()}
                style={{ width: '100%', maxWidth: 500, background: 'var(--warm-card, #fff)', borderRadius: 18, padding: 26, display: 'flex', flexDirection: 'column', gap: 14 }}
              >
                <h2 style={{ margin: 0, fontFamily: 'serif', fontSize: 22 }}>新建短剧作品</h2>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {(['foreign', 'domestic', 'original'] as Kind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setNewKind(k)}
                      style={{
                        padding: '7px 14px',
                        borderRadius: 999,
                        border: newKind === k ? '1.5px solid #8C3B2B' : '1px solid #d8cfc0',
                        background: newKind === k ? 'rgba(140,59,43,0.1)' : 'transparent',
                        color: newKind === k ? '#8C3B2B' : 'inherit',
                        fontWeight: newKind === k ? 700 : 500,
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                    >
                      {KIND_LABELS[k]}
                    </button>
                  ))}
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                  作品名称
                  <input
                    required
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="如：豪门闪婚第11-62集续写"
                    style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #d8cfc0' }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                  简介 / 集数与锁集说明（选填）
                  <textarea
                    rows={3}
                    value={newBrief}
                    onChange={(e) => setNewBrief(e.target.value)}
                    placeholder="例如：全剧 60 集，前 10 集已锁定（一字不动），第 11 集起续写…"
                    style={{ padding: 10, borderRadius: 10, border: '1px solid #d8cfc0', fontSize: 13 }}
                  />
                </label>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button type="button" onClick={() => setShowCreateModal(false)} style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid #d8cfc0', background: 'transparent', cursor: 'pointer' }}>
                    取消
                  </button>
                  <button type="submit" disabled={busy} style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: '#8C3B2B', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                    {busy ? '建档中…' : '创建并进入工作台'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </WarmShell>
    );
  }

  // 2. 3-COLUMN IMMERSIVE STUDIO WORKBENCH
  const leftModeLabels: Record<LeftMode, string> = {
    toc: '作品目录',
    outline: '大纲',
    characters: '角色',
    world: '背景设定',
  };
  const skillOptions = [
    ...(promptCatalog?.[active.kind]?.primary || []),
    ...(promptCatalog?.[active.kind]?.secondary || []),
  ].filter((s) => !skillSearch.trim() || s.name.toLowerCase().includes(skillSearch.toLowerCase()) || (s.description || '').toLowerCase().includes(skillSearch.toLowerCase()));

  const selectedTier =
    tierCatalog.find((t) => t.id === active.preferredTierId) ||
    tierCatalog.find((t) => t.isDefault) ||
    tierCatalog[0] ||
    null;

  return (
    <WarmShell
      activeNav="studio"
      title={active.title}
      backHref="/studio"
      backLabel="返回剧架"
      editableTitle={active.title}
      onRenameTitle={async (nextName) => {
        const u = await studioApi('/api/studio', { operation: 'rename', id: active.id, version: active.version, title: nextName });
        syncProject(u, true);
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
          gridTemplateColumns: '228px minmax(0, 1fr) 372px',
          height: 'calc(100vh - 58px)',
          overflow: 'hidden',
        }}
      >
        {/* LEFT COLUMN: 目录 ▾ 4-mode switcher */}
        <aside
          style={{
            borderRight: '1px solid var(--warm-border, #e6dfd3)',
            background: 'var(--warm-sidebar, #f4efe6)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '12px 10px', borderBottom: '1px solid var(--warm-border, #e6dfd3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', gap: 6 }}>
            <button
              type="button"
              onClick={() => setLeftDropOpen((o) => !o)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '6px 10px',
                borderRadius: 999,
                border: '1px solid #d8cfc0',
                background: 'var(--warm-card, #fff)',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <BookOpen size={13} color="#8C3B2B" /> {leftModeLabels[leftMode]} <ChevronDown size={12} />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (leftMode === 'toc') addNewEpisode();
                else addAssetNode(leftMode);
              }}
              style={{ padding: '5px 9px', borderRadius: 8, border: '1px solid #d8cfc0', background: 'var(--warm-card, #fff)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
            >
              {leftMode === 'toc' ? '+ 新集' : leftMode === 'outline' ? '+ 大纲' : leftMode === 'characters' ? '+ 角色' : '+ 设定'}
            </button>
            {leftDropOpen && (
              <div style={{ position: 'absolute', top: 46, left: 10, width: 150, background: 'var(--warm-card, #fff)', border: '1px solid #d8cfc0', borderRadius: 12, boxShadow: '0 8px 20px rgba(0,0,0,0.1)', zIndex: 40, padding: 6 }}>
                {(['toc', 'outline', 'characters', 'world'] as LeftMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setLeftMode(m);
                      setLeftDropOpen(false);
                      if (m === 'toc') {
                        setSelectedAsset(null);
                        if (currentEpisode) {
                          setEpTitle(currentEpisode.title);
                          setEpBody(currentEpisode.body || '');
                        }
                      }
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: 'none',
                      background: leftMode === m ? 'rgba(140,59,43,0.1)' : 'transparent',
                      color: leftMode === m ? '#8C3B2B' : 'inherit',
                      fontWeight: leftMode === m ? 700 : 500,
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    {leftModeLabels[m]}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {leftMode === 'toc' &&
              (active.episodes || []).map((ep) => {
                const locked = ep.locked || Boolean(active.lockedEpisodes && ep.episodeNumber <= active.lockedEpisodes);
                const isSel = !selectedAsset && ep.id === currentEpisode?.id;
                return (
                  <button
                    key={ep.id}
                    type="button"
                    onClick={() => {
                      setSelectedAsset(null);
                      setSelectedEpId(ep.id);
                      setEpTitle(ep.title);
                      setEpBody(ep.body || '');
                    }}
                    style={{
                      textAlign: 'left',
                      padding: '9px 10px',
                      borderRadius: 10,
                      border: isSel ? '1.5px solid #8C3B2B' : '1px solid transparent',
                      background: isSel ? 'var(--warm-card, #fff)' : 'transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ fontWeight: isSel ? 700 : 500, color: isSel ? '#8C3B2B' : 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ep.title}
                    </span>
                    <span style={{ fontSize: 11, opacity: 0.65, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      {locked && <Lock size={11} color="#b45309" />}
                      {ep.body?.length || 0}字
                    </span>
                  </button>
                );
              })}

            {leftMode !== 'toc' &&
              (active[leftMode === 'outline' ? 'outlineNodes' : leftMode === 'characters' ? 'characterNodes' : 'worldNodes'] || []).map((node) => {
                const isSel = selectedAsset?.node.id === node.id;
                return (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => {
                      setSelectedAsset({ tree: leftMode, node });
                      setEpTitle(node.title);
                      setEpBody(node.body || '');
                    }}
                    style={{
                      textAlign: 'left',
                      padding: '9px 10px',
                      borderRadius: 10,
                      border: isSel ? '1.5px solid #8C3B2B' : '1px solid transparent',
                      background: isSel ? 'var(--warm-card, #fff)' : 'transparent',
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: isSel ? 700 : 500,
                      color: isSel ? '#8C3B2B' : 'inherit',
                    }}
                  >
                    {node.title}
                  </button>
                );
              })}
          </div>
        </aside>

        {/* CENTER COLUMN: 3-Row Toolbar + Editor */}
        <section style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--warm-bg, #f9f6f0)' }}>
          {/* Row 1: Enhancement Capsules */}
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--warm-border, #e6dfd3)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" onClick={() => { setToolModal('inspire'); setToolOutput(null); runStudioTool('inspire'); }} style={{ padding: '6px 12px', borderRadius: 999, border: 'none', background: toolModal === 'inspire' ? '#8C3B2B' : 'rgba(140,59,43,0.1)', color: toolModal === 'inspire' ? '#fff' : '#5A2B1D', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Lightbulb size={13} /> 灵感
            </button>
            <button type="button" disabled={busy || isCurrentLocked} onClick={() => runStudioTool('format')} style={{ padding: '6px 12px', borderRadius: 999, border: 'none', background: 'rgba(140,59,43,0.1)', color: '#5A2B1D', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Wand2 size={13} /> 一键排版
            </button>
            <button type="button" onClick={() => { setToolModal('ai-rate'); setToolOutput(null); runStudioTool('ai_rate'); }} style={{ padding: '6px 12px', borderRadius: 999, border: 'none', background: toolModal === 'ai-rate' ? '#8C3B2B' : 'rgba(140,59,43,0.1)', color: toolModal === 'ai-rate' ? '#fff' : '#5A2B1D', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <ShieldCheck size={13} /> AI率查询
            </button>
            <button type="button" onClick={() => { setToolModal('trending'); setToolOutput(null); runStudioTool('trending', { platform: trendingPlatform }); }} style={{ padding: '6px 12px', borderRadius: 999, border: 'none', background: toolModal === 'trending' ? '#8C3B2B' : 'rgba(140,59,43,0.1)', color: toolModal === 'trending' ? '#fff' : '#5A2B1D', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Flame size={13} /> 扫榜
            </button>
            <button type="button" onClick={() => { setToolModal('teardown'); setToolOutput(null); }} style={{ padding: '6px 12px', borderRadius: 999, border: 'none', background: toolModal === 'teardown' ? '#8C3B2B' : 'rgba(140,59,43,0.1)', color: toolModal === 'teardown' ? '#fff' : '#5A2B1D', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <BookOpen size={13} /> 拆书
            </button>
            <button type="button" onClick={() => importFileRef.current?.click()} style={{ padding: '6px 12px', borderRadius: 999, border: 'none', background: 'rgba(140,59,43,0.1)', color: '#5A2B1D', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Upload size={13} /> 本地导入
            </button>
            <a href={`/api/upload?id=${active.id}&export=docx`} style={{ padding: '6px 12px', borderRadius: 999, background: '#8C3B2B', color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
              <Download size={13} /> 导出 Word
            </a>
            <input
              ref={importFileRef}
              type="file"
              accept=".txt,.md,.srt"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f || isCurrentLocked) return;
                const txt = await f.text();
                setEpBody((prev) => (prev ? `${prev}\n\n${txt}` : txt));
                setToast(`已导入「${f.name}」到当前编辑区`);
              }}
            />
          </div>

          {/* Row 2: Episode switcher, word count, history, save */}
          <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--warm-border, #e6dfd3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 200 }}>
              {selectedAsset ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAsset(null);
                    setLeftMode('toc');
                    if (currentEpisode) {
                      setEpTitle(currentEpisode.title);
                      setEpBody(currentEpisode.body || '');
                    }
                  }}
                  style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #d8cfc0', background: 'var(--warm-card, #fff)', fontSize: 12, cursor: 'pointer' }}
                >
                  ← 返回正文
                </button>
              ) : (
                <select
                  value={currentEpisode?.id || ''}
                  onChange={(e) => {
                    const found = (active.episodes || []).find((x) => x.id === e.target.value);
                    if (found) {
                      setSelectedEpId(found.id);
                      setEpTitle(found.title);
                      setEpBody(found.body || '');
                    }
                  }}
                  style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #d8cfc0', background: 'var(--warm-card, #fff)', fontSize: 12 }}
                >
                  {(active.episodes || []).map((ep) => (
                    <option key={ep.id} value={ep.id}>
                      {ep.title}
                    </option>
                  ))}
                </select>
              )}
              <input
                value={epTitle}
                disabled={isCurrentLocked && !selectedAsset}
                onChange={(e) => setEpTitle(e.target.value)}
                placeholder="输入标题…"
                style={{ flex: 1, padding: '5px 8px', border: 'none', background: 'transparent', fontWeight: 700, fontSize: 14 }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, opacity: 0.65 }}>字数：{epBody.length}</span>
              {!selectedAsset && (
                <button type="button" onClick={() => setToolModal('history')} style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #d8cfc0', background: 'var(--warm-card, #fff)', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <History size={12} /> 历史版本
                </button>
              )}
              <button
                type="button"
                disabled={busy || (isCurrentLocked && !selectedAsset)}
                onClick={saveCurrentContent}
                style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: '#8C3B2B', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
              >
                保存本章
              </button>
            </div>
          </div>

          {/* Row 3: Minimal Formatting Bar */}
          <div style={{ padding: '6px 16px', borderBottom: '1px solid var(--warm-border, #e6dfd3)', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <button type="button" onClick={() => wrapSelection('**', '**')} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid transparent', background: 'transparent', fontWeight: 800, cursor: 'pointer' }}>B</button>
            <button type="button" onClick={() => wrapSelection('*', '*')} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid transparent', background: 'transparent', fontStyle: 'italic', cursor: 'pointer' }}>I</button>
            <button type="button" onClick={() => wrapSelection('「', '」')} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid transparent', background: 'transparent', cursor: 'pointer' }}>「」</button>
            <span style={{ opacity: 0.25 }}>|</span>
            {(['left', 'center', 'justify'] as const).map((al) => (
              <button
                key={al}
                type="button"
                onClick={() => setTextAlign(al)}
                style={{ padding: '3px 7px', borderRadius: 6, border: 'none', background: textAlign === al ? 'rgba(140,59,43,0.14)' : 'transparent', cursor: 'pointer', fontSize: 12 }}
              >
                {al === 'left' ? '左' : al === 'center' ? '中' : '齐'}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPageWidth((v) => !v)}
              style={{ marginLeft: 8, padding: '3px 9px', borderRadius: 6, border: 'none', background: pageWidth ? 'rgba(140,59,43,0.14)' : 'transparent', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}
            >
              页宽正文
            </button>
            {isCurrentLocked && !selectedAsset && (
              <span style={{ marginLeft: 'auto', color: '#b45309', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Lock size={12} /> 前 {active.lockedEpisodes} 集锁定稿（只读保护）
              </span>
            )}
          </div>

          {/* Editor Canvas */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 26px' }}>
            <div style={{ maxWidth: pageWidth ? 720 : '100%', margin: '0 auto' }}>
              {error && <div style={{ padding: 10, borderRadius: 10, background: '#fee2e2', color: '#991b1b', marginBottom: 12, fontSize: 13 }}>{error}</div>}
              {toast && <div style={{ padding: 10, borderRadius: 10, background: 'rgba(22,163,74,0.12)', color: '#15803d', marginBottom: 12, fontSize: 13 }}><Check size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />{toast}</div>}
              <textarea
                ref={textareaRef}
                readOnly={isCurrentLocked && !selectedAsset}
                value={epBody}
                onChange={(e) => setEpBody(e.target.value)}
                placeholder={selectedAsset ? '在这里编写大纲、角色小传或世界观设定…' : '开始撰写本集剧本正文…'}
                style={{
                  width: '100%',
                  minHeight: 'calc(100vh - 240px)',
                  padding: 24,
                  borderRadius: 14,
                  border: '1px solid var(--warm-border, #e6dfd3)',
                  background: 'var(--warm-card, #fff)',
                  fontSize: 15,
                  lineHeight: 1.85,
                  textAlign,
                  resize: 'vertical',
                  fontFamily: 'inherit',
                }}
              />
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: 创作台 / 技能 / 设定 + Desensitized Tiers / Thinking / Auto-Plan */}
        <aside style={{ borderLeft: '1px solid var(--warm-border, #e6dfd3)', background: 'var(--warm-card, #fff)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '0 14px', borderBottom: '1px solid var(--warm-border, #e6dfd3)', display: 'flex', alignItems: 'center', gap: 16, height: 46 }}>
            {(
              [
                ['chat', '创作台'],
                ['skills', '技能'],
                ['rules', '设定'],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setRightTab(k)}
                style={{
                  height: '100%',
                  border: 'none',
                  borderBottom: rightTab === k ? '2px solid #8C3B2B' : '2px solid transparent',
                  background: 'transparent',
                  color: rightTab === k ? '#8C3B2B' : 'inherit',
                  fontWeight: rightTab === k ? 700 : 500,
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                {lbl}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rightTab === 'chat' && (
              <>
                {active.messages.length <= 1 && (
                  <div style={{ textAlign: 'center', padding: '12px 6px' }}>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>✦ 你的总编剧搭档</div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 14 }}>下一段好故事，从这里开始</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, textAlign: 'left' }}>
                      {[
                        ['梳理全剧逻辑', '找出矛盾，把事件线对上', '请通读当前已有剧集和大纲，找出前后矛盾，并梳理一条能对上的事件线。'],
                        ['打磨这一集', '逐句看节奏、前3秒与尾钩', '请逐段打磨当前这一集，优化前3秒冲突和结尾钩子，并给出改写建议。'],
                        ['给本集挂卡写', '承接剧情，保住文风续写', '请按当前文风续写一段承接剧情，让本集自然衔接下一集。'],
                        ['一起找漏洞', '找出漏洞并给3个新情节改法', '请找出当前故事里的漏洞，并给出三个能长出新冲突的改法。'],
                      ].map(([t, hint, pr]) => (
                        <button
                          key={t}
                          type="button"
                          disabled={busy}
                          onClick={() => sendChat(pr)}
                          style={{ padding: 10, borderRadius: 10, border: '1px solid #e6dfd3', background: 'var(--warm-surface, #faf7f2)', cursor: 'pointer', textAlign: 'left' }}
                        >
                          <div style={{ fontWeight: 700, fontSize: 12 }}>{t}</div>
                          <div style={{ fontSize: 11, opacity: 0.68, marginTop: 2 }}>{hint}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

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
                      border: m.role === 'user' ? 'none' : '1px solid #e6dfd3',
                      fontSize: 13,
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {m.text}
                  </div>
                ))}

                {busy && (
                  <div role="status" style={{ padding: 12, borderRadius: 12, background: 'rgba(212,155,84,0.14)', border: '1px solid #D49B54', fontSize: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#8C3B2B' }}>
                      <LoaderCircle className="spin" size={14} /> 正在处理 · 已用时 {elapsedSec} 秒
                    </div>
                    <div style={{ marginTop: 4, opacity: 0.82 }}>{busyText}</div>
                  </div>
                )}
              </>
            )}

            {rightTab === 'skills' && (
              <>
                <div style={{ fontSize: 12, opacity: 0.7 }}>启用提示词技能后，系统会按所选规则生成内容（后台管理员可随时热替换）。</div>
                <input
                  value={skillSearch}
                  onChange={(e) => setSkillSearch(e.target.value)}
                  placeholder="搜索提示词技能…"
                  style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid #d8cfc0', fontSize: 13 }}
                />
                {skillOptions.length === 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.6, padding: 16, textAlign: 'center' }}>
                    当前使用系统内置规则（管理员可在后台上传更多提示词插件）。
                  </div>
                ) : (
                  skillOptions.map((sk) => {
                    const isPrimary = active.promptSelections?.[active.kind]?.primary === sk.id;
                    const isSec = active.promptSelections?.[active.kind]?.secondary === sk.id;
                    const enabled = isPrimary || isSec;
                    return (
                      <div key={sk.id} style={{ padding: 12, borderRadius: 12, border: enabled ? '1.5px solid #8C3B2B' : '1px solid #e6dfd3', background: 'var(--warm-surface, #faf7f2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>✦ {sk.name}</div>
                          <div style={{ fontSize: 11, opacity: 0.72, marginTop: 2 }}>{sk.description || '专用创作提示词'}</div>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            const updated = await studioApi('/api/studio', {
                              operation: 'set_prompts',
                              id: active.id,
                              version: active.version,
                              kind: active.kind,
                              primaryPluginId: enabled ? '' : sk.id,
                            });
                            syncProject(updated, true);
                            setToast(enabled ? '已取消该提示词' : `已启用「${sk.name}」`);
                          }}
                          style={{ padding: '5px 10px', borderRadius: 8, border: 'none', background: enabled ? '#8C3B2B' : '#e6dfd3', color: enabled ? '#fff' : '#2C2420', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                        >
                          {enabled ? '已启用' : '启用'}
                        </button>
                      </div>
                    );
                  })
                )}
              </>
            )}

            {rightTab === 'rules' && (
              <>
                <div style={{ fontSize: 12, opacity: 0.72 }}>这里配置的规则会自动注入上下文：全局规矩对所有作品生效，本剧规则仅对当前作品生效。</div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 700 }}>
                  全局规矩（所有作品通用）
                  <textarea
                    rows={4}
                    value={globalRules}
                    onChange={(e) => setGlobalRules(e.target.value)}
                    placeholder="例如：前 3 秒必出冲突、禁止说教腔、每集尾留钩子…"
                    style={{ padding: 10, borderRadius: 10, border: '1px solid #d8cfc0', fontSize: 12 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 700 }}>
                  本剧规则（仅《{active.title}》生效）
                  <textarea
                    rows={4}
                    value={projectRules}
                    onChange={(e) => setProjectRules(e.target.value)}
                    placeholder="例如：主角称呼固定、前 10 集锁定一字不动…"
                    style={{ padding: 10, borderRadius: 10, border: '1px solid #d8cfc0', fontSize: 12 }}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await fetch('/api/profile', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ globalRules }),
                      });
                      const updated = await studioApi('/api/studio', {
                        operation: 'save_rules',
                        id: active.id,
                        version: active.version,
                        projectRules,
                      });
                      syncProject(updated, true);
                      setToast('全局规矩与本剧规则已保存');
                    } catch (e: any) {
                      setError(e.message || '保存规则失败');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: '#8C3B2B', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                >
                  保存双层规则
                </button>
              </>
            )}
          </div>

          {/* Bottom 2-Row Composer (Desensitized Tiers + Thinking + Auto/Plan) */}
          <div style={{ padding: 12, borderTop: '1px solid var(--warm-border, #e6dfd3)', background: 'var(--warm-surface, #faf7f2)' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <textarea
                rows={2}
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendChat();
                  }
                }}
                placeholder="输入指令或创作要求…"
                style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: '1px solid #d8cfc0', background: 'var(--warm-card, #fff)', fontSize: 13, resize: 'none' }}
              />
              <button
                type="button"
                disabled={busy || !chatText.trim()}
                onClick={() => sendChat()}
                aria-label="发送"
                style={{ alignSelf: 'flex-end', padding: '9px 12px', borderRadius: 10, border: 'none', background: '#8C3B2B', color: '#fff', cursor: 'pointer' }}
              >
                <Send size={15} />
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {/* Desensitized Creation Tier Dropdown */}
              <select
                aria-label="创作档位"
                value={selectedTier?.id || ''}
                onChange={(e) => updateExecution({ preferredTierId: e.target.value })}
                style={{ padding: '4px 8px', borderRadius: 999, border: '1px solid #d8cfc0', background: 'var(--warm-card, #fff)', fontSize: 11, fontWeight: 600 }}
              >
                {tierCatalog.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}（{t.costHint}）
                  </option>
                ))}
              </select>

              {/* Thinking Level Dropdown */}
              <select
                aria-label="思考强度"
                disabled={selectedTier ? !selectedTier.supportsThinking : false}
                value={active.thinkingLevel || 'medium'}
                onChange={(e) => updateExecution({ thinkingLevel: e.target.value as ThinkingLevel })}
                style={{ padding: '4px 8px', borderRadius: 999, border: '1px solid #d8cfc0', background: 'var(--warm-card, #fff)', fontSize: 11, fontWeight: 600 }}
              >
                {(['off', 'low', 'medium', 'high', 'xhigh', 'max'] as ThinkingLevel[]).map((lv) => (
                  <option key={lv} value={lv}>
                    ⚡ 推理·{THINKING_LABELS[lv]}
                  </option>
                ))}
              </select>

              {/* Auto / Plan Mode Toggle */}
              <button
                type="button"
                onClick={() => updateExecution({ executionMode: active.executionMode === 'plan' ? 'auto' : 'plan' })}
                title={active.executionMode === 'plan' ? '计划模式：仅对话规划，不写入正文' : '自动模式：允许自动写入模块'}
                style={{
                  padding: '4px 10px',
                  borderRadius: 999,
                  border: '1px solid #8C3B2B',
                  background: active.executionMode === 'plan' ? 'transparent' : 'rgba(140,59,43,0.12)',
                  color: '#8C3B2B',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {active.executionMode === 'plan' ? '📋 计划模式' : '📝 自动模式'}
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* Enhancement Tool Modals */}
      {toolModal && (
        <div
          onClick={() => setToolModal('')}
          style={{ position: 'fixed', inset: 0, background: 'rgba(28,22,18,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 95, padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 620, maxHeight: '82vh', overflowY: 'auto', background: 'var(--warm-card, #fff)', borderRadius: 18, padding: 24 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 17 }}>
                {toolModal === 'inspire'
                  ? '💡 灵感点子'
                  : toolModal === 'ai-rate'
                  ? '🔍 AI 痕迹检测'
                  : toolModal === 'trending'
                  ? '🔥 热点扫榜'
                  : toolModal === 'teardown'
                  ? '📖 拆书 / 文风分析'
                  : '🕒 本集历史版本'}
              </h3>
              <button type="button" onClick={() => setToolModal('')} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            {toolModal === 'inspire' && (
              <div>
                <div style={{ padding: 14, borderRadius: 12, background: 'var(--warm-surface, #faf7f2)', minHeight: 100, whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.7 }}>
                  {busy ? '正在生成灵感…' : toolOutput?.result || '点击下方生成灵感'}
                </div>
                <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button type="button" disabled={busy} onClick={() => runStudioTool('inspire')} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d8cfc0', background: 'transparent', cursor: 'pointer', fontSize: 12 }}>
                    换一个
                  </button>
                  {toolOutput?.result && !isCurrentLocked && (
                    <button
                      type="button"
                      onClick={() => {
                        setEpBody((prev) => `${prev}\n\n${toolOutput.result}`);
                        setToolModal('');
                        setToast('已插入正文');
                      }}
                      style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#8C3B2B', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}
                    >
                      插入正文
                    </button>
                  )}
                </div>
              </div>
            )}

            {toolModal === 'ai-rate' && (
              <div>
                {busy ? (
                  <p style={{ fontSize: 13 }}>正在检测当前集文本特征…</p>
                ) : toolOutput ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700 }}>
                        <span>人工自然度</span>
                        <span>{toolOutput.humanRate ?? 78}%</span>
                      </div>
                      <div style={{ height: 10, borderRadius: 999, background: '#e6dfd3', overflow: 'hidden', marginTop: 4 }}>
                        <div style={{ width: `${toolOutput.humanRate ?? 78}%`, height: '100%', background: '#16a34a' }} />
                      </div>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700 }}>
                        <span>疑似 AI 痕迹率</span>
                        <span>{toolOutput.suspectRate ?? 22}%</span>
                      </div>
                      <div style={{ height: 10, borderRadius: 999, background: '#e6dfd3', overflow: 'hidden', marginTop: 4 }}>
                        <div style={{ width: `${toolOutput.suspectRate ?? 22}%`, height: '100%', background: '#d97706' }} />
                      </div>
                    </div>
                    <p style={{ fontSize: 13, opacity: 0.85, margin: 0 }}>{toolOutput.summary || toolOutput.result}</p>
                  </div>
                ) : (
                  <p style={{ fontSize: 13, opacity: 0.7 }}>正文至少 120 字后可获得更精准的检测结果。</p>
                )}
              </div>
            )}

            {toolModal === 'trending' && (
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {TRENDING_PLATFORMS.map((pl) => (
                    <button
                      key={pl}
                      type="button"
                      onClick={() => {
                        setTrendingPlatform(pl);
                        runStudioTool('trending', { platform: pl });
                      }}
                      style={{
                        textAlign: 'left',
                        padding: '7px 10px',
                        borderRadius: 8,
                        border: 'none',
                        background: trendingPlatform === pl ? 'rgba(140,59,43,0.12)' : 'transparent',
                        color: trendingPlatform === pl ? '#8C3B2B' : 'inherit',
                        fontWeight: trendingPlatform === pl ? 700 : 500,
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      {pl}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                  {busy ? '正在拉取热点趋势…' : toolOutput?.result || (toolOutput?.items || []).map((x: any, i: number) => `${i + 1}. ${x.title || x}`).join('\n')}
                </div>
              </div>
            )}

            {toolModal === 'teardown' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input
                  value={teardownSource}
                  onChange={(e) => setTeardownSource(e.target.value)}
                  placeholder="来源名称（书名 / 章节）"
                  style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid #d8cfc0', fontSize: 13 }}
                />
                <textarea
                  rows={5}
                  value={teardownText}
                  onChange={(e) => setTeardownText(e.target.value)}
                  placeholder="粘贴参考文本进行文风与节奏拆解…"
                  style={{ padding: 10, borderRadius: 10, border: '1px solid #d8cfc0', fontSize: 13 }}
                />
                <button
                  type="button"
                  disabled={busy || !teardownText.trim()}
                  onClick={() => runStudioTool('teardown', { sourceName: teardownSource, text: teardownText })}
                  style={{ alignSelf: 'flex-end', padding: '8px 16px', borderRadius: 8, border: 'none', background: '#8C3B2B', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
                >
                  {busy ? '分析中…' : '开始拆书分析'}
                </button>
                {toolOutput?.result && (
                  <div style={{ padding: 12, borderRadius: 10, background: 'var(--warm-surface, #faf7f2)', whiteSpace: 'pre-wrap', fontSize: 13 }}>
                    {toolOutput.result}
                  </div>
                )}
              </div>
            )}

            {toolModal === 'history' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(currentEpisode?.snapshots || []).length === 0 ? (
                  <p style={{ fontSize: 13, opacity: 0.65 }}>暂无历史版本快照，点击「保存本章」后会自动留存版本。</p>
                ) : (
                  (currentEpisode?.snapshots || []).map((snap) => (
                    <div key={snap.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 10, borderRadius: 10, border: '1px solid #e6dfd3' }}>
                      <span style={{ fontSize: 12 }}>
                        <Clock size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                        {new Date(snap.at).toLocaleString('zh-CN')} · {snap.body.length} 字
                      </span>
                      <button
                        type="button"
                        disabled={isCurrentLocked}
                        onClick={async () => {
                          const updated = await studioApi('/api/studio', {
                            operation: 'restore_episode_snapshot',
                            id: active.id,
                            version: active.version,
                            episodeId: currentEpisode?.id,
                            snapshotId: snap.id,
                          });
                          syncProject(updated, true);
                          setEpBody(snap.body);
                          setToolModal('');
                          setToast('已恢复到该历史版本');
                        }}
                        style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#8C3B2B', color: '#fff', fontSize: 12, cursor: 'pointer' }}
                      >
                        恢复此版
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </WarmShell>
  );
}
