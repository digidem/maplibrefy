import type { Change } from './types.js'

/** Replace the Mapbox-only expressions in `value` with MapLibre equivalents,
 *  recording each replacement at `path` (`layers[3].paint.line-width[2]`). */
export function rewriteExpression(
  value: unknown,
  path: string,
  changes: Change[],
): unknown {
  if (!Array.isArray(value)) return value
  const operator = value[0]
  // Arrays without an operator are literals (`[0, 1]`); `literal` wraps one.
  if (typeof operator !== 'string' || operator === 'literal') return value

  const args = rewriteArguments(value, path, changes)
  const rewritten = rewriteOperator(operator, args)
  if (rewritten === undefined) return [operator, ...args]
  changes.push({ kind: 'expression-rewritten', path, operator })
  return rewritten
}

function rewriteOperator(operator: string, args: unknown[]): unknown {
  switch (operator) {
    case 'pitch':
    case 'distance-from-center':
      return 0
    case 'measure-light':
      return 1
    case 'hsl':
      if (args.length !== 3) return undefined
      return [
        'to-color',
        ['concat', 'hsl(', args[0], ', ', args[1], '%, ', args[2], '%)'],
      ]
    case 'hsla':
      if (args.length !== 4) return undefined
      return [
        'to-color',
        [
          'concat',
          'hsla(',
          args[0],
          ', ',
          args[1],
          '%, ',
          args[2],
          '%, ',
          args[3],
          ')',
        ],
      ]
    default:
      return undefined
  }
}

function rewriteArguments(
  expression: unknown[],
  path: string,
  changes: Change[],
): unknown[] {
  const args = expression.slice(1)
  return args.map((arg, i) => {
    // `match` labels are literal values, even when they look like expressions.
    if (isMatchLabel(expression, i + 1)) return arg
    return rewriteExpression(arg, `${path}[${i + 1}]`, changes)
  })
}

function isMatchLabel(expression: unknown[], index: number): boolean {
  if (expression[0] !== 'match' || index < 2) return false
  return index < expression.length - 1 && index % 2 === 0
}
