import type { CSSProperties, ReactNode } from 'react'

const palette = [
  '#3b3f4c',
  '#f0616d',
  '#5fcf80',
  '#e8c35a',
  '#6c9ef8',
  '#c678dd',
  '#4fc1d1',
  '#d7dae0',
  '#6b7080',
  '#ff7a85',
  '#7ee39a',
  '#f5d97a',
  '#8ab4ff',
  '#d89cf0',
  '#73d9e6',
  '#ffffff',
]

/** Converts ANSI SGR escape sequences into styled spans. Unknown sequences are dropped. */
export function ansiToReact(input: string): ReactNode[] {
  const out: ReactNode[] = []
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching escape codes is the point
  const re = /\x1b\[([\d;]*)m|\x1b\[[\d;]*[A-Za-z]|\r/g
  let style: CSSProperties = {}
  let last = 0
  let key = 0
  const push = (text: string) => {
    if (text)
      out.push(
        Object.keys(style).length ? (
          <span key={key++} style={style}>
            {text}
          </span>
        ) : (
          text
        ),
      )
  }
  for (let m = re.exec(input); m; m = re.exec(input)) {
    push(input.slice(last, m.index))
    last = re.lastIndex
    if (m[1] === undefined) continue
    const codes = m[1] === '' ? [0] : m[1].split(';').map(Number)
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]!
      if (c === 0) style = {}
      else if (c === 1) style = { ...style, fontWeight: 600 }
      else if (c === 3) style = { ...style, fontStyle: 'italic' }
      else if (c === 4) style = { ...style, textDecoration: 'underline' }
      else if (c === 22) style = { ...style, fontWeight: undefined }
      else if (c === 39) style = { ...style, color: undefined }
      else if (c >= 30 && c <= 37) style = { ...style, color: palette[c - 30] }
      else if (c >= 90 && c <= 97) style = { ...style, color: palette[c - 90 + 8] }
      else if (c === 38 && codes[i + 1] === 5) {
        const n = codes[i + 2] ?? 7
        style = { ...style, color: n < 16 ? palette[n] : undefined }
        i += 2
      } else if (c === 38 && codes[i + 1] === 2) {
        style = { ...style, color: `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})` }
        i += 4
      }
    }
  }
  push(input.slice(last))
  return out
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: strip escape codes
export const stripAnsi = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, '')
