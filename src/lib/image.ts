// 写真を読み取り用に縮小する（ブラウザの canvas を使用）
/** 画像を縮小して JPEG にする（送るデータ量と料金を抑える。長い辺 最大2000px） */
export async function prepareImage(file: File): Promise<{ data: string; mediaType: 'image/jpeg'; preview: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const url = canvas.toDataURL('image/jpeg', 0.9);
  return { data: url.slice(url.indexOf(',') + 1), mediaType: 'image/jpeg', preview: url };
}
