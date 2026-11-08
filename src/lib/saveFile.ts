// ファイルを端末に保存する。
// iPad・iPhone では共有メニュー（「画像を保存」「"ファイル"に保存」など）を開き、
// パソコンではダウンロードする。
export type SaveResult = 'shared' | 'downloaded' | 'cancelled';

export async function saveFile(blob: Blob, fileName: string): Promise<SaveResult> {
  const file = new File([blob], fileName, { type: blob.type });
  const touch = window.matchMedia?.('(pointer: coarse)').matches;
  if (touch && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return 'shared';
    } catch (e) {
      // 共有メニューを閉じただけのときは何もしない。それ以外はダウンロードを試す
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
