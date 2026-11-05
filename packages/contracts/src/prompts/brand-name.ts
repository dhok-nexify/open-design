/**
 * Product brand name substitution for prompts.
 *
 * Prompt sources pin the product name as a literal so a prompt diff is
 * readable and snapshot tests stay stable. The shipped name is the NexTore
 * Designer default; an installation may rename the product through NexTore
 * branding. Rather than threading a parameter through every prompt module
 * (both composition implementations, four variant axes, and the OD Next
 * plugin assets), the name is substituted once at each composition boundary.
 *
 * Callers pass the resolved name; leaving it undefined keeps the composed
 * prompt byte-identical to the default build.
 */
export const DEFAULT_PRODUCT_BRAND_NAME = 'NexTore Designer';

/**
 * Replaces the default product name with the configured brand name.
 *
 * Uses split/join instead of a regular expression so a brand name containing
 * regex metacharacters or `$&` is inserted literally.
 */
export function applyProductBrandName(
  text: string,
  brandName?: string | null,
): string {
  const resolved = brandName?.trim();
  if (!resolved || resolved === DEFAULT_PRODUCT_BRAND_NAME) return text;
  return text.split(DEFAULT_PRODUCT_BRAND_NAME).join(resolved);
}
