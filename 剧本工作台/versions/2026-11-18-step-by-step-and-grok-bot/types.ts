export type Kind = 'foreign' | 'domestic' | 'transcribe' | 'original';
export type AttachmentRole = 'source' | 'locked' | 'setting' | 'reference';
export type TranscribePhase = -1 | 0 | 1 | 2 | 3 | 4;

export interface FlowOption {
  kind: Kind;
  title: string;
  description: string;
  tag: string;
}

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

export interface Project {
  id: string;
  title: string;
  kind: Kind;
  total: number | null;
  lockedEpisodes?: number | null;
  startEpisode?: number | null;
  confirmed: boolean;
  transcribeMode?: '' | 'fast' | 'detailed';
  transcribePhase?: TranscribePhase;
  castLock?: string;
  manualGapText?: string;
  stopsReleased?: boolean;
  attachments: Attachment[];
  requirements: string[];
}
