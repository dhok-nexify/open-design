/** One entry of a shared folder. */
export interface NextorePublicShareItem {
  id: number;
  name: string;
  contentUrl: string;
}

/** Descriptor returned to the branded share page. */
export interface NextorePublicShareDescriptor {
  /** A file streams directly; a folder lists its children. */
  kind: 'file' | 'folder';
  fileName: string | null;
  previewOnly: boolean;
  expiresAt: string | null;
  /** Present for files only. */
  contentUrl: string | null;
  /** Present for folders only. */
  items: NextorePublicShareItem[];
}

/** Failure payload when a key cannot be served on the branded page. */
export interface NextorePublicShareFailure {
  error: string;
  fallbackUrl: string;
}
