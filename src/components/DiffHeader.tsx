import { useEffect, useRef, useState } from 'react';
import type { ProjectedFile } from '../diffProjection';
import type { DraftReview, FileLinks, SavedReview } from '../types';
import { DraftReviewBox, SavedReviewAnnotation } from './ReviewAnnotations';

export interface FileReviewActions {
    onDeleteReview: (id: string) => void;
    onDraftCancel: (id: string) => void;
    onDraftSave: (draft: DraftReview, body: string) => void;
    onEditReview: (id: string, body: string) => void;
    onReviewFile: () => void;
}

export function DiffHeader({
    actions,
    draftReview,
    file,
    fileLinks,
    fileReviews,
    onToggle,
}: {
    actions: FileReviewActions;
    draftReview: DraftReview | null;
    file: ProjectedFile;
    fileLinks: FileLinks;
    fileReviews: SavedReview[];
    onToggle: () => void;
}) {
    const hasFileReviewThread = draftReview != null || fileReviews.length > 0;

    return (
        <div className="customFileHeaderFrame">
            <div className="customFileHeader">
                <button
                    type="button"
                    className="fileTitleButton"
                    aria-expanded={!file.collapsed}
                    onClick={onToggle}
                    title={file.collapsed ? 'Expand file' : 'Collapse file'}
                >
                    <span className={`chevron ${file.collapsed ? 'collapsed' : ''}`} aria-hidden="true">›</span>
                    <ChangeIcon type={file.changeType} />
                    <span className="fileTitleText">
                        {file.previousPath != null && file.previousPath !== file.path ? (
                            <>
                                <span>{file.previousPath}</span>
                                <span className="renameArrow">⟶</span>
                            </>
                        ) : null}
                        <span>{file.path}</span>
                    </span>
                </button>
                <div className="fileHeaderActions">
                    <FileActionsMenu
                        links={fileLinks}
                        onReviewFile={actions.onReviewFile}
                        path={file.path}
                    />
                    <FileMeta file={file} />
                </div>
            </div>
            {hasFileReviewThread ? (
                <div className="fileReviewThread">
                    {fileReviews.map((review) => (
                        <SavedReviewAnnotation
                            key={review.id}
                            review={review}
                            onDelete={() => actions.onDeleteReview(review.id)}
                            onEdit={(body) => actions.onEditReview(review.id, body)}
                        />
                    ))}
                    {draftReview != null ? (
                        <DraftReviewBox
                            draft={draftReview}
                            onCancel={() => actions.onDraftCancel(draftReview.id)}
                            onSave={(body) => actions.onDraftSave(draftReview, body)}
                        />
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

/**
 * File actions live behind a single menu button so the file name keeps the header's
 * horizontal space, and so new actions stay cheap to add.
 */
function FileActionsMenu({
    links,
    onReviewFile,
    path,
}: {
    links: FileLinks;
    onReviewFile: () => void;
    path: string;
}) {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) {
            return;
        }

        const onPointerDown = (event: PointerEvent) => {
            if (menuRef.current?.contains(event.target as Node) !== true) {
                setOpen(false);
            }
        };
        // Escape is a no-op in the app keyboard router while this menu is open, so
        // closing here cannot collide with a shortcut action.
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };

        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    const closeMenu = () => setOpen(false);

    const onCopy = async () => {
        try {
            await navigator.clipboard.writeText(path);
            setCopied(true);
            // Keep the menu open so the confirmation is actually visible.
            setTimeout(() => setCopied(false), 1500);
        } catch {
            setCopied(false);
        }
    };

    return (
        <div className="fileActionsMenu" ref={menuRef}>
            <button
                type="button"
                className="fileReviewButton fileMenuToggle"
                aria-expanded={open}
                aria-label="File actions"
                onClick={() => setOpen((value) => !value)}
                title="File actions"
            >
                <span aria-hidden="true">⋯</span>
            </button>
            {open ? (
                <div className="fileMenu" aria-label="File actions">
                    <button type="button" className="fileMenuItem" onClick={onCopy}>
                        {copied ? 'Copied' : 'Copy file name'}
                    </button>
                    <FileMenuLink
                        hint={links.hint}
                        href={links.href}
                        onOpen={closeMenu}
                        title="Open the full file, read-only, in a new tab, with added lines highlighted"
                    >
                        View file
                    </FileMenuLink>
                    <FileMenuLink
                        hint={links.hint}
                        href={links.rawHref}
                        onOpen={closeMenu}
                        title="Open the raw file contents in a new tab, with no highlighting"
                    >
                        Open raw file
                    </FileMenuLink>
                    <button
                        type="button"
                        className="fileMenuItem"
                        onClick={() => {
                            onReviewFile();
                            setOpen(false);
                        }}
                    >
                        Review file
                    </button>
                </div>
            ) : null}
        </div>
    );
}

/**
 * Menu entry that opens a file in a new tab. When the link is unavailable the entry is
 * disabled and explains why, so the action stays discoverable instead of disappearing.
 */
function FileMenuLink({
    children,
    hint,
    href,
    onOpen,
    title,
}: {
    children: string;
    hint: string | null;
    href: string | null;
    onOpen: () => void;
    title: string;
}) {
    if (href == null) {
        return (
            <button type="button" className="fileMenuItem" disabled title={hint ?? undefined}>
                {children}
            </button>
        );
    }

    return (
        <a
            className="fileMenuItem"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={title}
            onClick={onOpen}
        >
            {children}
        </a>
    );
}

function ChangeIcon({ type }: { type: ProjectedFile['changeType'] }) {
    const label = type === 'new'
        ? 'Added file'
        : type === 'deleted'
            ? 'Deleted file'
            : type === 'renamed'
                ? 'Renamed file'
                : 'Modified file';

    return (
        <span className="changeIcon" data-change-type={type} aria-label={label} title={label}>
            {type === 'new' ? '+' : type === 'deleted' ? '−' : type === 'renamed' ? '↪' : '●'}
        </span>
    );
}

function FileMeta({ file }: { file: ProjectedFile }) {
    return (
        <span className="fileMeta">
            <span>{file.changeType}</span>
            <span className="plus">+{file.additions}</span>
            <span className="minus">−{file.deletions}</span>
        </span>
    );
}
