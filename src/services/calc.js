'use strict';

const { UserError } = require('../utils/errors');

const MAX_LENGTH = 120;
const MAX_DEPTH = 64;

/**
 * Safe arithmetic evaluator (recursive descent). Supports + - * / % ^, parentheses,
 * unary minus, decimals, and a fixed set of functions. It never calls eval or Function.
 */
function evaluate(expression) {
  const src = String(expression ?? '');
  if (src.length === 0 || src.length > MAX_LENGTH) throw new UserError(`Expressions must be 1-${MAX_LENGTH} characters.`, { code: 'CALC_LENGTH' });
  const tokens = tokenize(src);
  let pos = 0;
  let depth = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr() {
    let value = parseTerm();
    while (peek() && (peek().v === '+' || peek().v === '-')) {
      const op = next().v;
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }
  function parseTerm() {
    let value = parseUnary();
    while (peek() && (peek().v === '*' || peek().v === '/' || peek().v === '%')) {
      const op = next().v;
      const rhs = parseUnary();
      if ((op === '/' || op === '%') && rhs === 0) throw new UserError('Division by zero.', { code: 'CALC_DIV0' });
      value = op === '*' ? value * rhs : op === '/' ? value / rhs : value % rhs;
    }
    return value;
  }
  function parseUnary() {
    if (peek() && peek().v === '-') {
      next();
      return -parseUnary();
    }
    return parsePower();
  }
  function parsePower() {
    const base = parseAtom();
    if (peek() && peek().v === '^') {
      next();
      const exp = parseUnary();
      return base ** exp;
    }
    return base;
  }
  function parseAtom() {
    depth += 1;
    if (depth > MAX_DEPTH) throw new UserError('Expression is nested too deeply.', { code: 'CALC_DEPTH' });
    const tok = next();
    if (!tok) throw new UserError('Unexpected end of expression.', { code: 'CALC_SYNTAX' });
    let value;
    if (tok.t === 'num') {
      value = tok.v;
    } else if (tok.t === 'fn') {
      const open = next();
      if (!open || open.v !== '(') throw new UserError(`Function ${tok.v} needs parentheses.`, { code: 'CALC_SYNTAX' });
      const arg = parseExpr();
      const close = next();
      if (!close || close.v !== ')') throw new UserError('Missing closing parenthesis.', { code: 'CALC_SYNTAX' });
      value = FUNCTIONS[tok.v](arg);
    } else if (tok.v === '(') {
      value = parseExpr();
      const close = next();
      if (!close || close.v !== ')') throw new UserError('Missing closing parenthesis.', { code: 'CALC_SYNTAX' });
    } else {
      throw new UserError(`Unexpected token "${tok.v}".`, { code: 'CALC_SYNTAX' });
    }
    depth -= 1;
    return value;
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new UserError('Unexpected trailing input.', { code: 'CALC_SYNTAX' });
  if (!Number.isFinite(result) || Math.abs(result) > 1e15) {
    throw new UserError('The result is too large or undefined.', { code: 'CALC_RANGE' });
  }
  return result;
}

const FUNCTIONS = Object.freeze({
  sqrt: (x) => {
    if (x < 0) throw new UserError('sqrt needs a non-negative value.', { code: 'CALC_DOMAIN' });
    return Math.sqrt(x);
  },
  abs: (x) => Math.abs(x),
  floor: (x) => Math.floor(x),
  ceil: (x) => Math.ceil(x),
  round: (x) => Math.round(x),
});

function tokenize(src) {
  const out = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([a-z]+)|(\*\*|[-+*/%^()]))/gy;
  let m;
  let last = 0;
  while (last < src.length && (m = re.exec(src)) !== null) {
    last = re.lastIndex;
    if (m[1] !== undefined) out.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) {
      if (!(m[2] in FUNCTIONS)) throw new UserError(`Unknown function "${m[2]}".`, { code: 'CALC_SYNTAX' });
      out.push({ t: 'fn', v: m[2] });
    } else {
      const op = m[3] === '**' ? '^' : m[3];
      out.push({ t: 'op', v: op });
    }
    if (re.lastIndex === src.length) break;
  }
  if (src.slice(last).trim().length > 0) {
    throw new UserError('That expression contains unsupported characters.', { code: 'CALC_SYNTAX' });
  }
  return out;
}

module.exports = { evaluate, tokenize };
