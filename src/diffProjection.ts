import {
  parsePatchFiles,
  type AnnotationSide,
  type CodeViewDiffItem,
  type CodeViewItem,
  type CodeViewItemScrollTarget,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type ParsedPatch,
} from '@pierre/diffs';
import type { GitStatusEntry } from '@pierre/trees';

const projectedFileIdentityBrand: unique symbol = Symbol('ProjectedFileIdentity');

export type ProjectedFileIdentity = string & { readonly [projectedFileIdentityBrand]: true };
export type ProjectedChangeType = 'new' | 'deleted' | 'renamed' | 'modified';

export interface DiffStats {
  additions: number;
  deletions: number;
  files: number;
}

export interface ProjectedFile {
  id: ProjectedFileIdentity;
  path: string;
  previousPath?: string;
  changeType: ProjectedChangeType;
  additions: number;
  deletions: number;
  collapsed: boolean;
  /** Local file modification time in epoch milliseconds, when the source can provide one. */
  changedAt?: number;
}

export interface DiffProjectionReview {
  id: string;
  body?: string;
  kind?: string;
  target: {
    fileId?: ProjectedFileIdentity;
    path: string;
    side: AnnotationSide;
    endLine: number;
  };
}

export interface CreateDiffProjectionInput<TReview extends DiffProjectionReview> {
  patches: readonly ParsedPatch[];
  /** Files the user has explicitly expanded. Every other file starts collapsed. */
  expandedFileIds: ReadonlySet<ProjectedFileIdentity>;
  reviews: readonly TReview[];
  draftReview: TReview | null;
  /** Local file modification times, used to order files newest-first. Omit to keep patch order. */
  fileTimes?: ReadonlyMap<string, number> | null;
}

export interface DiffProjection<TReview extends DiffProjectionReview> {
  /** Opaque render input for CodeView. Callers should pass it through, not inspect parser metadata. */
  codeViewItems: CodeViewItem<TReview>[];
  files: ProjectedFile[];
  paths: string[];
  stats: DiffStats;
  gitStatus: GitStatusEntry[];
  getFileById(id: ProjectedFileIdentity): ProjectedFile | undefined;
  getFileIdByPath(path: string): ProjectedFileIdentity | undefined;
  getFileForCodeViewItem(item: CodeViewDiffItem<TReview>): ProjectedFile | undefined;
  getScrollTarget(fileId: ProjectedFileIdentity): CodeViewItemScrollTarget | undefined;
}

interface ProjectionEntry<TReview extends DiffProjectionReview> {
  file: ProjectedFile;
  item: CodeViewDiffItem<TReview>;
  gitStatus: GitStatusEntry;
}

export function parseDiffPatch(patch: string, diffKey: string): ParsedPatch[] {
  return parsePatchFiles(patch, encodeURIComponent(diffKey));
}

/** Paths of the files that will become CodeView items, in their original patch order. */
export function listProjectedFilePaths(patches: readonly ParsedPatch[]): string[] {
  const paths: string[] = [];
  for (let patchIndex = 0; patchIndex < patches.length; patchIndex++) {
    const parsedPatch = patches[patchIndex];
    for (let fileIndex = 0; fileIndex < parsedPatch.files.length; fileIndex++) {
      paths.push(getProjectedPath(parsedPatch.files[fileIndex], patchIndex, fileIndex));
    }
  }
  return paths;
}

export function createDiffProjection<TReview extends DiffProjectionReview>({
  patches,
  expandedFileIds,
  reviews,
  draftReview,
  fileTimes,
}: CreateDiffProjectionInput<TReview>): DiffProjection<TReview> {
  const entries: ProjectionEntry<TReview>[] = [];
  const fileIdByPath = new Map<string, ProjectedFileIdentity>();
  const fileById = new Map<ProjectedFileIdentity, ProjectedFile>();
  const fileByRendererItemId = new Map<string, ProjectedFile>();
  const rendererItemIdByFileId = new Map<ProjectedFileIdentity, string>();
  const stats: DiffStats = { additions: 0, deletions: 0, files: 0 };

  for (let patchIndex = 0; patchIndex < patches.length; patchIndex++) {
    const parsedPatch = patches[patchIndex];
    for (let fileIndex = 0; fileIndex < parsedPatch.files.length; fileIndex++) {
      const fileDiff = parsedPatch.files[fileIndex];
      const path = getProjectedPath(fileDiff, patchIndex, fileIndex);
      const fileId = createProjectedFileIdentity(patchIndex, fileIndex, path);
      const rendererItemId = String(fileId);
      const additions = countAdditions(fileDiff);
      const deletions = countDeletions(fileDiff);
      const collapsed = !expandedFileIds.has(fileId);
      const changedAt = fileTimes?.get(path);
      const projectedFile: ProjectedFile = {
        id: fileId,
        path,
        previousPath: fileDiff.prevName,
        changeType: projectChangeType(fileDiff),
        additions,
        deletions,
        collapsed,
        changedAt,
      };
      const annotations = getAnnotations(projectedFile, reviews, draftReview);
      const status = statusForFile(fileDiff);
      const item = {
        id: rendererItemId,
        type: 'diff',
        fileDiff,
        annotations,
        collapsed,
        version: getItemVersion(fileDiff, collapsed, annotations, changedAt),
      } satisfies CodeViewDiffItem<TReview>;

      fileIdByPath.set(path, fileId);
      fileById.set(fileId, projectedFile);
      fileByRendererItemId.set(rendererItemId, projectedFile);
      rendererItemIdByFileId.set(fileId, rendererItemId);
      entries.push({ file: projectedFile, item, gitStatus: { path, status } });
      stats.files++;
      stats.additions += additions;
      stats.deletions += deletions;
    }
  }

  const orderedEntries = orderEntriesByChangedAt(entries);
  const items = orderedEntries.map((entry) => entry.item);
  const files = orderedEntries.map((entry) => entry.file);
  // Tree input keeps patch order; only the CodeView/file navigation order follows changed-at.
  const paths = Array.from(new Set(entries.map((entry) => entry.file.path)));
  const gitStatus = entries.map((entry) => entry.gitStatus);

  return {
    codeViewItems: items,
    files,
    paths,
    stats,
    gitStatus,
    getFileById(id) {
      return fileById.get(id);
    },
    getFileIdByPath(path) {
      return fileIdByPath.get(path);
    },
    getFileForCodeViewItem(item) {
      return fileByRendererItemId.get(item.id);
    },
    getScrollTarget(fileId) {
      const rendererItemId = rendererItemIdByFileId.get(fileId);
      if (rendererItemId == null) {
        return undefined;
      }
      return { type: 'item', id: rendererItemId };
    },
  };
}

function createProjectedFileIdentity(
  patchIndex: number,
  fileIndex: number,
  path: string
): ProjectedFileIdentity {
  return `diff:${patchIndex}:${fileIndex}:${path}` as ProjectedFileIdentity;
}

function getProjectedPath(file: FileDiffMetadata, patchIndex: number, fileIndex: number): string {
  return file.name || file.prevName || `unknown-${patchIndex}-${fileIndex}`;
}

/**
 * Order files newest-first by their local modification time. Files without a
 * timestamp (deleted files, or sources that cannot provide one) keep their
 * original patch order at the end.
 */
function orderEntriesByChangedAt<TEntry extends { file: ProjectedFile }>(
  entries: readonly TEntry[]
): TEntry[] {
  if (!entries.some((entry) => entry.file.changedAt != null)) {
    return [...entries];
  }

  return entries
    .map((entry, index) => ({ entry, index, changedAt: entry.file.changedAt }))
    .sort((left, right) => {
      const leftChangedAt = left.changedAt ?? Number.NEGATIVE_INFINITY;
      const rightChangedAt = right.changedAt ?? Number.NEGATIVE_INFINITY;
      if (leftChangedAt !== rightChangedAt) {
        return rightChangedAt - leftChangedAt;
      }
      return left.index - right.index;
    })
    .map(({ entry }) => entry);
}

function getAnnotations<TReview extends DiffProjectionReview>(
  file: ProjectedFile,
  reviews: readonly TReview[],
  draftReview: TReview | null
): DiffLineAnnotation<TReview>[] {
  const annotations: DiffLineAnnotation<TReview>[] = [];
  for (const review of reviews) {
    if (reviewMatchesFile(review, file)) {
      annotations.push(createAnnotation(review));
    }
  }

  if (draftReview != null && reviewMatchesFile(draftReview, file)) {
    annotations.push(createAnnotation(draftReview));
  }

  return annotations;
}

function createAnnotation<TReview extends DiffProjectionReview>(review: TReview): DiffLineAnnotation<TReview> {
  // @pierre/diffs uses a conditional metadata type to support undefined metadata.
  // Diff Projection reviews always carry metadata, so keep the cast local to this adapter point.
  return {
    side: review.target.side,
    lineNumber: review.target.endLine,
    metadata: review,
  } as unknown as DiffLineAnnotation<TReview>;
}

function reviewMatchesFile(review: DiffProjectionReview, file: ProjectedFile): boolean {
  return review.target.fileId != null ? review.target.fileId === file.id : review.target.path === file.path;
}

function getItemVersion<TReview extends DiffProjectionReview>(
  fileDiff: FileDiffMetadata,
  isCollapsed: boolean,
  annotations: readonly DiffLineAnnotation<TReview>[],
  changedAt: number | undefined
): number {
  let hash = isCollapsed ? 17 : 31;
  hash = hashString(hash, fileDiff.cacheKey ?? '');
  hash = hashString(hash, fileDiff.isPartial ? 'partial' : 'full');
  hash = hashNumber(hash, fileDiff.additionLines.length);
  hash = hashNumber(hash, fileDiff.deletionLines.length);
  hash = hashNumber(hash, changedAt ?? 0);
  for (const annotation of annotations) {
    const metadata = annotation.metadata;
    hash = hashNumber(hash, annotation.lineNumber);
    hash = hashString(hash, annotation.side);
    if (metadata != null) {
      hash = hashString(hash, metadata.id);
      hash = hashString(hash, metadata.body ?? '');
      hash = hashString(hash, metadata.kind ?? '');
    }
  }
  return hash;
}

function hashNumber(hash: number, value: number): number {
  return (Math.imul(hash, 33) + value) >>> 0;
}

function hashString(hash: number, value: string): number {
  for (let index = 0; index < value.length; index++) {
    hash = (Math.imul(hash, 33) + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function projectChangeType(file: FileDiffMetadata): ProjectedChangeType {
  if (file.type === 'new') return 'new';
  if (file.type === 'deleted') return 'deleted';
  if (file.type === 'rename-pure' || file.type === 'rename-changed') return 'renamed';
  return 'modified';
}

function statusForFile(file: FileDiffMetadata): GitStatusEntry['status'] {
  if (file.type === 'new') return 'added';
  if (file.type === 'deleted') return 'deleted';
  if (file.type === 'rename-pure' || file.type === 'rename-changed') return 'renamed';
  return 'modified';
}

function countAdditions(file: FileDiffMetadata): number {
  return file.hunks.reduce((total, hunk) => total + hunk.additionLines, 0);
}

function countDeletions(file: FileDiffMetadata): number {
  return file.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0);
}
