/** Terminal presentation only; captured text and machine output keep their original bytes. */
export function terminalText(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\u034f\u180b-\u180d\u2028\u2029\ufe00-\ufe0f]/gu, (character) => {
    if (character === '\n' || character === '\t') return character;
    const code = character.codePointAt(0)!;
    return code > 0xffff ? `\\u{${code.toString(16)}}` : `\\u${code.toString(16).padStart(4, '0')}`;
  });
}

export function terminalFile(path: string, text: string): string[] {
  const name = JSON.stringify(terminalText(path));
  return [`BEGIN FILE ${name}`, ...terminalText(text).split('\n').map((line) => `| ${line}`), `END FILE ${name}`];
}
