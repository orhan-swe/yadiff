import type { AnnotationSide } from '@pierre/diffs';

import { isFileReviewTarget } from './reviews';
import type { DiffStatusResponse, Review, ReviewTarget, Source } from './types';

export function formatStatusDetails(status: DiffStatusResponse): string | null {
    if (status.status === 'fetching' && status.bytesDownloaded != null) {
        return `Downloaded ${formatBytes(status.bytesDownloaded)}`;
    }
    if (status.status === 'ready' && status.patchBytes != null) {
        return `Downloaded ${formatBytes(status.patchBytes)}`;
    }
    return null;
}

export function byteLength(text: string): number {
    return new TextEncoder().encode(text).byteLength;
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const kib = bytes / 1024;
    if (kib < 1024) return `${kib.toFixed(kib >= 10 ? 1 : 2)} KB`;
    const mib = kib / 1024;
    return `${mib.toFixed(mib >= 10 ? 1 : 2)} MB`;
}

export function formatSource(source: Source | undefined): string {
    if (source === 'github') return 'GitHub';
    return source ?? 'unknown';
}

export function getLargeDiffLabel(_source: Source | undefined, patchBytes: number | undefined, files: number): string | null {
    const isLarge = files >= 500 || (patchBytes != null && patchBytes >= 10 * 1024 * 1024);
    if (!isLarge) return null;
    const parts = ['Large diff'];
    if (files > 0) parts.push(`${files} files`);
    if (patchBytes != null) parts.push(formatBytes(patchBytes));
    return parts.join(' · ');
}

function formatReviewSide(side: AnnotationSide): 'old' | 'new' {
    return side === 'deletions' ? 'old' : 'new';
}

export function formatReviewLocation(review: Review): string {
    const { target } = review;
    if (isFileReviewTarget(target)) {
        return `${target.path} (file)`;
    }

    return `${target.path}${formatReviewRange(target)}`;
}

function formatReviewRange(target: ReviewTarget): string {
    const side = formatReviewSide(target.side);
    const lineRange = target.startLine === target.endLine
        ? `${target.startLine}`
        : `${target.startLine}-${target.endLine}`;
    return ` (${side}) Line ${lineRange}`;
}

export function formatCopyStatus(status: 'copied' | 'empty' | 'error') {
    if (status === 'copied') return 'Copied';
    if (status === 'empty') return 'No reviews';
    return 'Copy failed';
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MINUTES_THRESHOLD_MS = 3 * HOUR_MS;

/**
 * Coarse file age: whole minutes below three hours (`95m`), then days with one
 * decimal (`0.1d`, `1.0d`).
 */
export function formatFileAge(changedAt: number, now = Date.now()): string {
    const elapsed = Math.max(0, now - changedAt);
    if (elapsed < MINUTES_THRESHOLD_MS) {
        return `${Math.floor(elapsed / MINUTE_MS)}m`;
    }
    return `${(elapsed / DAY_MS).toFixed(1)}d`;
}
