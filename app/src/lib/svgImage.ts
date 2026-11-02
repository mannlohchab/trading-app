const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** expo-image's Android data-URL loader requires Base64, not percent-encoded XML. */
export function svgImageSource(svg: string, width: number, height: number) {
  // Convert UTF-8 without depending on browser-only btoa or Node's Buffer.
  const bytes = encodeURIComponent(svg).replace(/%([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  let encoded = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes.charCodeAt(i);
    const b = i + 1 < bytes.length ? bytes.charCodeAt(i + 1) : 0;
    const c = i + 2 < bytes.length ? bytes.charCodeAt(i + 2) : 0;
    encoded += BASE64[a >> 2] + BASE64[((a & 3) << 4) | (b >> 4)]
      + (i + 1 < bytes.length ? BASE64[((b & 15) << 2) | (c >> 6)] : '=')
      + (i + 2 < bytes.length ? BASE64[c & 63] : '=');
  }
  return { uri: `data:image/svg+xml;base64,${encoded}`, width, height };
}
