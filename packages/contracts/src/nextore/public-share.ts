/** Descriptor returned to the branded share page. */
export interface NextorePublicShareDescriptor {
  fileName: string | null;
  previewOnly: boolean;
  expiresAt: string | null;
  contentUrl: string;
}

/** Failure payload when a key cannot be served on the branded page. */
export interface NextorePublicShareFailure {
  error: string;
  fallbackUrl: string;
}
