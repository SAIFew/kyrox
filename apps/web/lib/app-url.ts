/**
 * Resolve the canonical public origin.
 *
 * Order: explicit configuration, Vercel's production hostname, then a stable
 * placeholder that still renders a usable documentation snippet.
 */
export function appUrl(): string {
  const explicit = process.env["NEXT_PUBLIC_APP_URL"]?.trim();
  if (explicit !== undefined && explicit.length > 0) return explicit.replace(/\/+$/, "");
  const vercel =
    process.env["VERCEL_PROJECT_PRODUCTION_URL"]?.trim() ?? process.env["VERCEL_URL"]?.trim();
  if (vercel !== undefined && vercel.length > 0) return `https://${vercel.replace(/\/+$/, "")}`;
  return "https://kyrox-preview.vercel.app";
}
