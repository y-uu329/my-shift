// アプリ内の確認ダイアログ（ブラウザ標準の confirm() の代わり）
import { useEffect, useRef, useState } from 'react';

interface Request {
  message: string;
  okLabel: string;
  resolve: (ok: boolean) => void;
}

let open: ((r: Request) => void) | null = null;

/** 「はい / キャンセル」を聞いて、結果を true / false で返す */
export function confirmDialog(message: string, okLabel = 'OK'): Promise<boolean> {
  return new Promise((resolve) => {
    if (open) open({ message, okLabel, resolve });
    else resolve(false);
  });
}

/** App の一番外側に1つだけ置く */
export function ConfirmHost() {
  const [req, setReq] = useState<Request | null>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    open = setReq;
    return () => {
      open = null;
    };
  }, []);
  useEffect(() => {
    if (req) okRef.current?.focus();
  }, [req]);

  if (!req) return null;
  const close = (ok: boolean) => {
    req.resolve(ok);
    setReq(null);
  };
  return (
    <div className="dialog-backdrop" onClick={() => close(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-message" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close(false)}>
        <p id="dialog-message" className="dialog-message">
          {req.message}
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={() => close(false)}>
            キャンセル
          </button>
          <button type="button" ref={okRef} className="btn btn-primary" onClick={() => close(true)}>
            {req.okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
