import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type TranscribeEvidenceInputSource = 'video' | 'image' | 'manuscript';

export interface SaveTranscribeRawEvidenceInput {
  owner: string;
  projectId: string;
  sourceEpisodes: number[];
  auditId: string;
  inputSource: TranscribeEvidenceInputSource;
  text: string;
}

const ROOT_NAME = '.private-transcribe-evidence';
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Create-or-verify a directory we own. Never chmods; rejects symlinks, non-dirs, foreign owner, non-0700. */
function ensurePrivateDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error('private evidence path is not a plain directory');
  }
  if (process.platform !== 'win32') {
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
      throw new Error('private evidence directory has an unexpected owner');
    }
    if ((st.mode & 0o777) !== 0o700) {
      throw new Error('private evidence directory permissions are not 0700');
    }
  }
}

function writeNewFile(file: string, data: Buffer): void {
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW;
  const fd = fs.openSync(file, flags, 0o600);
  try {
    let off = 0;
    while (off < data.length) {
      off += fs.writeSync(fd, data, off, data.length - off);
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Synchronously stores exact model text plus minimal metadata. Throws on any failure. */
export function saveTranscribeRawEvidence(input: SaveTranscribeRawEvidenceInput): void {
  const { owner, projectId, sourceEpisodes, auditId, inputSource, text } = input;
  if (typeof owner !== 'string' || !owner) throw new Error('evidence: owner required');
  if (typeof projectId !== 'string' || !projectId) throw new Error('evidence: projectId required');
  if (typeof auditId !== 'string' || !auditId) throw new Error('evidence: auditId required');
  if (typeof text !== 'string') throw new Error('evidence: text must be a string');
  if (inputSource !== 'video' && inputSource !== 'image' && inputSource !== 'manuscript') {
    throw new Error('evidence: invalid inputSource');
  }
  if (!Array.isArray(sourceEpisodes) || !sourceEpisodes.every((n) => Number.isInteger(n) && n > 0)) {
    throw new Error('evidence: invalid sourceEpisodes');
  }

  const root = path.resolve(process.cwd(), ROOT_NAME);
  const ownerDir = path.join(root, sha256Hex(owner));
  const projectDir = path.join(ownerDir, sha256Hex(projectId));
  ensurePrivateDir(root);
  ensurePrivateDir(ownerDir);
  ensurePrivateDir(projectDir);

  const id = crypto.randomUUID();
  writeNewFile(path.join(projectDir, `${id}.raw.txt`), Buffer.from(text, 'utf8'));
  const meta = {
    auditId,
    sourceEpisodes: [...sourceEpisodes],
    inputSource,
    textLength: text.length,
    stage: 'captured_before_sanitize_parse',
    reason: 'awaiting_delivery_validation',
  };
  writeNewFile(path.join(projectDir, `${id}.meta.json`), Buffer.from(JSON.stringify(meta), 'utf8'));
}
