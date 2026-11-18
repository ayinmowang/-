'use client';
import React, { useEffect, useState } from 'react';

export default function AdminConsolePage() {
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [directorModel, setDirectorModel] = useState('gpt-4o');
  const [visionModel, setVisionModel] = useState('gpt-4o');
  const [writerModel, setWriterModel] = useState('claude-3-5-sonnet-latest');
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    try {
      const cfg = JSON.parse(localStorage.getItem('story_studio_api_config') || '{}');
      if (cfg.baseUrl) setBaseUrl(cfg.baseUrl);
      if (cfg.apiKey) setApiKey(cfg.apiKey);
      if (cfg.directorModel) setDirectorModel(cfg.directorModel);
      if (cfg.visionModel) setVisionModel(cfg.visionModel);
      if (cfg.writerModel) setWriterModel(cfg.writerModel);
    } catch (_) {}
  }, []);

  const handleSave = () => {
    localStorage.setItem('story_studio_api_config', JSON.stringify({ baseUrl, apiKey, directorModel, visionModel, writerModel }));
    setStatusMsg('✓ 配置已保存！前台「剧本工作台 (/)」已自动同步此接口与模型路由配置。');
  };

  return (
    <main style={{ minHeight: '100vh', background: '#0c0e12', color: '#f3f5f8', padding: '32px 24px', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', display: 'grid', gap: 20 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#141821', padding: '18px 22px', borderRadius: 18 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 18 }}>🛡️ 剧本工作台 · 独立管理后台 (/admin)</h1>
            <small style={{ color: '#939db0' }}>独立后台路由 · 与创作者前台完全分离</small>
          </div>
          <a href="/" style={{ color: '#7cc0ff', textDecoration: 'none', fontSize: 13 }}>前往创作者前台 (/) ↗</a>
        </header>
        <section style={{ background: '#141821', padding: 22, borderRadius: 18 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>六大 AI 编剧工位接口与模型绑定</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
            <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#939db0' }}>1. 接口地址 (API Base URL)<input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} /></label>
            <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#939db0' }}>2. 接口密钥 (API Key)<input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." /></label>
            <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#939db0' }}>3. 总编剧 & 原稿分析师模型<input value={directorModel} onChange={e => setDirectorModel(e.target.value)} /></label>
            <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#939db0' }}>4. 扒剧小能手（视觉/字幕还原）模型<input value={visionModel} onChange={e => setVisionModel(e.target.value)} /></label>
            <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#939db0' }}>5. 分集编剧 & 剧本精修模型<input value={writerModel} onChange={e => setWriterModel(e.target.value)} /></label>
          </div>
          <div style={{ marginTop: 16 }}>
            <button onClick={handleSave} style={{ padding: '10px 18px', borderRadius: 999, border: 0, background: '#0a84ff', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>💾 保存配置并同步到前台</button>
          </div>
          {statusMsg && <p style={{ marginTop: 12, color: '#30d158', fontSize: 13 }}>{statusMsg}</p>}
        </section>
      </div>
    </main>
  );
}
