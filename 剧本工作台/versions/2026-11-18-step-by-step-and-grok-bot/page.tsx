'use client';
import React, { useEffect, useRef, useState } from 'react';
import { Kind, Attachment } from '../lib/types';

interface ChatTurn { id: string; role: 'user' | 'director'; text: string; time: string; }
const labels: Record<Kind, string> = { transcribe: '扒剧', foreign: '国外迭代国外', domestic: '国内迭代国外', original: '原创' };

function detectEpisodeFromName(name: string): number | undefined {
  const base = name.replace(/\.[^.]+$/, '');
  if (/\d+\s*[-_]\s*\d+/.test(base) || /20\d{6}/.test(base)) return undefined;
  const m = base.match(/(?:第\s*0*(\d{1,3})\s*[集话期]|(?:^|[^a-zA-Z0-9])(?:ep|episode|e)\s*0*(\d{1,3})(?:$|[^0-9]))/i);
  const raw = m?.[1] ?? m?.[2];
  return raw && Number(raw) >= 1 && Number(raw) <= 300 ? Number(raw) : undefined;
}

export default function StoryStudioPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [surface, setSurface] = useState<'chat' | 'workspace'>('chat');
  const [kind, setKind] = useState<Kind>('transcribe');
  const [title] = useState('北美狼人/豪门分集扒剧还原');
  const [phase, setPhase] = useState<number>(-1);
  const [transcribeMode, setTranscribeMode] = useState<'' | 'fast' | 'detailed'>('');
  const [castLock, setCastLock] = useState('男主：凯尔（Kale Norton）｜女主：南希（Nancy Percy）｜反派：丽莎（Lisa）');
  const [manualGapText, setManualGapText] = useState('凯尔亮出全球仅三张的黑金无限额副卡，店长当场鞠躬核验通过');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [epInputs, setEpInputs] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [typingStatus, setTypingStatus] = useState('总编剧正在输入…');
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const [inputText, setInputText] = useState('');
  const [activeOutTab, setActiveOutTab] = useState<'recap' | 'synopsis' | 'simplified' | 'traditional'>('recap');

  const streamDirectorReply = (fullText: string, statusLabel = '总编剧正在输入…') => {
    setIsTyping(true);
    setTypingStatus(statusLabel);
    setCardReady(false);
    setTimeout(() => {
      setIsTyping(false);
      const id = 'd-' + Date.now();
      const now = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      setMessages(prev => [...prev, { id, role: 'director', text: '', time: now }]);
      setStreamingId(id);
      let idx = 0;
      const step = Math.max(2, Math.ceil(fullText.length / 22));
      const iv = setInterval(() => {
        idx = Math.min(fullText.length, idx + step);
        const slice = fullText.slice(0, idx);
        setMessages(prev => prev.map(m => (m.id === id ? { ...m, text: slice } : m)));
        if (idx >= fullText.length) {
          clearInterval(iv);
          setStreamingId(null);
          setCardReady(true);
        }
      }, 18);
    }, 260);
  };

  useEffect(() => {
    streamDirectorReply('嗨！页面已清空，我们先跑「扒剧」流程，所有步骤都会一项项出现。第一步，请先上传你的分集视频或导出表（也可以点下方按钮载入测试视频）：', '总编剧正在输入…');
  }, []);

  const needsEpisode = attachments.some(a => !a.episode);
  const effectivePhase = attachments.length === 0 ? -1 : needsEpisode ? 0 : phase < 0 ? 0 : phase;

  const handleFilesUpload = (fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const nextAtts: Attachment[] = files.map((f, i) => ({ id: 'att-' + Date.now() + '-' + i, name: f.name, size: f.size || 5200000, episode: detectEpisodeFromName(f.name), durationSec: 68 }));
    setAttachments(prev => [...prev, ...nextAtts]);
    setPhase(0);
    setMessages(prev => [...prev, { id: 'u-' + Date.now(), role: 'user', text: `📎 已上传 ${files.length} 份素材：${files.map(f => f.name).join('、')}`, time: '14:20' }]);
    streamDirectorReply(`已收到你上传的 ${files.length} 份素材！请先在下方第 1 项卡片核对或补录集号，完成后进入下一项：`, '总编剧正在看片核对集号…');
  };

  const handleLoadDemo = () => {
    setAttachments([
      { id: 'att-t1', name: '第01集.mp4', size: 6420100, episode: 1, durationSec: 72 },
      { id: 'att-t2', name: '微信视频_20261113_片段1-1.mp4', size: 5912000, episode: undefined, durationSec: 65 },
    ]);
    setEpInputs({ 'att-t2': '2' });
    setPhase(0);
    setMessages(prev => [...prev, { id: 'u-' + Date.now(), role: 'user', text: '🎬 我上传了 2 份分集视频：第01集.mp4、微信视频_20261113_片段1-1.mp4', time: '14:20' }]);
    streamDirectorReply('收到你的 2 份视频！「第01集.mp4」已自动识别为第 1 集（72秒）；「微信视频_20261113_片段1-1.mp4」文件名未标集号，请先在下方把它的集号补上：', '总编剧正在看片核对集号…');
  };

  const handleSaveEpisode = (attId: string) => {
    const val = Number(epInputs[attId] || 2);
    if (!Number.isInteger(val) || val < 1) return;
    setAttachments(prev => prev.map(a => (a.id === attId ? { ...a, episode: val } : a)));
  };

  const buildOutputText = (tab: 'recap' | 'synopsis' | 'simplified' | 'traditional') => {
    if (tab === 'recap') return `# 《${title}》扒剧核对清单\n• 流程：${labels[kind]}\n• 模式：${transcribeMode || '待选择'}\n• 主角译名：${castLock}`;
    if (tab === 'synopsis') return `# 《${title}》故事梗概与人物小传\n• ${castLock}`;
    if (tab === 'traditional') return `# 《${title}》繁體單集劇本\n### 第 1 集\n1-1 日 內 精品店\n▲ 【特寫校準】：${manualGapText}`;
    return `# 《${title}》简体全集剧本（含梗概与小传）\n• ${castLock}\n\n第 1 集\n1-1 日 内 精品店\n▲ 【特写校准】：${manualGapText}`;
  };

  const handleDownloadBundle = () => {
    const content = [buildOutputText('recap'), buildOutputText('synopsis'), buildOutputText('simplified'), buildOutputText('traditional')].join('\n\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    a.download = `${title}-繁简双版交付包.md`;
    a.click();
  };

  const handleSendChat = () => {
    const clean = inputText.trim();
    if (!clean) return;
    setInputText('');
    setMessages(prev => [...prev, { id: 'u-' + Date.now(), role: 'user', text: clean, time: '14:25' }]);
    streamDirectorReply(`收到你的要求：「${clean}」，已记入当前项目台账。`, '总编剧正在思考与整理…');
  };

  return (
    <div className="app-shell" data-theme={theme}>
      <input ref={fileInputRef} type="file" multiple accept="video/*,.mp4,.mov,.srt,.txt,.md,.docx,.xlsx,.csv" style={{ display: 'none' }} onChange={e => handleFilesUpload(e.target.files)} />
      <aside className="sidebar">
        <div className="brand"><span className="brand-icon">✒</span><div>总编剧 Pro<small style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>AI 短剧创作工作台</small></div></div>
        <button className="secondary" onClick={() => { setAttachments([]); setMessages([]); setPhase(-1); setTranscribeMode(''); streamDirectorReply('嗨！已开启空白对话，请先上传分集视频或导出表：'); }}>＋ 新对话 / 清空重跑</button>
        <button className="project-item active" onClick={() => setSurface('chat')}><strong>{title}</strong><small style={{ display: 'block', color: 'var(--muted)', marginTop: 3 }}>{labels[kind]} · 第 {Math.max(1, effectivePhase + 1)}/5 项</small></button>
      </aside>
      <main className="main">
        <header className="topbar">
          <div><span>当前项目 › </span><strong>{title}</strong></div>
          <div className="segmented-control" role="tablist">
            <button className={surface === 'chat' ? 'active' : ''} onClick={() => setSurface('chat')}>💬 总编剧对话 ({labels[kind]})</button>
            <button className={surface === 'workspace' ? 'active' : ''} onClick={() => setSurface('workspace')}>⚡ 实时工作台与输出</button>
          </div>
          <button className="secondary" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? '🌙' : '☀️'}</button>
        </header>
        {surface === 'workspace' ? (
          <div className="workspace-view">
            <div className="decision">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>{title} · 实时工作状态与输出</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="primary" onClick={handleDownloadBundle}>⬇ 下载繁简双版交付包</button>
                  <button className="secondary" onClick={() => setSurface('chat')}>💬 返回对话流</button>
                </div>
              </div>
              <div className="agent-pipeline">
                {['总编剧', '扒剧小能手', '角色人名锚定', '待补写校准', '繁简Word合成', '转迭代接口'].map((role, idx) => (
                  <div key={role} className={`agent-node ${idx < effectivePhase + 1 ? 'done' : idx === effectivePhase + 1 ? 'active' : ''}`}>
                    <strong>0{idx + 1} · {role}</strong>
                    <div style={{ color: 'var(--muted)', marginTop: 4 }}>{idx < effectivePhase + 1 ? '✓ 已完成' : idx === effectivePhase + 1 ? '◐ 进行中' : '○ 待命'}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="decision">
              <div className="preset-chips" style={{ marginTop: 0, marginBottom: 12 }}>
                <button className={`preset-chip ${activeOutTab === 'recap' ? 'active' : ''}`} onClick={() => setActiveOutTab('recap')}>1. 扒剧核对清单</button>
                <button className={`preset-chip ${activeOutTab === 'synopsis' ? 'active' : ''}`} onClick={() => setActiveOutTab('synopsis')}>2. 故事梗概与人物小传</button>
                <button className={`preset-chip ${activeOutTab === 'simplified' ? 'active' : ''}`} onClick={() => setActiveOutTab('simplified')}>3. 简体全集 Word</button>
                <button className={`preset-chip ${activeOutTab === 'traditional' ? 'active' : ''}`} onClick={() => setActiveOutTab('traditional')}>4. 繁体单集 Word</button>
              </div>
              <pre style={{ whiteSpace: 'pre-wrap', background: 'rgba(120,120,128,0.06)', padding: 16, borderRadius: 12, fontSize: 13 }}>{buildOutputText(activeOutTab)}</pre>
            </div>
          </div>
        ) : (
          <div className="conversation minimal-chat">
            <div className="minimal-top-strip">
              <div><strong>{labels[kind]}</strong> · <span>{title}</span></div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="secondary" onClick={() => fileInputRef.current?.click()}>📎 上传视频/表格</button>
                <button className="secondary" onClick={handleLoadDemo}>🎬 载入测试视频</button>
                <button className="primary" onClick={() => setSurface('workspace')}>⚡ 打开实时工作页面与输出 ↗</button>
              </div>
            </div>
            {messages.map(m => (
              <div key={m.id} className={`message ${m.role === 'user' ? 'user' : 'director'}`}>
                {m.role !== 'user' && <span className="director-avatar">✒</span>}
                <div className="message-body">
                  {m.role !== 'user' && <div className="message-meta">总编剧<span>{streamingId === m.id ? '正在打字输出…' : m.time}</span></div>}
                  <div className="message-text">{m.text}{streamingId === m.id && <span className="streaming-caret" />}</div>
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="message director" role="status">
                <span className="director-avatar">✒</span>
                <div className="message-body">
                  <div className="message-meta">总编剧<span>实时响应中</span></div>
                  <div className="typing-bubble"><span className="typing-dots"><i /><i /><i /></span><span style={{ fontSize: 13, color: 'var(--muted)' }}>{typingStatus}</span></div>
                </div>
              </div>
            )}
            {!isTyping && cardReady && (
              <div>
                {effectivePhase >= 0 && (
                  <div className="completed-steps-bar">
                    <button type="button" className="completed-step-pill" onClick={() => fileInputRef.current?.click()}>✓ 已上传 {attachments.length} 份视频 [＋继续添加]</button>
                    {effectivePhase >= 1 && <button type="button" className="completed-step-pill" onClick={() => setPhase(0)}>✓ 1. 集号已核对 [重改]</button>}
                    {effectivePhase >= 2 && <button type="button" className="completed-step-pill" onClick={() => setPhase(1)}>✓ 2. {transcribeMode === 'detailed' ? '详细模式' : '快速模式'} [重改]</button>}
                    {effectivePhase >= 3 && <button type="button" className="completed-step-pill" onClick={() => setPhase(2)}>✓ 3. 人名表已锁定 [重改]</button>}
                    {effectivePhase >= 4 && <button type="button" className="completed-step-pill" onClick={() => setPhase(3)}>✓ 4. 待补写已校准 [重改]</button>}
                  </div>
                )}
                {effectivePhase === -1 ? (
                  <div className="decision">
                    <div className="decision-title"><span>📎</span><div>当前项：请上传分集视频 (.mp4/.mov) 或导出表 (.xlsx/.csv/.srt)<small>所有步骤将一项项出现</small></div></div>
                    <div className="decision-actions">
                      <button className="primary" onClick={() => fileInputRef.current?.click()}>📎 点击选择本地文件上传</button>
                      <button className="secondary" onClick={handleLoadDemo}>🎬 一键载入测试视频包</button>
                    </div>
                  </div>
                ) : effectivePhase === 0 ? (
                  <div className="decision">
                    <div className="decision-title"><span>1</span><div>第 1 项（共 5 项）：核对与补录素材集号</div></div>
                    {attachments.map(a => (
                      <div key={a.id} className="episode-row">
                        <div><strong>🎬 {a.name}</strong></div>
                        {!a.episode ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input type="number" style={{ width: 100 }} value={epInputs[a.id] ?? ''} placeholder="第几集" onChange={e => setEpInputs(prev => ({ ...prev, [a.id]: e.target.value }))} />
                            <button className="primary" onClick={() => handleSaveEpisode(a.id)}>保存集号</button>
                          </div>
                        ) : (
                          <button className="secondary" onClick={() => setAttachments(prev => prev.map(item => (item.id === a.id ? { ...item, episode: undefined } : item)))}>第 {a.episode} 集 · 修改</button>
                        )}
                      </div>
                    ))}
                    <div className="decision-actions">
                      <button className="primary" disabled={needsEpisode} onClick={() => { setPhase(1); setMessages(prev => [...prev, { id: 'u-' + Date.now(), role: 'user', text: '✓ 集号已全部核对无误', time: '14:21' }]); streamDirectorReply('集号全部对齐！现在进入第 2 项：请选择扒剧还原模式（快速模式 / 详细模式，无默认）：'); }}>★ 集号全部核对无误，进入下一项（选择扒剧模式） →</button>
                    </div>
                  </div>
                ) : effectivePhase === 1 ? (
                  <div className="decision">
                    <div className="decision-title"><span>2</span><div>第 2 项（共 5 项）：选择扒剧还原模式（每部剧必选，无默认项）</div></div>
                    <div className="preset-chips">
                      <button type="button" className={`preset-chip ${transcribeMode === 'fast' ? 'active' : ''}`} onClick={() => setTranscribeMode('fast')}>⚡ 快速模式（按整集看写并抽查几集）</button>
                      <button type="button" className={`preset-chip ${transcribeMode === 'detailed' ? 'active' : ''}`} onClick={() => setTranscribeMode('detailed')}>🔍 详细模式（按每秒一帧逐格看完再写）</button>
                    </div>
                    <div className="decision-actions">
                      <button className="primary" disabled={!transcribeMode} onClick={() => { setPhase(2); setMessages(prev => [...prev, { id: 'u-' + Date.now(), role: 'user', text: `我选择：${transcribeMode === 'detailed' ? '详细模式' : '快速模式'}`, time: '14:22' }]); streamDirectorReply('模式已锁定！现在进入第 3 项：请确认全剧主角标准人名表：'); }}>★ 确认模式，进入下一项（锁定人名表） →</button>
                    </div>
                  </div>
                ) : effectivePhase === 2 ? (
                  <div className="decision">
                    <div className="decision-title"><span>3</span><div>第 3 项（共 5 项）：锁定全剧主角标准人名表并启动扒剧</div></div>
                    <input value={castLock} onChange={e => setCastLock(e.target.value)} />
                    <div className="decision-actions">
                      <button className="primary" onClick={() => { setPhase(3); setMessages(prev => [...prev, { id: 'u-' + Date.now(), role: 'user', text: `确认锁定人名表：${castLock}`, time: '14:23' }]); streamDirectorReply('分集还原完成！现在进入第 4 项：请核对第 2 集 00:41 的【待人工補寫】镜头内容：'); }}>★ 确认人名表与清单，立即启动扒剧还原 →</button>
                    </div>
                  </div>
                ) : effectivePhase === 3 ? (
                  <div className="decision">
                    <div className="decision-title"><span>4</span><div>第 4 项（共 5 项）：【待人工補寫】镜头填空校准</div></div>
                    <input value={manualGapText} onChange={e => setManualGapText(e.target.value)} />
                    <div className="decision-actions">
                      <button className="primary" onClick={() => { setPhase(4); setMessages(prev => [...prev, { id: 'u-' + Date.now(), role: 'user', text: `确认补写：${manualGapText}`, time: '14:24' }]); streamDirectorReply('全部搞定！繁简双版 Word 交付包已就绪，请下载或选择转入改编：'); }}>★ 补写校准完成，生成繁简双版 Word 交付包 →</button>
                    </div>
                  </div>
                ) : (
                  <div className="decision">
                    <div className="decision-title"><span>5</span><div>第 5 项（共 5 项）：繁简双版 Word 交付包已就绪</div></div>
                    <div className="decision-actions">
                      <button className="primary" onClick={handleDownloadBundle}>📦 点击下载繁简双版 Word 交付包</button>
                      <button className="secondary" onClick={() => setSurface('workspace')}>⚡ 打开实时工作页面查看全文 ↗</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <div className="composer-area">
          <div className="composer" style={{ display: 'flex', gap: 8 }}>
            <input value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendChat()} placeholder="直接打字跟总编剧沟通要求，或点击右侧按钮上传本地视频/剧本…" />
            <button className="secondary" onClick={() => fileInputRef.current?.click()}>📎 上传</button>
            <button className="primary" onClick={handleSendChat}>↑</button>
          </div>
        </div>
      </main>
    </div>
  );
                    }
