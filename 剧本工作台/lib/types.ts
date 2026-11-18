export type Kind = 'foreign' | 'domestic' | 'transcribe' | 'original';
export type AttachmentRole = 'source' | 'locked' | 'setting' | 'reference';
export type TranscribePhase = -1 | 0 | 1 | 2 | 3 | 4;

export interface Attachment {
  id: string;
  name: string;
  size: number;
  type?: string;
  role?: AttachmentRole;
  episode?: number;
  durationSec?: number;
  extractedText?: string;
}
