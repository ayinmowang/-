import fs from 'node:fs';
import path from 'node:path';

/**
 * Gitless GitHub Commit & Push Script via GitHub REST Git Data API
 * Usage:
 *   node scripts/push-to-github.mjs <GITHUB_TOKEN> [commit_message]
 * Or set env GITHUB_TOKEN=ghp_xxx
 */
const OWNER = 'ayinmowang';
const REPO = '-';
const BRANCH = 'main';

const token = process.argv[2] || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const commitMessage =
  process.argv[3] ||
  'feat: upgrade replaceable .md/.txt Skill plugin system, 200MB multi-type uploads, and multi-account admin console';

if (!token) {
  console.error(
    '缺少 GitHub Personal Access Token (PAT)。请执行：\n  node scripts/push-to-github.mjs <你的GitHub_Token>'
  );
  process.exit(1);
}

const EXCLUDE_DIRS = new Set(['node_modules', '.next', '.data', '.agents', '.git', 'source-extracted', 'zip-stage']);
const EXCLUDE_FILES = new Set(['.env', '.env.local', 'tsconfig.tsbuildinfo']);

async function ghApi(endpoint, method = 'GET', body) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${endpoint}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`GitHub API ${method} ${endpoint} failed (${res.status}): ${errText}`);
  }
  return res.json();
}

function collectFiles(dir, prefix = '剧本工作台') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry.name) || EXCLUDE_FILES.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const repoPath = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, repoPath));
    } else if (entry.isFile()) {
      files.push({ fullPath, repoPath });
    }
  }
  return files;
}

async function main() {
  console.log(`正在连接 GitHub 仓库 ${OWNER}/${REPO} (${BRANCH})...`);
  const refData = await ghApi(`/git/ref/heads/${BRANCH}`);
  const latestCommitSha = refData.object.sha;
  const latestCommit = await ghApi(`/git/commits/${latestCommitSha}`);
  const baseTreeSha = latestCommit.tree.sha;

  const workDir = process.cwd();
  const files = collectFiles(workDir, '剧本工作台');
  console.log(`共扫描到 ${files.length} 个待同步文件（已自动排除 .data/、密钥与 node_modules/）...`);

  const treeItems = [];
  const CONCURRENCY = 8;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (f) => {
        const buf = fs.readFileSync(f.fullPath);
        const blob = await ghApi('/git/blobs', 'POST', {
          content: buf.toString('base64'),
          encoding: 'base64',
        });
        process.stdout.write('.');
        return {
          path: f.repoPath,
          mode: '100644',
          type: 'blob',
          sha: blob.sha,
        };
      })
    );
    treeItems.push(...results);
  }
  console.log('\n正在创建 Git Tree 与 Commit...');

  const newTree = await ghApi('/git/trees', 'POST', {
    base_tree: baseTreeSha,
    tree: treeItems,
  });

  const newCommit = await ghApi('/git/commits', 'POST', {
    message: commitMessage,
    tree: newTree.sha,
    parents: [latestCommitSha],
  });

  await ghApi(`/git/refs/heads/${BRANCH}`, 'PATCH', {
    sha: newCommit.sha,
    force: false,
  });

  console.log(`✓ 已成功推送更新至 https://github.com/${OWNER}/${REPO} (Commit: ${newCommit.sha})`);
}

main().catch((err) => {
  console.error('推送失败:', err.message);
  process.exit(1);
});
