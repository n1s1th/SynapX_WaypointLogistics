// Flag photos on the tablet: shrink before upload, and turn the API's photo
// address into something an <img> can load.

/** Longest side after shrinking; a dock photo stays readable well below this. */
const MAX_SIDE = 1600;
const QUALITY = 0.8;
/** The server's limit (FLAG_PHOTO_MAX_BYTES). */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * A camera photo as a JPEG of at most 1600 px on its longest side. Falls back
 * to the original file when the browser cannot decode it (then the server's
 * type and size checks still apply).
 */
export async function shrinkPhoto(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    return blob ?? file;
  } catch {
    return file;
  }
}

/**
 * An <img> src for IssueDetailRead.photo_url: the public R2 URL as is, a
 * data URL (mock) as is, and the server's /static/uploads/… fallback prefixed
 * with the API's address.
 */
export function photoSrc(url: string): string {
  if (!url.startsWith("/")) return url;
  const base = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000").replace(/\/$/, "");
  return `${base}${url}`;
}
