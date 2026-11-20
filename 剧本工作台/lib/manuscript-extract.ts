import * as path from 'path';
import * as zlib from 'zlib';

export const MANUSCRIPT_DOC_CAP_BYTES = 20 * 1024 * 1024;
export const MANUSCRIPT_TEXT_CAP_BYTES = 5 * 1024 * 1024;
export const MANUSCRIPT_ZIP_MAX_ENTRIES = 512;
export const MANUSCRIPT_ZIP_MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

export type ManuscriptExtractResult = { text: string; error?: string };

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.srt', '.ass', '.vtt']);
const DOC_EXTENSIONS = new Set(['.docx', '.xlsx']);

function cleanXmlText(xml: string): string {
  return xml
    .replace(/<\/w:p>|<\/row>|<\/si>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractManuscriptTextFromBuffer(buf: Buffer, fileName: string): ManuscriptExtractResult {
  try {
    const ext = path.extname(fileName || '').toLowerCase();

    if (TEXT_EXTENSIONS.has(ext)) {
      if (!buf || buf.length > MANUSCRIPT_TEXT_CAP_BYTES) {
        return { text: '', error: 'TEXT_ATTACHMENT_TOO_LARGE' };
      }
      const raw = buf.toString('utf8').replace(/^\uFEFF/, '');
      return { text: raw };
    }

    if (DOC_EXTENSIONS.has(ext)) {
      if (!buf || buf.length < 64 || buf.length > MANUSCRIPT_DOC_CAP_BYTES) {
        return { text: '', error: 'DOC_ATTACHMENT_INVALID_SIZE' };
      }

      const texts: string[] = [];
      let offset = 0;
      let entryCount = 0;

      while (offset + 30 <= buf.length) {
        if (buf.readUInt32LE(offset) !== 0x04034b50) break;

        entryCount += 1;
        if (entryCount > MANUSCRIPT_ZIP_MAX_ENTRIES) {
          return { text: '', error: 'ZIP_TOO_MANY_ENTRIES' };
        }

        const compression = buf.readUInt16LE(offset + 8);
        const compSize = buf.readUInt32LE(offset + 18);
        const uncompSize = buf.readUInt32LE(offset + 22);
        const nameLen = buf.readUInt16LE(offset + 26);
        const extraLen = buf.readUInt16LE(offset + 28);

        const nameStart = offset + 30;
        const nameEnd = nameStart + nameLen;
        const dataStart = nameEnd + extraLen;
        const dataEnd = dataStart + compSize;

        if (dataEnd > buf.length) {
          return { text: '', error: 'ZIP_TRUNCATED' };
        }

        const entryName = buf.subarray(nameStart, nameEnd).toString('utf8');
        const isTarget =
          entryName === 'word/document.xml' ||
          entryName === 'xl/sharedStrings.xml' ||
          entryName.startsWith('xl/worksheets/sheet');

        if (isTarget) {
          const slice = buf.subarray(dataStart, dataEnd);
          let xml = '';

          if (compression === 8) {
            try {
              const inflated = zlib.inflateRawSync(slice, {
                maxOutputLength: MANUSCRIPT_ZIP_MAX_OUTPUT_BYTES,
              });
              xml = inflated.toString('utf8');
            } catch {
              return { text: '', error: 'ZIP_OUTPUT_TOO_LARGE' };
            }
          } else if (compression === 0) {
            if (uncompSize > MANUSCRIPT_ZIP_MAX_OUTPUT_BYTES || slice.length > MANUSCRIPT_ZIP_MAX_OUTPUT_BYTES) {
              return { text: '', error: 'ZIP_OUTPUT_TOO_LARGE' };
            }
            xml = slice.toString('utf8');
          } else {
            offset = dataEnd;
            continue;
          }

          const cleaned = cleanXmlText(xml);
          if (cleaned) {
            texts.push(cleaned);
          }
        }

        offset = dataEnd;
      }

      if (texts.length === 0) {
        return { text: '' };
      }

      return { text: texts.join('\n\n') };
    }

    return { text: '', error: 'UNSUPPORTED_MANUSCRIPT_TYPE' };
  } catch {
    return { text: '', error: 'MANUSCRIPT_EXTRACT_FAILED' };
  }
}
