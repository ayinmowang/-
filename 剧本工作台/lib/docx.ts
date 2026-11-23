import zlib from 'node:zlib';
import { sanitizeForClient } from './server';
import type { Kind, Project, StudioAssetNode, StudioEpisode } from './types';
import { parseTranscribeDeliveryBodies as parseAltBodies } from './transcribe-parse';
import { inspectTranscribeBodiesDelivery as inspectAltBodies } from './transcribe-delivery-guard';
import { uniqueValidSourceEpisodes as uniqueAltEpisodes } from './source-materials';

export interface DocxTableInput {
  headers: string[];
  rows: string[][];
}

export interface DocxSectionInput {
  heading: string;
  body: string;
  locked?: boolean;
  level?: 1 | 2;
}

export interface DocxDocumentInput {
  title: string;
  subtitle?: string;
  synopsis?: string;
  characters?: string;
  characterTable?: DocxTableInput;
  sections: DocxSectionInput[];
  meta?: Record<string, string>;
}

const KIND_LABELS: Record<Kind, string> = {
  foreign: '国外迭代',
  domestic: '国内迭代',
  transcribe: '拆书 · 扒剧',
  original: '原创短剧',
};

let crcTable: Uint32Array | null = null;

function getCrc32Table(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

function computeCrc32(buf: Buffer): number {
  const nativeCrc = (zlib as any).crc32;
  if (typeof nativeCrc === 'function') {
    return nativeCrc(buf) >>> 0;
  }
  const table = getCrc32Table();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function stripInvalidXmlChars(input: string): string {
  const normalized = String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uFFFE\uFFFF]/g, '');
  let out = '';
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = normalized.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += normalized[i] + normalized[i + 1];
        i++;
      } else {
        out += '\uFFFD';
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += '\uFFFD';
    } else {
      out += normalized[i];
    }
  }
  return out;
}

function escapeXml(input: string): string {
  return stripInvalidXmlChars(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getDosDateTime(date = new Date()): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);

  const dosTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);
  return { dosTime, dosDate };
}

interface ZipPartInput {
  name: string;
  data: Buffer;
}

interface ZipCentralRecord {
  offset: number;
  crc: number;
  compSize: number;
  uncompSize: number;
  method: number;
  nameBytes: Buffer;
  dosTime: number;
  dosDate: number;
}

function buildZipArchive(parts: ZipPartInput[]): Buffer {
  const { dosTime, dosDate } = getDosDateTime();
  const chunks: Buffer[] = [];
  const centralRecords: ZipCentralRecord[] = [];
  let offset = 0;

  for (const part of parts) {
    const nameBytes = Buffer.from(part.name, 'utf8');
    const raw = part.data;
    const crc = computeCrc32(raw);

    let method = 0; // STORE
    let payload = raw;
    if (raw.length > 0) {
      const deflated = zlib.deflateRawSync(raw);
      if (deflated.length < raw.length) {
        method = 8; // DEFLATE
        payload = deflated;
      }
    }

    // Local File Header (flags = 0x0800 UTF-8 filename, zero bit-3 data descriptor)
    const localHdr = Buffer.alloc(30 + nameBytes.length);
    localHdr.writeUInt32LE(0x04034b50, 0);
    localHdr.writeUInt16LE(20, 4); // version needed to extract (2.0)
    localHdr.writeUInt16LE(0x0800, 6); // general purpose bit flag (UTF-8 only)
    localHdr.writeUInt16LE(method, 8);
    localHdr.writeUInt16LE(dosTime, 10);
    localHdr.writeUInt16LE(dosDate, 12);
    localHdr.writeUInt32LE(crc, 14);
    localHdr.writeUInt32LE(payload.length, 18);
    localHdr.writeUInt32LE(raw.length, 22);
    localHdr.writeUInt16LE(nameBytes.length, 26);
    localHdr.writeUInt16LE(0, 28); // extra field length
    nameBytes.copy(localHdr, 30);

    centralRecords.push({
      offset,
      crc,
      compSize: payload.length,
      uncompSize: raw.length,
      method,
      nameBytes,
      dosTime,
      dosDate,
    });

    chunks.push(localHdr, payload);
    offset += localHdr.length + payload.length;
  }

  const cdStartOffset = offset;
  let cdSize = 0;

  for (const rec of centralRecords) {
    const cdHdr = Buffer.alloc(46 + rec.nameBytes.length);
    cdHdr.writeUInt32LE(0x02014b50, 0);
    cdHdr.writeUInt16LE(20, 4); // version made by
    cdHdr.writeUInt16LE(20, 6); // version needed
    cdHdr.writeUInt16LE(0x0800, 8); // flags
    cdHdr.writeUInt16LE(rec.method, 10);
    cdHdr.writeUInt16LE(rec.dosTime, 12);
    cdHdr.writeUInt16LE(rec.dosDate, 14);
    cdHdr.writeUInt32LE(rec.crc, 16);
    cdHdr.writeUInt32LE(rec.compSize, 20);
    cdHdr.writeUInt32LE(rec.uncompSize, 24);
    cdHdr.writeUInt16LE(rec.nameBytes.length, 28);
    cdHdr.writeUInt16LE(0, 30); // extra length
    cdHdr.writeUInt16LE(0, 32); // comment length
    cdHdr.writeUInt16LE(0, 34); // disk number start
    cdHdr.writeUInt16LE(0, 36); // internal attrs
    cdHdr.writeUInt32LE(0, 38); // external attrs
    cdHdr.writeUInt32LE(rec.offset, 42);
    rec.nameBytes.copy(cdHdr, 46);

    chunks.push(cdHdr);
    cdSize += cdHdr.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // central dir start disk
  eocd.writeUInt16LE(centralRecords.length, 8);
  eocd.writeUInt16LE(centralRecords.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStartOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length
  chunks.push(eocd);

  return Buffer.concat(chunks);
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="微软雅黑" w:cs="Calibri"/>
        <w:color w:val="2C2420"/>
        <w:sz w:val="21"/>
        <w:szCs w:val="21"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:ind w:firstLine="0" w:left="0"/>
        <w:spacing w:after="120" w:line="320" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr>
      <w:ind w:firstLine="0" w:left="0"/>
      <w:spacing w:after="120" w:line="320" w:lineRule="auto"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="微软雅黑" w:cs="Calibri"/>
      <w:color w:val="2C2420"/>
      <w:sz w:val="21"/>
      <w:szCs w:val="21"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="120" w:after="100" w:line="360" w:lineRule="auto"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:color w:val="8C3B2B"/>
      <w:sz w:val="40"/>
      <w:szCs w:val="40"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:after="160" w:line="280" w:lineRule="auto"/>
    </w:pPr>
    <w:rPr>
      <w:color w:val="6E6359"/>
      <w:sz w:val="20"/>
      <w:szCs w:val="20"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="Heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="280" w:after="140" w:line="340" w:lineRule="auto"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:color w:val="8C3B2B"/>
      <w:sz w:val="30"/>
      <w:szCs w:val="30"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="Heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="220" w:after="100" w:line="320" w:lineRule="auto"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:color w:val="2C2420"/>
      <w:sz w:val="25"/>
      <w:szCs w:val="25"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="SceneHeading">
    <w:name w:val="Scene Heading"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:keepNext/>
      <w:ind w:firstLine="0" w:left="0"/>
      <w:shd w:val="clear" w:color="auto" w:fill="F4EFE6"/>
      <w:spacing w:before="160" w:after="80" w:line="300" w:lineRule="auto"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:color w:val="5C2D22"/>
      <w:sz w:val="22"/>
      <w:szCs w:val="22"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ActionLine">
    <w:name w:val="Action Line"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:ind w:firstLine="0" w:left="0"/>
      <w:spacing w:after="100" w:line="300" w:lineRule="auto"/>
    </w:pPr>
    <w:rPr>
      <w:color w:val="4A3F38"/>
      <w:sz w:val="21"/>
      <w:szCs w:val="21"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="LockedBadge">
    <w:name w:val="Locked Badge"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:shd w:val="clear" w:color="auto" w:fill="FAF0EB"/>
      <w:spacing w:before="60" w:after="100" w:line="280" w:lineRule="auto"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:color w:val="8C3B2B"/>
      <w:sz w:val="19"/>
      <w:szCs w:val="19"/>
    </w:rPr>
  </w:style>
</w:styles>`;

function renderParagraph(text: string, styleId = 'Normal'): string {
  const safe = escapeXml(text);
  return `<w:p><w:pPr><w:pStyle w:val="${styleId}"/><w:ind w:firstLine="0" w:left="0"/></w:pPr><w:r><w:t xml:space="preserve">${safe}</w:t></w:r></w:p>`;
}

function renderMultilineParagraphs(
  rawText: string,
  options: { verbatim?: boolean; style?: string } = {}
): string[] {
  const normalized = stripInvalidXmlChars(rawText);
  if (!normalized) return [];
  const lines = normalized.split('\n');
  const out: string[] = [];

  for (const line of lines) {
    if (options.verbatim) {
      out.push(renderParagraph(line, options.style || 'Normal'));
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      out.push('<w:p><w:pPr><w:ind w:firstLine="0" w:left="0"/></w:pPr></w:p>');
      continue;
    }
    if (options.style) {
      out.push(renderParagraph(trimmed, options.style));
    } else if (
      /^(?:第\s*\d+\s*[集话期]|场次\s*\d+|場次\s*\d+|\d+\s*[-－–—]\s*\d+\s+\S+|Scene\s+\d+|INT\.|EXT\.)/i.test(
        trimmed
      )
    ) {
      out.push(renderParagraph(trimmed, 'SceneHeading'));
    } else if (trimmed.startsWith('△') || trimmed.startsWith('▲')) {
      out.push(renderParagraph(trimmed, 'ActionLine'));
    } else {
      out.push(renderParagraph(trimmed, 'Normal'));
    }
  }
  return out;
}

function renderTableXml(table: DocxTableInput): string {
  const headers = Array.isArray(table.headers) ? table.headers : [];
  const rows = Array.isArray(table.rows) ? table.rows : [];
  if (headers.length === 0 && rows.length === 0) return '';

  const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 1);
  const colWidth = Math.floor(9026 / colCount);

  const renderRow = (cells: string[], isHeader: boolean) => {
    const tds: string[] = [];
    for (let i = 0; i < colCount; i++) {
      const val = escapeXml(cells[i] ?? '');
      const shd = isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="F4EFE6"/>' : '';
      const rPr = isHeader ? '<w:rPr><w:b/><w:color w:val="5C2D22"/></w:rPr>' : '';
      tds.push(
        `<w:tc><w:tcPr><w:tcW w:w="${colWidth}" w:type="dxa"/>${shd}</w:tcPr><w:p><w:r>${rPr}<w:t xml:space="preserve">${val}</w:t></w:r></w:p></w:tc>`
      );
    }
    return `<w:tr>${tds.join('')}</w:tr>`;
  };

  const rowXml: string[] = [];
  if (headers.length > 0) rowXml.push(renderRow(headers, true));
  for (const row of rows) {
    rowXml.push(renderRow(row, false));
  }

  return (
    `<w:tbl>` +
    `<w:tblPr>` +
    `<w:tblW w:w="9026" w:type="dxa"/>` +
    `<w:tblBorders>` +
    `<w:top w:val="single" w:sz="6" w:space="0" w:color="D8CFC2"/>` +
    `<w:left w:val="single" w:sz="6" w:space="0" w:color="D8CFC2"/>` +
    `<w:bottom w:val="single" w:sz="6" w:space="0" w:color="D8CFC2"/>` +
    `<w:right w:val="single" w:sz="6" w:space="0" w:color="D8CFC2"/>` +
    `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="E6DFD3"/>` +
    `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="E6DFD3"/>` +
    `</w:tblBorders>` +
    `</w:tblPr>` +
    rowXml.join('') +
    `</w:tbl>`
  );
}

export function buildDocxBuffer(input: DocxDocumentInput): Buffer {
  const clean = sanitizeForClient(input);
  const bodyBlocks: string[] = [];

  bodyBlocks.push(renderParagraph(clean.title || '未命名剧本', 'Title'));
  if (clean.subtitle) {
    bodyBlocks.push(renderParagraph(clean.subtitle, 'Subtitle'));
  }

  if (clean.meta && typeof clean.meta === 'object') {
    for (const [k, v] of Object.entries(clean.meta)) {
      if (v) {
        bodyBlocks.push(renderParagraph(`${k}：${v}`, 'Normal'));
      }
    }
  }

  if (clean.synopsis && clean.synopsis.trim()) {
    bodyBlocks.push(renderParagraph('一、故事梗概（Synopsis）', 'Heading1'));
    bodyBlocks.push(...renderMultilineParagraphs(clean.synopsis));
  }

  const hasCharTable =
    clean.characterTable &&
    ((clean.characterTable.headers && clean.characterTable.headers.length > 0) ||
      (clean.characterTable.rows && clean.characterTable.rows.length > 0));
  if (hasCharTable || (clean.characters && clean.characters.trim())) {
    bodyBlocks.push(renderParagraph('二、人物小传与锚定表（Character Bios）', 'Heading1'));
    if (hasCharTable && clean.characterTable) {
      bodyBlocks.push(renderTableXml(clean.characterTable));
    }
    if (clean.characters && clean.characters.trim()) {
      bodyBlocks.push(...renderMultilineParagraphs(clean.characters));
    }
  }

  const sections = Array.isArray(clean.sections) ? clean.sections : [];
  for (const sec of sections) {
    if (!sec) continue;
    const headingStyle = sec.level === 2 ? 'Heading2' : 'Heading1';
    if (sec.heading) {
      bodyBlocks.push(renderParagraph(sec.heading, headingStyle));
    }
    if (sec.locked) {
      bodyBlocks.push(
        renderParagraph('【锁定稿保护】该集为已锁定定稿，逐字原样保留', 'LockedBadge')
      );
      bodyBlocks.push(...renderMultilineParagraphs(sec.body || '', { verbatim: true }));
    } else {
      bodyBlocks.push(...renderMultilineParagraphs(sec.body || ''));
    }
  }

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>` +
    bodyBlocks.join('') +
    `<w:sectPr>` +
    `<w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>` +
    `</w:sectPr>` +
    `</w:body>` +
    `</w:document>`;

  return buildZipArchive([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES_XML, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS_XML, 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(DOCUMENT_RELS_XML, 'utf8') },
    { name: 'word/styles.xml', data: Buffer.from(STYLES_XML, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
  ]);
}

function readNodeBody(node: StudioAssetNode | any): string {
  if (!node || typeof node !== 'object') return '';
  if (typeof node.body === 'string') return node.body;
  if (typeof node.content === 'string') return node.content;
  return '';
}

function readEpisodeBody(ep: StudioEpisode | any): string {
  if (!ep || typeof ep !== 'object') return '';
  if (typeof ep.body === 'string') return ep.body;
  if (typeof ep.content === 'string') return ep.content;
  return '';
}

function formatEpisodeDocxHeading(episodeNumber: number, rawTitle?: string): string {
  const title = String(rawTitle || '').trim();
  if (!title) return `第${episodeNumber}集`;
  const redundantRe = new RegExp(`^第\\s*0*${episodeNumber}\\s*集$`);
  if (redundantRe.test(title)) return `第${episodeNumber}集`;
  return `第${episodeNumber}集 · ${title}`;
}

function stripRedundantEpisodeHeadingFromBody(body: string, episodeNumber: number): string {
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i < lines.length) {
    const first = lines[i].trim();
    const matchRe = new RegExp(`^(?:#{1,6}\\s*)?第\\s*0*${episodeNumber}\\s*集(?:《[^》]+》)?\\s*$`);
    if (matchRe.test(first)) {
      i++;
      while (i < lines.length && !lines[i].trim()) i++;
      return lines.slice(i).join('\n').trim();
    }
  }
  return String(body || '').trim();
}

function isPlaceholderSynopsis(text?: string): boolean {
  const t = String(text || '').trim();
  if (!t) return true;
  return (
    t.includes('本交付未单独写出故事梗概') ||
    t.includes('未完成占位：待生成梗概') ||
    t === '（待生成梗概）'
  );
}

function isPlaceholderCharacterText(text?: string): boolean {
  const t = String(text || '').trim();
  if (!t) return true;
  return (
    t === '人物锚定表已归档。' ||
    t.includes('未完成占位：待生成人物小传') ||
    t === '（待生成人物小传）'
  );
}

export function projectToDocxInput(project: Project): DocxDocumentInput {
  const outputs = project.remote?.outputs || {};
  const kindLabel = KIND_LABELS[project.kind] || project.kind;
  const meta: Record<string, string> = {
    流程类型: kindLabel,
    全剧集数: project.total ? `${project.total} 集` : '待确认',
    导出时间: new Date().toISOString(),
  };

  if (project.lockedEpisodes && project.lockedEpisodes > 0) {
    meta['锁定保护'] = `前 ${project.lockedEpisodes} 集已锁定（一字不动），续写范围：第 ${project.lockedEpisodes + 1}–${project.total ?? '末'} 集`;
  }
  if (project.kind === 'transcribe' && project.transcribeMode) {
    meta['扒剧模式'] = project.transcribeMode === 'fast' ? '快速模式' : '详细模式';
  }

  const outlineNodes = Array.isArray(project.outlineNodes) ? project.outlineNodes : [];
  const characterNodes = Array.isArray(project.characterNodes) ? project.characterNodes : [];
  const worldNodes = Array.isArray(project.worldNodes) ? project.worldNodes : [];
  const episodes = Array.isArray(project.episodes) ? project.episodes : [];

  const rootOutlineBody = outlineNodes.map((n) => readNodeBody(n).trim()).find(Boolean);
  const rawSynopsis =
    rootOutlineBody ||
    outputs.synopsis?.content ||
    outputs.recap?.content ||
    project.brief ||
    '（未完成占位：待生成梗概）';
  const synopsis =
    project.kind === 'transcribe' && isPlaceholderSynopsis(rawSynopsis)
      ? undefined
      : rawSynopsis;

  let characters: string | undefined;
  let characterTable: DocxTableInput | undefined;
  const meaningfulCharNodes =
    project.kind === 'transcribe'
      ? characterNodes.filter(
          (n) =>
            !(
              n.title === '核心角色锚定表' &&
              readNodeBody(n).includes('人物定位与声线锚定已完成整理')
            ),
        )
      : characterNodes;
  if (meaningfulCharNodes.length > 0) {
    characterTable = {
      headers: ['角色名', '定位 / 设定详情'],
      rows: meaningfulCharNodes.map((n) => [
        n.title || '未命名角色',
        [n.summary, readNodeBody(n)].filter(Boolean).join(' · ') || '（待补充）',
      ]),
    };
  } else {
    const rawChars = outputs.characters?.content || '（未完成占位：待生成人物小传）';
    characters =
      project.kind === 'transcribe' && isPlaceholderCharacterText(rawChars)
        ? undefined
        : rawChars;
  }

  const sections: DocxSectionInput[] = [];

  if (project.kind === 'domestic' && outputs.gates?.content) {
    sections.push({
      heading: '三、桥段出海四级诊断与三道门方案（Gates）',
      body: outputs.gates.content,
      level: 1,
    });
  }

  if (episodes.length > 0) {
    const sortedEpisodes = [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
    const hasLeadingSections = Boolean(synopsis || characters || characterTable);
    sections.push({
      heading:
        project.kind === 'domestic' && outputs.gates?.content
          ? '四、分集剧本正文'
          : hasLeadingSections
            ? '三、分集剧本正文'
            : '分集剧本正文',
      body: '',
      level: 1,
    });
    for (const ep of sortedEpisodes) {
      const isLocked = Boolean(
        ep.locked || (project.lockedEpisodes && ep.episodeNumber <= project.lockedEpisodes)
      );
      const rawEpBody = readEpisodeBody(ep);
      sections.push({
        heading: formatEpisodeDocxHeading(ep.episodeNumber, ep.title),
        body: isLocked ? rawEpBody : stripRedundantEpisodeHeadingFromBody(rawEpBody, ep.episodeNumber),
        locked: isLocked,
        level: 2,
      });
    }

    const extraOutline = outlineNodes
      .filter(
        (n) =>
          readNodeBody(n).trim() &&
          readNodeBody(n).trim() !== (synopsis || '').trim() &&
          !(project.kind === 'transcribe' && isPlaceholderSynopsis(readNodeBody(n)))
      )
      .map((n) => `【${n.title}】\n${readNodeBody(n)}`);
    const extraWorld = worldNodes
      .filter((n) => readNodeBody(n).trim())
      .map((n) => `【${n.title}】\n${readNodeBody(n)}`);
    if (extraOutline.length > 0 || extraWorld.length > 0) {
      sections.push({
        heading: '附：设定与分集大纲',
        body: [...extraOutline, ...extraWorld].join('\n\n'),
        level: 1,
      });
    }
  } else {
    if (outputs.outline?.content && outputs.outline.content !== outputs.script?.content) {
      sections.push({
        heading: '分集细纲',
        body: outputs.outline.content,
        level: 1,
      });
    }
    const scriptBody =
      outputs.script?.content ||
      outputs.outline?.content ||
      outputs.synopsis?.content ||
      project.brief ||
      '（未完成占位：待生成剧本正文）';
    sections.push({
      heading: '剧本正文',
      body: scriptBody,
      locked: Boolean(project.lockedEpisodes && project.lockedEpisodes > 0),
      level: 1,
    });
  }

  const altOut = project.kind === 'transcribe' ? (outputs as any)?.scriptTraditional : undefined;
  if (altOut) {
    const altEps = uniqueAltEpisodes((project as any).attachments);
    let altBodies = new Map<number, string>();
    try {
      if (typeof altOut.content === 'string' && altOut.content.trim() && altEps.length > 0) {
        altBodies = parseAltBodies(altOut.content, altEps);
      }
    } catch {
      altBodies = new Map<number, string>();
    }
    if (altEps.length === 0 || inspectAltBodies(altEps, altBodies).ok !== true) {
      throw new Error('繁體版分集剧本校验未通过，无法导出 Word，请重新生成或联系管理员。');
    }
    sections.push({ heading: '附：繁體版分集劇本', body: '以下为同一剧本的繁體版分集正文，供对照使用。', level: 1 });
    for (const n of altEps) {
      sections.push({
        heading: `第${n}集（繁體）`,
        body: stripRedundantEpisodeHeadingFromBody(altBodies.get(n) as string, n),
        level: 2,
      });
    }
  }
  return sanitizeForClient({
    title: project.title || '未命名剧本',
    subtitle: `${kindLabel} · 交付剧本包`,
    synopsis,
    characters,
    characterTable,
    sections,
    meta,
  });
}
