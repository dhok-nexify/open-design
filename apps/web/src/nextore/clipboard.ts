/**
 * Copy text to the clipboard, with a selection-based fallback.
 *
 * `navigator.clipboard` only exists in a secure context. The Designer is
 * routinely opened from a plain-http LAN address, which is exactly where the
 * copy buttons live, so the async API alone silently fails there.
 */
export async function copyText(text: string, input?: HTMLInputElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or no user gesture: fall through to the fallback.
  }
  if (!input) return false;
  try {
    input.focus();
    input.select();
    return document.execCommand('copy');
  } catch {
    return false;
  }
}
