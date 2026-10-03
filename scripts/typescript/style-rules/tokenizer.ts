import { dirname, join } from 'node:path';
import kuromoji, { type Tokenizer } from 'kuromoji';

// kuromoji は辞書を package 内の dict から読む。バンドルされないので実体の場所を解決する
function dicPath(): string {
  return join(dirname(Bun.resolveSync('kuromoji/package.json', import.meta.dir)), 'dict');
}

let cached: Promise<Tokenizer> | undefined;

// 辞書ロードに約 110ms かかる。呼ぶ側は体言止めの候補が無いときに呼ばないこと
export function loadTokenizer(): Promise<Tokenizer> {
  cached ??= new Promise<Tokenizer>((resolve, reject) => {
    kuromoji.builder({ dicPath: dicPath() }).build((error, tokenizer) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(tokenizer);
    });
  });
  return cached;
}
