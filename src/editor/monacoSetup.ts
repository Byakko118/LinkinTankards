import * as monaco from 'monaco-editor';
// CSS is outside the package exports map — import by deep path for Vite bundling.
import '../../node_modules/monaco-editor/min/vs/editor/editor.main.css';
// 0.56+ exports map: monaco-editor/X → esm/vs/X.js (do NOT prefix esm/vs).
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import 'monaco-editor/languages/definitions/lua/register.js';
import {
  ALL_FX_SYMBOLS,
  CARD_FIELDS,
  FX_ROOT,
  HOOK_SNIPPETS,
  LINE_FIELDS,
  SIDE_FIELDS,
  type FxSymbol,
} from './fxApiCatalog';

let providersRegistered = false;

/** Match tavern dark chrome. */
const THEME_ID = 'lt-effect-dark';

function kindOf(sym: FxSymbol): monaco.languages.CompletionItemKind {
  switch (sym.kind) {
    case 'method':
      return monaco.languages.CompletionItemKind.Method;
    case 'snippet':
      return monaco.languages.CompletionItemKind.Snippet;
    case 'keyword':
      return monaco.languages.CompletionItemKind.Keyword;
    default:
      return monaco.languages.CompletionItemKind.Property;
  }
}

function toCompletion(
  sym: FxSymbol,
  range: monaco.IRange,
): monaco.languages.CompletionItem {
  return {
    label: sym.label,
    kind: kindOf(sym),
    detail: sym.detail,
    documentation: { value: sym.documentation },
    insertText: sym.insertText,
    insertTextRules:
      sym.insertText.includes('$') || sym.insertText.includes('\n')
        ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
    range,
  };
}

function wordRange(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.IRange {
  const word = model.getWordUntilPosition(position);
  return {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  };
}

function linePrefix(model: monaco.editor.ITextModel, position: monaco.Position): string {
  return model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });
}

function registerProviders(): void {
  if (providersRegistered) return;
  providersRegistered = true;

  monaco.languages.registerCompletionItemProvider('lua', {
    triggerCharacters: ['.', '_'],
    provideCompletionItems(model, position) {
      const range = wordRange(model, position);
      const prefix = linePrefix(model, position);
      const items: monaco.languages.CompletionItem[] = [];

      if (/\bfx\.\s*$/.test(prefix) || /\bfx\.[a-z_]*$/i.test(prefix)) {
        for (const sym of FX_ROOT) {
          const short = { ...sym, label: sym.label.replace(/^fx\./, '') };
          // Keep insert without leading fx. when already typing fx.
          short.insertText = short.insertText.replace(/^fx\./, '');
          items.push(toCompletion(short, range));
        }
      } else if (/\.(self|enemy)\.\s*$/.test(prefix) || /\.(self|enemy)\.[a-z_]*$/i.test(prefix)) {
        for (const sym of SIDE_FIELDS) items.push(toCompletion(sym, range));
      } else if (/\.line\.\s*$/.test(prefix) || /\.line\.[a-z_]*$/i.test(prefix)) {
        for (const sym of LINE_FIELDS) items.push(toCompletion(sym, range));
      } else if (
        /\.(cards|unplayed|played|chain)\[\w*\]\.\s*$/.test(prefix) ||
        /\.(cards|unplayed|played|chain)\[\w*\]\.[a-z_]*$/i.test(prefix)
      ) {
        for (const sym of CARD_FIELDS) items.push(toCompletion(sym, range));
      } else {
        for (const sym of [...FX_ROOT, ...HOOK_SNIPPETS]) {
          items.push(toCompletion(sym, range));
        }
      }

      return { suggestions: items };
    },
  });

  monaco.languages.registerHoverProvider('lua', {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const line = model.getLineContent(position.lineNumber);
      const around = line.slice(Math.max(0, word.startColumn - 8), word.endColumn + 4);

      const candidates = ALL_FX_SYMBOLS.filter((s) => {
        const bare = s.label.includes('.') ? s.label.split('.').pop()! : s.label;
        return bare === word.word || s.label === word.word || s.label.endsWith(`.${word.word}`);
      });

      // Prefer fx.* when line has fx. context
      const preferred =
        candidates.find((s) => around.includes('fx') && s.label.startsWith('fx')) ??
        candidates[0];
      if (!preferred) return null;

      return {
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        },
        contents: [
          { value: `**${preferred.label}** — \`${preferred.detail}\`` },
          { value: preferred.documentation },
        ],
      };
    },
  });
}

export function configureMonacoEnvironment(): void {
  (globalThis as unknown as { MonacoEnvironment: { getWorker: () => Worker } }).MonacoEnvironment = {
    getWorker() {
      return new editorWorker();
    },
  };
}

export function defineLtTheme(): void {
  monaco.editor.defineTheme(THEME_ID, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8a7a66', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'd2642c' },
      { token: 'string', foreground: '4ea572' },
      { token: 'number', foreground: 'e8c9a0' },
      { token: 'identifier', foreground: 'f4ebdf' },
    ],
    colors: {
      'editor.background': '#140f0c',
      'editor.foreground': '#f4ebdf',
      'editorLineNumber.foreground': '#6b5744',
      'editorLineNumber.activeForeground': '#cbb79a',
      'editor.selectionBackground': '#3a2a1c',
      'editor.lineHighlightBackground': '#1c1510',
      'editorCursor.foreground': '#d2642c',
      'editorWidget.background': '#221910',
      'editorSuggestWidget.background': '#221910',
      'editorSuggestWidget.border': '#4a3828',
      'editorHoverWidget.background': '#221910',
      'editorHoverWidget.border': '#4a3828',
      'scrollbarSlider.background': '#4a382866',
    },
  });
}

export function createLuaEditor(
  host: HTMLElement,
  initialValue: string,
): monaco.editor.IStandaloneCodeEditor {
  configureMonacoEnvironment();
  defineLtTheme();
  registerProviders();

  const editor = monaco.editor.create(host, {
    value: initialValue,
    language: 'lua',
    theme: THEME_ID,
    automaticLayout: true,
    fontFamily: "'IBM Plex Mono', ui-monospace, Consolas, monospace",
    fontSize: 14,
    lineHeight: 22,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    tabSize: 2,
    insertSpaces: true,
    wordWrap: 'on',
    padding: { top: 10, bottom: 10 },
    suggestOnTriggerCharacters: true,
    quickSuggestions: { other: true, comments: false, strings: false },
    snippetSuggestions: 'inline',
    renderLineHighlight: 'line',
    overviewRulerLanes: 0,
  });

  return editor;
}

export { monaco };
export const KeyMod = monaco.KeyMod;
export const KeyCode = monaco.KeyCode;
