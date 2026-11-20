const FILE_TYPE_REJECTED_CODE = 'FILE_TYPE_REJECTED';

export function formatCreatorUploadError(raw: string | undefined | null): string {
  if (typeof raw !== 'string') {
    return '上传失败';
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return '上传失败';
  }

  const normalized = trimmed.replace(/^Error:\s*/i, '').trim();
  if (normalized === FILE_TYPE_REJECTED_CODE) {
    return '当前文件类型不被接受。可上传类型包括：视频（mp4/mov/webm/mkv/avi）、字幕（srt/ass/vtt/txt）、文稿（docx/md）、设定或关键帧图片（jpg/jpeg/png/webp）。请重新选择符合要求的文件后重试。';
  }

  return trimmed;
}
