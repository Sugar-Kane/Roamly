// Shared client-side image preparation for profile pictures, used by both the
// profile menu and the account settings panel.
//
// iOS photos are often HEIC/HEIF, which browsers cannot decode or upload as an
// image. We convert to JPEG on the client (the WASM decoder is dynamically
// imported so it only loads when a HEIC file is actually chosen). The real file
// type comes from the leading bytes, not the extension or reported MIME: a
// renamed .heic that's actually a JPEG passes straight through (with its MIME
// corrected), and a mislabeled HEIC still gets converted. heic2any decodes the
// pixels through libheif, so EXIF orientation is baked into the converted JPEG
// and photos come out upright.

export const AVATAR_MAX_BYTES = 15 * 1024 * 1024;

async function sniffImageKind(file: File): Promise<"heic" | "jpeg" | "png" | "webp" | "unknown"> {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (bytes.length >= 12) {
    const tag = String.fromCharCode(...bytes.slice(4, 8));
    if (tag === "ftyp") {
      const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
      if (["heic", "heix", "hevc", "hevx", "heif", "mif1", "msf1"].includes(brand)) return "heic";
    }
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "webp";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  return "unknown";
}

// Returns a File the avatar storage will accept: HEIC becomes JPEG, and a
// mislabeled file is re-wrapped with the MIME its bytes prove. Throws only if
// the HEIC decoder fails, which callers surface as a friendly message.
export async function prepareAvatarFile(file: File): Promise<File> {
  const kind = await sniffImageKind(file);
  if (kind === "heic") {
    const heic2any = (await import("heic2any")).default;
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    return new File([blob], file.name.replace(/\.hei[cf]$/i, "") + ".jpg", { type: "image/jpeg" });
  }
  const realType = kind === "jpeg" ? "image/jpeg" : kind === "png" ? "image/png" : kind === "webp" ? "image/webp" : null;
  if (realType && file.type !== realType) return new File([file], file.name, { type: realType });
  return file;
}
