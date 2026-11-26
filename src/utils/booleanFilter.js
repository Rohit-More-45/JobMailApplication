/**
 * Deterministic Boolean Expression Parser & Evaluator for Job Description Filtering.
 * Supports:
 * - Keywords & multi-word phrases (quoted or unquoted): .net, dotnet, c#, sql server, "asp.net core"
 * - Operators: AND, OR, NOT (case-insensitive, plus &&, ||, !)
 * - Grouping: (...), including nested groups like (.net OR dotnet) AND (azure OR angular)
 */

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function tokenizeBooleanQuery(input) {
  if (!input || typeof input !== 'string') return [];

  const tokens = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    // Skip whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(' });
      i++;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')' });
      i++;
      continue;
    }

    if (ch === '!') {
      tokens.push({ type: 'NOT', value: 'NOT' });
      i++;
      continue;
    }

    if (input.slice(i, i + 2) === '&&') {
      tokens.push({ type: 'AND', value: 'AND' });
      i += 2;
      continue;
    }

    if (input.slice(i, i + 2) === '||') {
      tokens.push({ type: 'OR', value: 'OR' });
      i += 2;
      continue;
    }

    // Quoted phrase
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let phrase = '';
      while (i < len && input[i] !== quote) {
        phrase += input[i];
        i++;
      }
      if (i < len && input[i] === quote) i++;
      if (phrase.trim()) {
        tokens.push({ type: 'TERM', value: phrase.trim() });
      }
      continue;
    }

    // Word token until whitespace or paren
    let word = '';
    while (i < len && !/[\s()]/.test(input[i])) {
      if (input.slice(i, i + 2) === '&&' || input.slice(i, i + 2) === '||') break;
      word += input[i];
      i++;
    }

    const upper = word.toUpperCase();
    if (upper === 'AND') {
      tokens.push({ type: 'AND', value: 'AND' });
    } else if (upper === 'OR') {
      tokens.push({ type: 'OR', value: 'OR' });
    } else if (upper === 'NOT') {
      tokens.push({ type: 'NOT', value: 'NOT' });
    } else if (word.trim()) {
      // Merge adjacent unquoted TERM tokens into a multi-word phrase (e.g. "sql server")
      const prev = tokens[tokens.length - 1];
      if (prev && prev.type === 'TERM') {
        prev.value = prev.value + ' ' + word.trim();
      } else {
        tokens.push({ type: 'TERM', value: word.trim() });
      }
    }
  }

  return tokens;
}

export function parseBooleanExpression(input) {
  const tokens = tokenizeBooleanQuery(input);
  if (tokens.length === 0) {
    return { valid: true, ast: null, error: null };
  }

  let pos = 0;

  function peek() {
    return tokens[pos] || null;
  }

  function consume() {
    return tokens[pos++];
  }

  function parseOr() {
    let left = parseAnd();
    while (peek() && peek().type === 'OR') {
      consume();
      const right = parseAnd();
      left = { type: 'OR', left, right };
    }
    return left;
  }

  function parseAnd() {
    let left = parseNot();
    while (peek() && peek().type === 'AND') {
      consume();
      const right = parseNot();
      left = { type: 'AND', left, right };
    }
    return left;
  }

  function parseNot() {
    if (peek() && peek().type === 'NOT') {
      consume();
      const operand = parseNot();
      return { type: 'NOT', operand };
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const tok = peek();
    if (!tok) {
      throw new Error('Unexpected end of condition');
    }

    if (tok.type === 'LPAREN') {
      consume();
      const inner = parseOr();
      const close = peek();
      if (!close || close.type !== 'RPAREN') {
        throw new Error('Missing closing ")"');
      }
      consume();
      return inner;
    }

    if (tok.type === 'TERM') {
      consume();
      return { type: 'TERM', value: tok.value };
    }

    throw new Error(`Unexpected "${tok.value}"`);
  }

  try {
    const ast = parseOr();
    if (pos < tokens.length) {
      throw new Error(`Unexpected "${tokens[pos].value}"`);
    }
    return { valid: true, ast, error: null };
  } catch (err) {
    return { valid: false, ast: null, error: err?.message || 'Invalid condition' };
  }
}

export function matchTermInText(text, term) {
  if (!term) return true;
  const hay = (text || '').toLowerCase();
  const t = term.trim().toLowerCase();
  if (!t) return true;

  if (t.charAt(0) === '.') {
    // Dot-prefixed terms like ".net" match "asp.net", "vb.net", ".net", ".net/angular"
    const dotRe = new RegExp(escapeRegExp(t) + '(?=$|[^a-z0-9])', 'i');
    return dotRe.test(hay);
  }

  const re = new RegExp('(?:^|[^a-z0-9])' + escapeRegExp(t) + '(?=$|[^a-z0-9])', 'i');
  return re.test(hay);
}

export function evaluateBooleanAst(ast, text) {
  if (!ast) return true;
  switch (ast.type) {
    case 'TERM':
      return matchTermInText(text, ast.value);
    case 'NOT':
      return !evaluateBooleanAst(ast.operand, text);
    case 'AND':
      return evaluateBooleanAst(ast.left, text) && evaluateBooleanAst(ast.right, text);
    case 'OR':
      return evaluateBooleanAst(ast.left, text) || evaluateBooleanAst(ast.right, text);
    default:
      return true;
  }
}

export function matchesBooleanCondition(text, conditionStr) {
  if (!conditionStr || !conditionStr.trim()) return true;
  const { valid, ast } = parseBooleanExpression(conditionStr);
  if (!valid || !ast) return true;
  return evaluateBooleanAst(ast, text);
}
