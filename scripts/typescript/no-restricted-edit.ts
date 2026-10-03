import { defineHook, runHook } from 'cc-hooks-ts';
import { extname } from 'pathe';

type Edit = {
  new_string: string;
  old_string: string;
};

type Rule = {
  restrictedSyntax: string[];
};

/**
 * 編集が制限された構文を含むかチェックする
 * @param edits - チェック対象の編集配列
 * @param rule - 制限ルール
 */
function includesRestrictedEdit(edits: Edit[], rule: Rule) {
  return edits.some((edit) =>
    rule.restrictedSyntax.some((restrictedEdit) => edit.new_string.includes(restrictedEdit)),
  );
}

/**
 * ファイルパスが指定された拡張子パターンと一致するかチェックする
 * @param path - チェック対象のファイルパス
 * @param patterns - 拡張子パターンの配列
 */
function isExtension(path: string, patterns: string[]) {
  return patterns.includes(extname(path));
}

const hook = defineHook({
  trigger: {
    PreToolUse: {
      Edit: true,
    },
  },

  run: (c) => {
    const toolInput = c.input.tool_input;

    if (
      !isExtension(toolInput.file_path, [
        '.ts',
        '.cts',
        '.mts',
        '.tsx',
        '.vue',
        '.svelte',
        '.astro',
      ])
    ) {
      return c.success();
    }

    const edits: Edit[] = [
      {
        new_string: toolInput.new_string,
        old_string: toolInput.old_string,
      },
    ];

    if (
      includesRestrictedEdit(edits, {
        restrictedSyntax: [
          // type assertion
          'as any',
          'as unknown',
          // type annotation
          ': any',
          ': unknown',
        ],
      })
    ) {
      return c.json({
        event: 'PreToolUse',
        output: {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
              "Do not use type assertion or type annotation with 'any' or 'unknown' to suppress type checking. Remove type assertion / annotation and get diagnostics from IDE or tsc, then use correct types.",
          },
        },
      });
    }

    return c.success();
  },
});

await runHook(hook);
