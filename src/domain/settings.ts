// アプリ全体の設定（月をまたいで共通）
import { DEFAULT_PAY, type PaySettings } from './pay';

/** 写真の読み取りに使う Claude のモデル */
export const VISION_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5（精度重視）', note: '1枚あたり約10〜25円の目安' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5（料金重視）', note: '1枚あたり約1円以下の目安。細かい表は読み違いが増えることがあります' },
] as const;
export type VisionModelId = (typeof VISION_MODELS)[number]['id'];

export interface AppSettings {
  version: 1;
  pay: PaySettings;
  visionModel: VisionModelId;
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  pay: DEFAULT_PAY,
  visionModel: 'claude-opus-5-5',
};
