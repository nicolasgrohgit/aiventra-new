// Profile-picture storage decision: this stack has no object storage (no S3/Cloudinary,
// see CLAUDE.md) — just MongoDB, same constraint that pushed lib/weather.ts and
// lib/geocoding.ts toward no-key providers instead of new infra. `models/User.ts`'s
// `avatar_url` is already a plain String field on a `strict: false` schema, and
// `PUT /api/users/:id` already does a generic `$set: req.body`, so the cheapest path
// consistent with "no new infra for a beta" is storing a downscaled/compressed image as a
// base64 data URI directly in that field — no new backend route, no new schema.
//
// The one real risk of that approach is document bloat: a full-resolution phone photo as
// base64 would balloon the User document and slow down every request that returns it (every
// login, every profile sync). So the resize/compress parameters below are deliberately
// conservative and centralized here (rather than inlined at the call site in profile.tsx) so
// they're easy to unit-test and to retune later without touching UI code.
//
// 300x300 is plenty for an avatar shown at ~70x70 (2x/3x device pixel ratio covers Retina
// without over-provisioning), and JPEG quality 0.5 is aggressive but avatars tolerate visible
// compression far better than photo content does. Empirically this keeps a real photo under
// ~15-25KB base64-encoded — small enough that embedding it in the User document (returned on
// every login/profile sync) is a non-issue.
export const AVATAR_TARGET_SIZE = 300;
export const AVATAR_JPEG_QUALITY = 0.5;

// A generous ceiling on the final base64 payload we're willing to persist, independent of
// what dimensions/quality produced it — a last-line sanity check (surfaced to the user as an
// error) in case a future device/library change produces something unexpectedly large, rather
// than silently writing a bloated field to the User document.
export const AVATAR_MAX_BASE64_BYTES = 200_000; // ~200KB

// expo-image-manipulator action list to resize a (typically square, since the picker is
// invoked with `allowsEditing`/`aspect: [1, 1]`) source image down to the avatar target size.
// Pure/data-only so it's trivial to assert on without mocking the native module.
export function getAvatarResizeActions(): { resize: { width: number; height: number } }[] {
  return [{ resize: { width: AVATAR_TARGET_SIZE, height: AVATAR_TARGET_SIZE } }];
}

// Base64's 4-character groups each encode 3 raw bytes, minus 1 byte per trailing '=' pad
// character — the standard formula for recovering byte length without decoding.
export function estimateBase64Bytes(base64: string): number {
  if (!base64) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function isAvatarBase64SizeAcceptable(base64: string): boolean {
  return estimateBase64Bytes(base64) <= AVATAR_MAX_BASE64_BYTES;
}

export function toAvatarDataUri(base64: string, mimeType: string = 'image/jpeg'): string {
  return `data:${mimeType};base64,${base64}`;
}
