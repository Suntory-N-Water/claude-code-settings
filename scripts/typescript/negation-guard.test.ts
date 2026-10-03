import { describe, expect, it } from 'bun:test';
import { negatedTerms, reminderFor } from './negation-guard.ts';

describe('否定形を含む指示への注入', () => {
  it.each([
    ['トレースIDはいらない'],
    ['`ChangelogAiResult` を削除して'],
    ['コミット前ですという情報は不要'],
    ['settings.json とかはしなくていい'],
    ['この節には触れないでください'],
    ['テスト更新なしで通ることを確認して'],
  ])('否定形を含む「%s」に文面が返ること', (prompt) => {
    const result = reminderFor(prompt);

    expect(result).toContain('作業制約');
  });

  it.each([
    ['このバグを直してください'],
    ['実装方針を調査して報告して'],
    ['するならこの順番でお願いします'],
  ])('肯定形だけの「%s」に何も返らないこと', (prompt) => {
    const result = reminderFor(prompt);

    expect(result).toBeUndefined();
  });

  it('コードブロック内だけに否定形があるとき、何も返らないこと', () => {
    const prompt = [
      'こういうツイートを見ました。',
      '```',
      '「〇〇は入れないで」と訂正指示すると本文に書かれる',
      '```',
      'どう思いますか。',
    ].join('\n');

    const result = reminderFor(prompt);

    expect(result).toBeUndefined();
  });

  it('引用行だけに否定形があるとき、何も返らないこと', () => {
    const prompt = ['> 東坡肉を加えないでください', 'これは引用です。'].join('\n');

    const result = reminderFor(prompt);

    expect(result).toBeUndefined();
  });

  it('対象語を特定できるとき、文面にその語が並ぶこと', () => {
    const result = reminderFor('トレースIDはいらない。あと `foo` を削除して。');

    expect(result).toContain('「トレースID」');
    expect(result).toContain('「foo」');
  });

  it('対象語を特定できないとき、対象語の一覧なしで文面が成立すること', () => {
    const result = reminderFor('あれはやめてください');

    expect(result).toContain('作業制約');
    expect(result).not.toContain('条件の対象');
  });

  // 否定形で書くと、この注入自体が抑止したい再出現を招く
  it('文面に否定の命令形が含まれないこと', () => {
    const result = reminderFor('トレースIDはいらない');

    expect(result).not.toMatch(/しないで|するな|書かないで|触れないで/u);
  });
});

describe('条件の対象語の抽出', () => {
  it('バッククォートで囲まれた識別子が取れること', () => {
    const result = negatedTerms('`ChangelogAiResult` を削除して');

    expect(result).toEqual(['ChangelogAiResult']);
  });

  it('鉤括弧で囲まれた語が取れること', () => {
    const result = negatedTerms('「東坡肉」は入れないで');

    expect(result).toEqual(['東坡肉']);
  });

  it('助詞が重なっていても対象語だけが取れること', () => {
    const result = negatedTerms('settings.json とかはしなくていい');

    expect(result).toEqual(['settings.json']);
  });

  // 「曖昧なパターンで代用しないで」から「曖昧なパターンで代用」を拾うと、
  // 対象語ではなく述語ごと提示してしまう
  it('述語まで巻き込む語は取らないこと', () => {
    const result = negatedTerms('曖昧なパターンで代用しないでください');

    expect(result).toEqual([]);
  });

  it('同じ語が繰り返し否定されても一度だけ並ぶこと', () => {
    const result = negatedTerms('`foo` を削除して。`foo` は不要です。');

    expect(result).toEqual(['foo']);
  });

  it('対象語が多いとき、並ぶのは 5 件までであること', () => {
    const prompt = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6']
      .map((name) => `\`${name}\` を削除して。`)
      .join('');

    const result = negatedTerms(prompt);

    expect(result).toHaveLength(5);
  });

  it('肯定形だけの指示からは何も取れないこと', () => {
    const result = negatedTerms('このバグを直してください');

    expect(result).toEqual([]);
  });
});
