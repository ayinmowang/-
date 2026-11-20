import assert from 'node:assert/strict';
import { register } from 'node:module';

const hookCode = `
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !path.extname(specifier)) {
    const parentDir = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd();
    for (const ext of ['.ts', '.tsx', '.js', '.mjs']) {
      const candidate = path.resolve(parentDir, specifier + ext);
      if (fs.existsSync(candidate)) {
        return nextResolve(pathToFileURL(candidate).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
`;

register('data:text/javascript,' + encodeURIComponent(hookCode));

const src = await import('../lib/source-materials.ts');

// normalize
assert.deepEqual(src.normalizeCoveredEpisodes(undefined), []);
assert.deepEqual(src.normalizeCoveredEpisodes(null), []);
assert.deepEqual(src.normalizeCoveredEpisodes('1,2'), []);
assert.deepEqual(src.normalizeCoveredEpisodes([1, 1, 3, 2, 0, 301, -1, 1.5, '2', null]), [1, 2, 3]);
assert.deepEqual(src.normalizeCoveredEpisodes([]), []);
assert.deepEqual(src.normalizeCoveredEpisodes([301]), []);

// sourceAttachmentEpisodeNumbers: covered wins; empty covered falls back to episode
assert.deepEqual(src.sourceAttachmentEpisodeNumbers({ name: 'a.docx', role: 'source', episode: 5, coveredEpisodes: [1, 12, 2] }), [1, 2, 12]);
assert.deepEqual(src.sourceAttachmentEpisodeNumbers({ name: 'a.docx', role: 'source', episode: 5, coveredEpisodes: [] }), [5]);
assert.deepEqual(src.sourceAttachmentEpisodeNumbers({ name: 'a.docx', role: 'source', episode: 5 }), [5]);
assert.deepEqual(src.sourceAttachmentEpisodeNumbers({ name: 'a.docx', role: 'source', episode: 301 }), []);
assert.deepEqual(src.sourceAttachmentEpisodeNumbers({ name: 'a.docx', role: 'source' }), []);
assert.equal(src.isSourceAttachmentMapped({ name: 'a.docx', role: 'source', episode: 1 }), true);
assert.equal(src.isSourceAttachmentMapped({ name: 'a.docx', role: 'source', episode: 301 }), false);

// format range uses en dash
assert.equal(src.formatCoveredEpisodeRange([]), '');
assert.equal(src.formatCoveredEpisodeRange([1]), '第1集');
assert.equal(src.formatCoveredEpisodeRange([1,2,3,4,5,6,7,8,9,10,11,12]), '第1–12集');
assert.equal(src.formatCoveredEpisodeRange([1,2,3,8,10,11]), '第1–3、8、10–11集');

// backward compatible auto total
assert.equal(src.resolveAutoTotalFromSources([]), null);
assert.equal(src.resolveAutoTotalFromSources([{ name: '01.mp4', role: 'source', episode: 1 }]), 1);
assert.equal(src.resolveAutoTotalFromSources([
  { name: '01.mp4', role: 'source', episode: 1 },
  { name: '12.mp4', role: 'source', episode: 12 },
]), 12);
assert.equal(src.hasUnmappedSourceMaterials([{ name: 'x.mp4', role: 'source' }]), true);
assert.equal(src.hasUnmappedSourceMaterials([{ name: 'x.mp4', role: 'source', episode: 1 }]), false);

// covered list path
const multi = { name: 'full.docx', role: 'source', coveredEpisodes: [1,2,3,4,5,6,7,8,9,10,11,12] };
assert.deepEqual(src.sourceAttachmentEpisodeNumbers(multi), [1,2,3,4,5,6,7,8,9,10,11,12]);
assert.equal(src.resolveAutoTotalFromSources([multi]), 12);
assert.equal(src.hasUnmappedSourceMaterials([multi]), false);
assert.deepEqual(src.uniqueValidSourceEpisodes([multi, { name: '03.mp4', role: 'source', episode: 3 }]), [1,2,3,4,5,6,7,8,9,10,11,12]);

// overlap conflict
assert.equal(src.hasOverlappingSourceCoverage([
  { name: 'a.docx', role: 'source', coveredEpisodes: [1,2,3] },
  { name: 'b.docx', role: 'source', coveredEpisodes: [3,4] },
]), true);
assert.equal(src.resolveAutoTotalFromSources([
  { name: 'a.docx', role: 'source', coveredEpisodes: [1,2,3] },
  { name: 'b.docx', role: 'source', coveredEpisodes: [3,4] },
]), null);
assert.equal(src.hasOverlappingSourceCoverage([
  { name: 'a.docx', role: 'source', coveredEpisodes: [1,2] },
  { name: 'b.docx', role: 'source', coveredEpisodes: [3,4] },
]), false);
assert.equal(src.resolveAutoTotalFromSources([
  { name: 'a.docx', role: 'source', coveredEpisodes: [1,2] },
  { name: 'b.docx', role: 'source', coveredEpisodes: [3,4] },
]), 4);

// unmapped with covered empty invalid
assert.equal(src.resolveAutoTotalFromSources([
  { name: 'a.docx', role: 'source', coveredEpisodes: [1] },
  { name: 'b.docx', role: 'source' },
]), null);

console.log('HELPER_CONTRACT_OK');
