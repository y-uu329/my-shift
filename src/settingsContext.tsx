// 設定（時給・休憩・読み取りモデル）をアプリ全体で使えるようにする
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, type AppSettings } from './domain/settings';
import { loadSettings, saveSettings } from './storage/repository';

const Ctx = createContext<{ settings: AppSettings; update: (s: AppSettings) => Promise<void> }>({
  settings: DEFAULT_SETTINGS,
  update: async () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);
  const update = async (s: AppSettings) => {
    setSettings(s);
    await saveSettings(s);
  };
  return <Ctx.Provider value={{ settings, update }}>{children}</Ctx.Provider>;
}

export const useSettings = () => useContext(Ctx);
