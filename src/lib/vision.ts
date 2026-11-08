// 写真・スクリーンショットを Claude API で読み取る
// ※ APIキーはこの端末に保存したものを使い、ソースコードや GitHub には書きません。
// ※ 画像は読み取りのために Anthropic のサーバーへ送られます。
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { formatYearMonth } from '../domain/date';
import { IMPORT_KIND_LABEL, type ImportKind, type ReadResult } from '../domain/importing';
import type { VisionModelId } from '../domain/settings';
import type { YearMonth } from '../domain/types';

const ReadSchema = z.object({
  year_month: z.string().nullable().describe('画像から分かる年月（YYYY-MM）。分からなければ null'),
  entries: z.array(
    z.object({
      date: z.string().nullable().describe('YYYY-MM-DD。読み取れない・推測になる場合は null'),
      raw_date: z.string().describe('画像に書かれている日付の文字そのまま'),
      status: z.enum(['work', 'off', 'available', 'unavailable', 'event', 'unknown']),
      start: z.string().nullable().describe('開始時刻 HH:MM（24時間表記）。なければ null'),
      end: z.string().nullable().describe('終了時刻 HH:MM（24時間表記）。なければ null'),
      title: z.string().describe('予定名や記号（例：「歯医者」「A」）。なければ空文字'),
      confidence: z.enum(['high', 'medium', 'low']),
      problem: z.string().nullable().describe('読み取りで気になった点（かすれ・はみ出し等）。なければ null'),
    }),
  ),
  unreadable: z.array(z.object({ text: z.string(), reason: z.string() })).describe('読み取れなかった部分'),
});

const KIND_GUIDE: Record<ImportKind, string> = {
  wish: `勤務希望表です。日付ごとに次の status を付けてください。
- 出勤できる日・出勤希望の日 → available（時間が書いてあれば start/end）
- 休み希望の日 → off
- 勤務できない日（×や不可の印） → unavailable
- 印がなく判断できない日 → 出力しない（空欄の日は省略）`,
  shift: `完成済みのシフト表です。日付ごとに、対象の人の勤務を読み取ってください。
- 出勤の日 → work（start/end に勤務時間。記号だけで時間が書いていなければ start/end は null にし、title に記号を入れ、problem に「時間が書かれていない」と書く）
- 休みの日（休・公・×・空欄で休みと分かる日） → off
- 判断できない日 → unknown`,
  calendar: `カレンダー・予定表です。予定が書かれている日だけを出力してください。
- 予定がある日 → event（title に予定名、時間があれば start/end）
- 「休み」「休暇」など明らかな休み → off
- 予定のない日は出力しない`,
  fortune: `占い本（ゲッターズ飯田さんの五星三心占いなど）の、月間の運気カレンダーのページです。
- 日付ごとに、その日の運気の名前を title に入れてください（例：「開運」「幸運」「乱気」「裏運気」など。ページの表記どおりに、末尾の「の日」は付けない）。status は event にしてください。
- 日付の横に記号（☆◎▲×など）だけが書かれている場合は、同じページや見開きにある記号の説明（凡例）を使って運気の名前にしてください。説明が見当たらず名前が分からない場合は、記号をそのまま title に入れ、confidence を low にして problem に「記号の意味が分からない」と書いてください。
- 運気の名前以外の文章（その日のアドバイスなど）は入れないでください。
- start / end は null にしてください。`,
};

function buildPrompt(kind: ImportKind, month: YearMonth, personName: string): string {
  return `この画像は「${IMPORT_KIND_LABEL[kind]}」です。中身を読み取って、指定の形式で返してください。

${KIND_GUIDE[kind]}

守ってほしいこと：
- 年が書かれていない場合は、${formatYearMonth(month)}（${month}）の前後の月として日付を決めてください。月も書かれていない場合は ${month} とします。
- 時刻は24時間表記の HH:MM にしてください（例：午後1時 → 13:00、9時 → 09:00）。
${kind === 'shift' && personName ? `- 複数の人が載っている表の場合は「${personName}」さんの行・列だけを読み取ってください。見つからない場合は entries を空にし、unreadable にその旨を書いてください。\n` : ''}- 読み取れない・かすれている・推測になる部分は、推測で埋めずに confidence を low にして problem に理由を書いてください。日付自体が読めない場合は date を null にしてください。
- 表の外の文字（タイトル、注意書きなど）は entries に入れないでください。読み取れなかった部分は unreadable に書いてください。`;
}

export class VisionError extends Error {
  name = 'VisionError';
}

/** 1枚の画像を読み取る */
export async function readImage(opts: {
  apiKey: string;
  model: VisionModelId;
  kind: ImportKind;
  month: YearMonth;
  personName: string;
  image: { data: string; mediaType: 'image/jpeg' };
}): Promise<ReadResult> {
  // 自分専用アプリで、自分のAPIキーを自分の端末だけに保存して使うため、ブラウザからの直接呼び出しを許可する
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const opus = opts.model === 'claude-opus-5-5';
  try {
    const message = await client.beta.messages.parse({
      model: opts.model,
      max_tokens: 16000,
      // Opus で安全判定により断られた場合は、自動で別のモデルに切り替えて続ける
      ...(opus ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      output_config: { effort: 'medium', format: betaZodOutputFormat(ReadSchema) },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: opts.image.mediaType, data: opts.image.data } },
            { type: 'text', text: buildPrompt(opts.kind, opts.month, opts.personName) },
          ],
        },
      ],
    });
    if (message.stop_reason === 'refusal') throw new VisionError('この画像は読み取りを断られました。別の画像で試してください');
    if (message.stop_reason === 'max_tokens') throw new VisionError('読み取る内容が多すぎて途中で止まりました。画像を分けて試してください');
    if (!message.parsed_output) throw new VisionError('読み取り結果の形式が正しくありませんでした。もう一度試してください');
    return message.parsed_output;
  } catch (e) {
    if (e instanceof VisionError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new VisionError('APIキーが正しくありません。設定画面でキーを確認してください');
    if (e instanceof Anthropic.PermissionDeniedError) throw new VisionError('このAPIキーでは、選んだモデルを使えません。設定画面でモデルを変えてみてください');
    if (e instanceof Anthropic.RateLimitError) throw new VisionError('短時間に使いすぎたか、利用上限に達しました。少し待つか、Anthropic Console で上限・残高を確認してください');
    if (e instanceof Anthropic.BadRequestError) throw new VisionError(`読み取りを受け付けてもらえませんでした（${e.message}）`);
    if (e instanceof Anthropic.APIConnectionError) throw new VisionError('インターネットにつながらないか、通信が途切れました。電波の良い所でもう一度試してください');
    if (e instanceof Anthropic.APIError) throw new VisionError(`読み取り中にエラーが起きました（${e.status ?? ''}）。少し時間をおいて試してください`);
    throw new VisionError(`読み取り中にエラーが起きました：${e instanceof Error ? e.message : String(e)}`);
  }
}
