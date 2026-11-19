import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: '剧本工作台 · 暖纸墨韵创作系统',
  description: '面向短剧改编、原创写作与拆书扒剧的专业工作台，支持多账号隔离与创作档位调度。',
};

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('studio_theme');if(t==='dark'){document.documentElement.setAttribute('data-theme','dark');document.documentElement.classList.add('dark');}else{document.documentElement.setAttribute('data-theme','light');document.documentElement.classList.remove('dark');}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
