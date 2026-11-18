import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: '总编剧 · 剧本工作台 (STORY STUDIO)',
  description: '以聊天为核心的 AI 短剧改编与原创总编剧工作台，完整支持国外迭代、国内迭代、扒剧与原创四类业务流程。',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
