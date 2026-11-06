/**
 * Whether a preview scope belongs to a different member (NXD-D25).
 *
 * A preview URL carries an opaque scope that the daemon validates on every
 * asset read. Binding it to the member who minted it means a URL leaked from
 * one member's browser cannot be replayed by another signed-in member; a scope
 * that was never bound (upstream, headless exports) keeps the historical rule.
 */
export function previewScopeMemberMismatch(
  entry: { memberId?: number | null } | null | undefined,
  memberId?: number | null,
): boolean {
  const owner = entry?.memberId;
  if (typeof owner !== 'number') return false;
  if (typeof memberId !== 'number') return true;
  return owner !== memberId;
}
