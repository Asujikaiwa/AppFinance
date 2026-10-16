/**
 * One-off script to create + upload the LINE rich menu and set it as default.
 *
 * Usage:
 *   LINE_CHANNEL_ACCESS_TOKEN=… LIFF_ID=… \
 *     deno run -A scripts/setup-line-richmenu.ts ./assets/richmenu.png
 *
 * The image must be a 2500x1686 PNG/JPEG (<1MB).
 */
import { RICH_MENU } from '../supabase/functions/_shared/line-richmenu.ts';

const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN');
const liffId = Deno.env.get('LIFF_ID');
const imagePath = Deno.args[0];

if (!token || !liffId || !imagePath) {
  console.error('Need LINE_CHANNEL_ACCESS_TOKEN, LIFF_ID env and image path arg');
  Deno.exit(1);
}

// 1. Create the rich menu object
const createRes = await fetch('https://api.line.me/v2/bot/richmenu', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify(RICH_MENU(liffId)),
});
if (!createRes.ok) {
  console.error('create failed', await createRes.text());
  Deno.exit(1);
}
const { richMenuId } = (await createRes.json()) as { richMenuId: string };
console.log('created rich menu', richMenuId);

// 2. Upload the image
const image = await Deno.readFile(imagePath);
const contentType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
const uploadRes = await fetch(
  `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
  {
    method: 'POST',
    headers: { 'Content-Type': contentType, Authorization: `Bearer ${token}` },
    body: image,
  },
);
if (!uploadRes.ok) {
  console.error('image upload failed', await uploadRes.text());
  Deno.exit(1);
}
console.log('image uploaded');

// 3. Set as default for all users
const defaultRes = await fetch(
  `https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`,
  { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
);
if (!defaultRes.ok) {
  console.error('set default failed', await defaultRes.text());
  Deno.exit(1);
}
console.log('✓ rich menu is now the default');
