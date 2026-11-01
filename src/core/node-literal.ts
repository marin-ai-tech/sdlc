/** Decode a supported JavaScript string value without evaluating its program. Legacy octal is unclassified. */
export function nodeLiteralValue(value: string): string | undefined {
  let out = '';
  const escapes: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '0': '\0' };
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '\\') { out += value[i]; continue; }
    const next = value[++i];
    if (next === undefined || /[1-9]/.test(next) || next === '0' && /[0-9]/.test(value[i + 1] ?? '')) return undefined;
    if (next === '\r' || next === '\n' || next === '\u2028' || next === '\u2029') {
      if (next === '\r' && value[i + 1] === '\n') i++;
      continue;
    }
    if (next === 'x' || next === 'u') {
      const tail = value.slice(i + 1);
      const hex = next === 'x' ? /^[0-9a-fA-F]{2}/.exec(tail)
        : /^\{([0-9a-fA-F]{1,6})\}/.exec(tail) ?? /^[0-9a-fA-F]{4}/.exec(tail);
      if (!hex) return undefined;
      const point = Number.parseInt(hex[1] ?? hex[0], 16);
      if (point > 0x10ffff) return undefined;
      out += String.fromCodePoint(point);
      i += hex[0].length;
    } else out += escapes[next] ?? next;
  }
  return out;
}

/** String/comment spans are already masked; delimiters inside an argument expression are balanced. */
export function nodeArgumentEnd(source: string, start: number): number | undefined {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if ('([{'.includes(source[i])) depth++;
    else if (')]}'.includes(source[i])) {
      if (depth === 0) return i;
      depth--;
    } else if (source[i] === ',' && depth === 0) return i;
  }
  return undefined;
}
