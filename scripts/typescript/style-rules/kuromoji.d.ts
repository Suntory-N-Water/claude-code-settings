declare module 'kuromoji' {
  export interface Token {
    surface_form: string;
    pos: string;
    pos_detail_1: string;
    basic_form: string;
  }

  export interface Tokenizer {
    tokenize(text: string): Token[];
  }

  export interface Builder {
    build(callback: (error: Error | null, tokenizer: Tokenizer) => void): void;
  }

  const kuromoji: {
    builder(options: { dicPath: string }): Builder;
  };
  export default kuromoji;
}
