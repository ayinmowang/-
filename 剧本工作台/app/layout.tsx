import './globals.css';
import React from 'react';

export const metadata = {
  title: '剧本工作台 · 总编剧',
  description: 'AI 短剧改编、扒剧还原与原创总编剧工作台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
