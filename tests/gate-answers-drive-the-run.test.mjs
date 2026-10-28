// The answers at the two reviews drive the run (issue 65): these tests run the
// flow of cinatra/oas.json step by step and record which model-bridge steps
// start, for every answer in tests/fixtures/gate-answer-scenarios.json.
//
// The step trace below follows the pinned runtime's rules for the node kinds
// this flow uses, and refuses any other kind or construct, so that a change it
// cannot follow fails here instead of passing:
//   - an ApiNode is recorded with its inputs and returns fixed outputs; no
//     request is sent;
//   - an InputMessageNode takes the next answer as its `userResponse`, and the
//     run pauses there when no answer is left;
//   - a PluginExtractNode (the runtime's ExtractValueFromJsonStep) parses its
//     text and runs its jq program; the trace follows only the program this
//     flow pins (EXPECTED_PROGRAM below) through a JavaScript twin, and only for
//     a text that the runtime's extractor reads whole: one strict JSON text
//     without a code fence, as the wrap step writes it (see parseLikeTheStep);
//   - a PluginTemplateNode renders its Jinja template (the subset below; its
//     tojson filter writes a string as the runtime's Jinja does) and writes it
//     as its one output, `output` or the name that its output_mapping gives;
//     the trace follows only a node that declares exactly that output, as a
//     string (see renderLikeTheStep);
//   - a BranchingNode follows the branch that its mapping names for the value,
//     else "default";
//   - every step but the end records what it writes when it completes (an input
//     message step that pauses for an answer returns before it records), a
//     branching or output message step an empty set, and a step whose written
//     outputs differ from the ones it declares throws (for a StartNode that
//     declares no outputs, the declared ones are its inputs);
//   - an input of a step other than the start takes the newest value of a data
//     edge into it from a step that has run, else its default, and the trace
//     throws when it has neither; a start input takes the run's input
//     (START_INPUTS below), else its default (undefined when it has none);
//   - when a step runs, a data edge into it that names an input it does not
//     declare throws, and so does a data edge into it from a step that has run
//     that reads an output that step did not write; the start checks the edges
//     into it after it records, so an edge from the start into the start is
//     checked too. The output that an edge reads from a step that has not run
//     yet is not checked (the edge gives no value), and no edge into a step
//     that does not run is checked;
//   - a name that the flow gives (a step, an output, an input, a start input,
//     a parse step, a template variable or filter) is looked up only among an
//     object's own properties, never among the ones every JavaScript object
//     inherits (toString, constructor).
//
// The same scenarios were run through the pinned runtime (wayflowcore 26.1.2)
// with a stub bridge; the steps and the closing text matched these
// expectations. The trace has no regex step: the flow has none.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(path.join(packageRoot, "cinatra", "oas.json"), "utf8"));
const scenarios = JSON.parse(
  readFileSync(path.join(packageRoot, "tests", "fixtures", "gate-answer-scenarios.json"), "utf8"),
);

// ---------------------------------------------------------------------------
// The template reader of this trace. It reads the decision steps' templates and
// the closing message; it is not Jinja, and what it does is listed here. A test
// named in quotes is in "the step trace reads the template the way the runtime
// does" unless another block is named.
// Tags
// - It splits text from {{ }} print tags and {% %} statement tags; a tag ends at
//   its first closer, also inside a string literal (not driven by a test), and a
//   {% tag closed by }} or a {{ tag closed by %} throws ("refuses a tag whose
//   opener and closer do not pair").
// - "-" on a print or statement tag trims the text next to it ("applies
//   whitespace control, set, if, elif, else and filters").
// - {# #} writes nothing and ends at the first #} ("writes nothing for a
//   comment, also one that holds a print tag"); a comment with "-" throws
//   ("refuses a construct it does not follow"), and so does {# or #} inside a
//   tag ("refuses comment-looking text inside a print or statement tag").
// Statements
// - set NAME = expr, and if / elif / else / endif ("applies whitespace control,
//   set, if, elif, else and filters").
// - set NAME ... endset assigns the text its body writes, and a set inside it
//   does not reach past endset ("keeps a set inside a block set to that
//   block"; "reads a loop over a list, a block set, ...").
// - for NAME in expr ... endfor runs its body for each item of a list and then
//   gives NAME its earlier value back ("reads a loop over a list, a block set,
//   ..."). It throws for an else, two names, an if filter, a set inside the
//   loop, and a value that is not a list ("refuses a construct it does not
//   follow"), and for the name loop or the word recursive (not driven by a test).
// - true, false and none, in either case, throw as a target of set, a block set
//   or for ("refuses a constant name as an assignment target").
// - endset, endfor, endif and else throw unless they hold their word alone, and
//   elif needs a test ("refuses a malformed closing tag"); a block closed by
//   another block's closing word throws ("refuses a block whose closing
//   statement belongs to another block"). Another statement word throws (not
//   driven by a test).
// Names
// - A name is ASCII letters, digits and "_", not starting with a digit; other
//   names throw (not driven by a test). Names are bound in a Map, so a name such as
//   __proto__ is its own entry, and a name that is not bound throws ("binds a
//   name in its own map, __proto__ and constructor too"; "refuses a
//   variable that the template is not given, also when its name is inherited",
//   in the block on own properties).
// Expressions
// - String literals in single or double quotes, with the escapes \\, \', \",
//   \n, \r, \t, \uXXXX and \xXX; another escape throws (the \u escape: "applies
//   whitespace control, ..."; the others are not driven by a test).
// - Whole numbers; a "." throws (not driven by a test). true, false, True and
//   False (true in "applies whitespace control, ..."; the others are not driven
//   by a test).
// - ( ), list literals [a, b], x if t else y (an if without else throws), or,
//   and, not, == != < > <= >=, in, not in (and, ==, > and in, and x if t else
//   y, in "applies whitespace control, ..."; the others are not driven by a test).
// - is none, is not none, is mapping and is not mapping; another test throws
//   ("reads a loop over a list, ..."; "refuses a construct it does not follow").
// - x[key] reads a string key that a dict holds, and throws otherwise ("reads a
//   loop over a list, ..."; "refuses a construct it does not follow").
// Filters and printing
// - string, lower, replace, truncate(length, true, end, leeway), unique(true),
//   list and length ("applies whitespace control, ..."), tojson of a string
//   ("writes a string with tojson as the runtime's Jinja does"; tojson of
//   another value throws: "refuses a construct it does not follow"), and first
//   (not driven by a test). A filter's function gets the arguments the template
//   gives and ignores ones it does not take, for example length(1) (not driven by
//   a test). Another filter name throws ("refuses a filter that the trace does
//   not follow, also when its name is inherited", in the block on own
//   properties).
// - A print writes a string as it is, a number in decimal and null as None
//   ("applies whitespace control, ..."); a boolean, list or dict throws (not
//   driven by a test).
// Where a template outside the flow uses Jinja the reader does not follow, the
// reader can read it differently from the runtime. For the flow's own closing
// message, the PR compares the runtime's renders with these tests.

function decodeLiteral(body) {
  // Jinja decodes a string literal with Python's unicode-escape codec.
  let out = "";
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = body[i + 1];
    i += 1;
    if (n === "\\" || n === "'" || n === '"') out += n;
    else if (n === "n") out += "\n";
    else if (n === "r") out += "\r";
    else if (n === "t") out += "\t";
    else if (n === "u" || n === "x") {
      const width = n === "u" ? 4 : 2;
      const hex = body.slice(i + 1, i + 1 + width);
      if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== width) throw new Error(`bad escape \\${n}${hex}`);
      out += String.fromCharCode(parseInt(hex, 16));
      i += width;
    } else throw new Error(`escape \\${n} is not followed`);
  }
  return out;
}

function tokenizeExpression(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i += 1;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      if (j >= src.length) throw new Error("unterminated string");
      tokens.push({ t: "str", v: decodeLiteral(src.slice(i + 1, j)) });
      i = j + 1;
    } else if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j])) j += 1;
      tokens.push({ t: "num", v: Number(src.slice(i, j)) });
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1;
      tokens.push({ t: "name", v: src.slice(i, j) });
      i = j;
    } else {
      const two = src.slice(i, i + 2);
      if (["==", "!=", ">=", "<="].includes(two)) {
        tokens.push({ t: "op", v: two });
        i += 2;
      } else if ("|(),[]<>".includes(c)) {
        tokens.push({ t: "op", v: c });
        i += 1;
      } else throw new Error(`character ${c} is not followed`);
    }
  }
  return tokens;
}

function parseExpression(src) {
  const tokens = tokenizeExpression(src);
  let p = 0;
  const peek = () => tokens[p];
  const isName = (v) => peek()?.t === "name" && peek().v === v;
  const isOp = (v) => peek()?.t === "op" && peek().v === v;
  const take = () => tokens[p++];
  const expectOp = (v) => {
    if (!isOp(v)) throw new Error(`expected ${v} in ${src}`);
    take();
  };

  function conditional() {
    const left = orExpr();
    if (isName("if")) {
      take();
      const test = orExpr();
      if (!isName("else")) throw new Error("conditional without else");
      take();
      const right = conditional();
      return { k: "cond", test, left, right };
    }
    return left;
  }
  function orExpr() {
    let left = andExpr();
    while (isName("or")) {
      take();
      left = { k: "or", left, right: andExpr() };
    }
    return left;
  }
  function andExpr() {
    let left = notExpr();
    while (isName("and")) {
      take();
      left = { k: "and", left, right: notExpr() };
    }
    return left;
  }
  function notExpr() {
    if (isName("not")) {
      take();
      return { k: "not", value: notExpr() };
    }
    return compare();
  }
  function compare() {
    let left = filtered();
    if (isName("is")) {
      take();
      let negate = false;
      if (isName("not")) {
        take();
        negate = true;
      }
      const name = take();
      if (name?.t !== "name" || !["none", "mapping"].includes(name.v)) throw new Error(`the test ${name?.v} is not followed`);
      left = { k: "test", name: name.v, value: left };
      if (negate) left = { k: "not", value: left };
    }
    for (;;) {
      if (peek()?.t === "op" && ["==", "!=", ">", "<", ">=", "<="].includes(peek().v)) {
        const op = take().v;
        left = { k: "cmp", op, left, right: filtered() };
      } else if (isName("in")) {
        take();
        left = { k: "in", left, right: filtered() };
      } else if (isName("not") && tokens[p + 1]?.t === "name" && tokens[p + 1].v === "in") {
        take();
        take();
        left = { k: "not", value: { k: "in", left, right: filtered() } };
      } else return left;
    }
  }
  function filtered() {
    let value = primary();
    while (isOp("[")) {
      take();
      const index = conditional();
      expectOp("]");
      value = { k: "item", value, index };
    }
    while (isOp("|")) {
      take();
      const name = take();
      if (name?.t !== "name") throw new Error("filter name expected");
      const args = [];
      if (isOp("(")) {
        take();
        while (!isOp(")")) {
          args.push(conditional());
          if (isOp(",")) take();
          else if (!isOp(")")) throw new Error("expected , or )");
        }
        take();
      }
      value = { k: "filter", name: name.v, value, args };
    }
    return value;
  }
  function primary() {
    const tok = take();
    if (!tok) throw new Error(`unexpected end of ${src}`);
    if (tok.t === "str" || tok.t === "num") return { k: "lit", v: tok.v };
    if (tok.t === "name") {
      if (tok.v === "true" || tok.v === "True") return { k: "lit", v: true };
      if (tok.v === "false" || tok.v === "False") return { k: "lit", v: false };
      if (["if", "else", "or", "and", "not", "in"].includes(tok.v)) throw new Error(`unexpected ${tok.v}`);
      return { k: "var", name: tok.v };
    }
    if (tok.t === "op" && tok.v === "(") {
      const inner = conditional();
      expectOp(")");
      return inner;
    }
    if (tok.t === "op" && tok.v === "[") {
      const items = [];
      while (!isOp("]")) {
        items.push(conditional());
        if (isOp(",")) take();
        else if (!isOp("]")) throw new Error("expected , or ]");
      }
      take();
      return { k: "list", items };
    }
    throw new Error(`unexpected ${tok.v}`);
  }
  const tree = conditional();
  if (p !== tokens.length) throw new Error(`trailing tokens in ${src}`);
  return tree;
}

function pyStr(v) {
  if (v === undefined || v === null) return "None";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  throw new Error(`the string filter of a ${typeof v} is not followed`);
}

function isMapping(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

const FILTERS = {
  string: (v) => pyStr(v),
  lower: (v) => {
    if (typeof v !== "string") throw new Error("lower of a non-string");
    return v.toLowerCase();
  },
  replace: (v, from, to) => {
    if (typeof v !== "string") throw new Error("replace of a non-string");
    return v.split(from).join(to);
  },
  truncate: (v, length, killwords, end, leeway) => {
    if (typeof v !== "string" || killwords !== true || typeof end !== "string" || typeof leeway !== "number") {
      throw new Error("only truncate(length, true, end, leeway) is followed");
    }
    const chars = Array.from(v);
    if (chars.length <= length + leeway) return v;
    return chars.slice(0, length - Array.from(end).length).join("") + end;
  },
  unique: (v, caseSensitive) => {
    if (!Array.isArray(v) || caseSensitive !== true) throw new Error("only unique(true) of a list is followed");
    return [...new Set(v)];
  },
  list: (v) => {
    if (!Array.isArray(v)) throw new Error("list of a non-list");
    return [...v];
  },
  length: (v) => {
    if (typeof v === "string") return Array.from(v).length;
    if (Array.isArray(v)) return v.length;
    throw new Error("length of a non-sequence");
  },
  first: (v) => {
    if (!Array.isArray(v)) throw new Error("first of a non-list");
    return v[0];
  },
  tojson: (v) => pyHtmlSafeJsonString(v),
};

/**
 * Jinja's tojson of a string: Python's json.dumps (ensure_ascii: every
 * character outside space..tilde as \uXXXX in lower-case hex, a character
 * above U+FFFF as its surrogate pair), then <, >, & and ' as <, >,
 * & and ' (jinja2 utils.htmlsafe_json_dumps). Only a string is
 * followed.
 */
function pyHtmlSafeJsonString(v) {
  if (typeof v !== "string") throw new Error("tojson of a non-string is not followed");
  const hex = (n) => `\\u${n.toString(16).padStart(4, "0")}`;
  const SHORT = { '"': '\\"', "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f" };
  let out = '"';
  for (const ch of v) {
    const c = ch.codePointAt(0);
    if (SHORT[ch]) out += SHORT[ch];
    else if (c >= 0x20 && c <= 0x7e) out += ch;
    else if (c > 0xffff) out += hex(0xd800 + ((c - 0x10000) >> 10)) + hex(0xdc00 + ((c - 0x10000) & 0x3ff));
    else out += hex(c);
  }
  out += '"';
  return out.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026").replaceAll("'", "\\u0027");
}

function evaluate(node, scope) {
  switch (node.k) {
    case "lit":
      return node.v;
    case "var":
      if (!scope.has(node.name)) throw new Error(`${node.name} is not defined`);
      return scope.get(node.name);
    case "list":
      return node.items.map((item) => evaluate(item, scope));
    case "cond":
      return truthy(evaluate(node.test, scope)) ? evaluate(node.left, scope) : evaluate(node.right, scope);
    case "or": {
      const left = evaluate(node.left, scope);
      return truthy(left) ? left : evaluate(node.right, scope);
    }
    case "and": {
      const left = evaluate(node.left, scope);
      return truthy(left) ? evaluate(node.right, scope) : left;
    }
    case "not":
      return !truthy(evaluate(node.value, scope));
    case "in": {
      const left = evaluate(node.left, scope);
      const right = evaluate(node.right, scope);
      if (isMapping(right) && typeof left === "string") return Object.hasOwn(right, left);
      if (typeof right === "string" && typeof left === "string") return right.includes(left);
      if (Array.isArray(right)) return right.includes(left);
      throw new Error("in of this pair is not followed");
    }
    case "cmp": {
      const l = evaluate(node.left, scope);
      const r = evaluate(node.right, scope);
      if (node.op === "==" || node.op === "!=") {
        if (Array.isArray(l) || Array.isArray(r)) throw new Error("list comparison is not followed");
        return node.op === "==" ? l === r : l !== r;
      }
      if (typeof l !== "number" || typeof r !== "number") throw new Error("order comparison of non-numbers");
      return { ">": l > r, "<": l < r, ">=": l >= r, "<=": l <= r }[node.op];
    }
    case "test": {
      const v = evaluate(node.value, scope);
      return node.name === "none" ? v === null || v === undefined : isMapping(v);
    }
    case "item": {
      // A string key that the dict holds; anything else throws.
      const v = evaluate(node.value, scope);
      const key = evaluate(node.index, scope);
      if (!isMapping(v) || typeof key !== "string") throw new Error("only a string key of a dict is followed");
      if (!Object.hasOwn(v, key)) throw new Error(`the key ${key} is not in the dict`);
      return v[key];
    }
    case "filter": {
      const fn = Object.hasOwn(FILTERS, node.name) ? FILTERS[node.name] : undefined;
      if (!fn) throw new Error(`filter ${node.name} is not followed`);
      return fn(evaluate(node.value, scope), ...node.args.map((a) => evaluate(a, scope)));
    }
    default:
      throw new Error(`node ${node.k} is not followed`);
  }
}

function renderTemplate(template, variables) {
  // Split into text and tags, applying the "-" whitespace control. The scan
  // takes the earliest opener: a comment writes nothing and ends at the first
  // "#}", also when it holds a print tag, as the closing message's input hint
  // does. A comment with the "-" whitespace control throws, and so does a print
  // or statement tag that holds comment-looking text or whose closer is of the
  // other kind.
  const parts = [];
  const re = /\{#([\s\S]*?)#\}|(\{%-?|\{\{-?)([\s\S]*?)(-?%\}|-?\}\})/g;
  let last = 0;
  let m;
  while ((m = re.exec(template)) !== null) {
    parts.push({ kind: "text", value: template.slice(last, m.index) });
    last = re.lastIndex;
    if (m[2] === undefined) {
      if (m[1].startsWith("-") || m[1].endsWith("-")) throw new Error("a comment with whitespace control is not followed");
      continue;
    }
    if (m[3].includes("{#") || m[3].includes("#}")) throw new Error("comment-looking text inside a tag is not followed");
    if (m[2].startsWith("{%") !== m[4].endsWith("%}")) throw new Error("a tag whose opener and closer do not pair is not followed");
    parts.push({
      kind: m[2].startsWith("{%") ? "stmt" : "print",
      body: m[3].trim(),
      trimBefore: m[2].endsWith("-"),
      trimAfter: m[4].startsWith("-"),
    });
  }
  parts.push({ kind: "text", value: template.slice(last) });
  if (/\{#|\{%|\{\{/.test(parts.filter((x) => x.kind === "text").map((x) => x.value).join(""))) {
    throw new Error("a tag this subset does not read");
  }
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part.kind === "text") continue;
    if (part.trimBefore && parts[i - 1]?.kind === "text") parts[i - 1].value = parts[i - 1].value.replace(/\s+$/, "");
    if (part.trimAfter && parts[i + 1]?.kind === "text") parts[i + 1].value = parts[i + 1].value.replace(/^\s+/, "");
  }

  // Build the statement tree.
  // These names are constants; as a set or for target they throw.
  const assignable = (name) => {
    if (["true", "false", "none", "True", "False", "None"].includes(name)) throw new Error(`can't assign to the constant ${name}`);
  };
  let pos = 0;
  let loopDepth = 0;
  function block(stops) {
    const body = [];
    while (pos < parts.length) {
      const part = parts[pos];
      if (part.kind === "text") {
        if (part.value) body.push({ k: "text", v: part.value });
        pos += 1;
        continue;
      }
      if (part.kind === "print") {
        body.push({ k: "print", expr: parseExpression(part.body) });
        pos += 1;
        continue;
      }
      const word = part.body.split(/\s+/)[0];
      if (stops.includes(word)) {
        // A closing tag holds its word alone ("endfor garbage" throws); elif
        // carries a test.
        if (word !== "elif" && part.body !== word) throw new Error(`a malformed closing tag is not followed: ${part.body}`);
        return body;
      }
      pos += 1;
      if (word === "set") {
        // A set inside a loop throws: the trace does not follow its scope.
        if (loopDepth > 0) throw new Error("a set inside a loop is not followed");
        const bm = /^set\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(part.body);
        if (bm) {
          assignable(bm[1]);
          // The block form: the name takes the text the body writes.
          const inner = block(["endset"]);
          pos += 1;
          body.push({ k: "blockset", name: bm[1], body: inner });
          continue;
        }
        const sm = /^set\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/.exec(part.body);
        if (!sm) throw new Error(`set not followed: ${part.body}`);
        assignable(sm[1]);
        body.push({ k: "set", name: sm[1], expr: parseExpression(sm[2]) });
      } else if (word === "for") {
        // One loop name over a list; an else, a filter, recursive or the name loop throws.
        const fm = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([\s\S]+)$/.exec(part.body);
        if (!fm || /\s(if|recursive)\s|\s(if|recursive)$/.test(fm[2]) || fm[1] === "loop") throw new Error(`for not followed: ${part.body}`);
        assignable(fm[1]);
        loopDepth += 1;
        const inner = block(["endfor", "else"]);
        loopDepth -= 1;
        if (parts[pos].body.split(/\s+/)[0] !== "endfor") throw new Error("for with else is not followed");
        pos += 1;
        body.push({ k: "for", name: fm[1], iter: parseExpression(fm[2]), body: inner });
      } else if (word === "if") {
        const arms = [{ test: parseExpression(part.body.slice(2)), body: block(["elif", "else", "endif"]) }];
        let otherwise = [];
        for (;;) {
          const stop = parts[pos];
          if (!stop) throw new Error("if without endif");
          const stopWord = stop.body.split(/\s+/)[0];
          pos += 1;
          if (stopWord === "elif") arms.push({ test: parseExpression(stop.body.slice(4)), body: block(["elif", "else", "endif"]) });
          else if (stopWord === "else") otherwise = block(["endif"]);
          else if (stopWord === "endif") break;
        }
        body.push({ k: "if", arms, otherwise });
      } else throw new Error(`statement ${word} is not followed`);
    }
    if (stops.length > 0) throw new Error(`missing ${stops.join("/")}`);
    return body;
  }
  const tree = block([]);
  if (pos !== parts.length) throw new Error("unbalanced statements");

  // A Map binds a name as its own entry; a plain object would hide or reach
  // inherited names such as __proto__.
  const scope = new Map(Object.entries(variables));
  let out = "";
  function run(body) {
    for (const st of body) {
      if (st.k === "text") out += st.v;
      else if (st.k === "print") out += pyStr(evaluate(st.expr, scope));
      else if (st.k === "set") scope.set(st.name, evaluate(st.expr, scope));
      else if (st.k === "blockset") {
        // The block runs in its own scope: a set inside it does not reach past
        // endset, and the name gets the captured text.
        const outer = out;
        const kept = new Map(scope);
        out = "";
        run(st.body);
        const text = out;
        out = outer;
        scope.clear();
        for (const [name, value] of kept) scope.set(name, value);
        scope.set(st.name, text);
      } else if (st.k === "for") {
        const items = evaluate(st.iter, scope);
        if (!Array.isArray(items)) throw new Error("a for over anything but a list is not followed");
        const had = scope.has(st.name);
        const saved = scope.get(st.name);
        for (const item of items) {
          scope.set(st.name, item);
          run(st.body);
        }
        if (had) scope.set(st.name, saved);
        else scope.delete(st.name);
      }
      else if (st.k === "if") {
        const arm = st.arms.find((a) => truthy(evaluate(a.test, scope)));
        run(arm ? arm.body : st.otherwise);
      }
    }
  }
  run(tree);
  return out;
}

// ---------------------------------------------------------------------------
// The parse step. Its jq program is pinned: the same text as the flow's, built
// from the review's snapshot (core hitl-gate-submit.ts:352-389).
//
// The wrap step hands the parse step {"answer": <the answer as a JSON string>}
// with every backtick escaped, so the runtime's extractor, which splits its
// text on three backticks and repairs each part (json_repair), gets one strict
// JSON text and parses it whole. The program reads the answer by its parsed
// value: strict JSON only (each token as RFC 8259 writes it, no key twice in
// an object, nothing after the value), compared by value, never by its bytes.

const SNAPSHOTS = {
  schema_decision_parse: { type: "scrape-schema", keys: ["type", "instructions", "outputSchema", "seedUrls", "snapshotAt"] },
  list_decision_parse: { type: "final-list", keys: ["type", "listName", "memberRefs", "memberCount", "snapshotAt"] },
};

/** One strict JSON token; the same regular expression runs in jq (Oniguruma) and here. */
const TOKEN = String.raw`"(?:[^"\\\x00-\x1f]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?(?![0-9.eE+-])|true|false|null|[{}\[\]:,]|[ \t\n\r]+`;
const SPACE = String.raw`^[ \t\n\r]`;

function EXPECTED_PROGRAM(snapshot) {
  return (
    'def known: if . == "approve" or . == "revise" or . == "reject" then . else "unknown" end; ' +
    "def strict: . as $raw " +
    `| [scan(${JSON.stringify(TOKEN)})] as $tok ` +
    '| if ($tok | add // "") != $raw then [] ' +
    `elif (reduce ($tok[] | select(test(${JSON.stringify(SPACE)}) | not)) as $t ` +
    "({s: [], k: null, ok: true}; " +
    "if .ok | not then . " +
    'elif $t == "{" then .s += [[]] | .k = null ' +
    'elif $t == "[" then .s += [null] | .k = null ' +
    'elif $t == "}" or $t == "]" then .s |= .[:-1] | .k = null ' +
    'elif $t == ":" then (if .k == null or (.s | length) == 0 or (.s[-1] | type) != "array" then .ok = false ' +
    "else (.k | fromjson) as $key | (.s | length - 1) as $n " +
    "| if any(.s[$n][]; . == $key) then .ok = false else .s[$n] += [$key] | .k = null end end) " +
    'elif ($t | startswith("\\"")) then .k = $t ' +
    "else .k = null end) | .ok) | not then [] " +
    "else [try fromjson] end; " +
    "def textverdict(f): " +
    'if type != "string" then "unknown" ' +
    'elif . == "[Approved by operator]" then "approve" ' +
    'elif . == "[Rejected by operator]" then "reject" ' +
    'else (strict as $p | if ($p | length) == 1 then ($p[0] | f) else "unknown" end) end; ' +
    "def verdict: " +
    'if type != "object" then "unknown" ' +
    'elif has("decision") then ((.decision | known) as $d ' +
    '| if has("approved") and (if .approved == true then "approve" elif .approved == false then "reject" else "unknown" end) != $d then "unknown" ' +
    'elif has("text") and (.text | textverdict(verdict)) != $d then "unknown" ' +
    "else $d end) " +
    'elif . == {"approved": false} then "reject" ' +
    'elif . == {"approved": true} then "approve" ' +
    `elif keys_unsorted == ${JSON.stringify(snapshot.keys).replaceAll(",", ", ")} and .type == "${snapshot.type}" then "approve" ` +
    'else "unknown" end; ' +
    'if type == "object" and keys_unsorted == ["answer"] ' +
    'then (.answer | textverdict(if type == "object" and keys_unsorted == ["text", "attachments"] ' +
    "then (.text | textverdict(verdict)) else verdict end)) " +
    'else "unknown" end'
  );
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The strings as the pinned jq (jq 1.13.0 for Python) decodes them: a lone low surrogate (U+DC00 to U+DFFF)
 * becomes U+FFFD; a lone high surrogate (U+D800 to U+DBFF) makes jq raise an error, so the runtime's result
 * is not followed here and this throws.
 */
function jqStrings(v) {
  if (typeof v === "string") {
    if (/[\ud800-\udbff](?![\udc00-\udfff])/.test(v)) throw new Error("a lone high surrogate is not followed");
    return v.replace(/(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd");
  }
  if (Array.isArray(v)) return v.map(jqStrings);
  if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [jqStrings(k), jqStrings(x)]));
  return v;
}

/** The twin of `strict`: [value] for a strict JSON text without a duplicate key, else []. */
function strictParse(text) {
  const raw = jqStrings(text);
  const tokens = raw.match(new RegExp(TOKEN, "g")) ?? [];
  if (tokens.join("") !== raw) return [];
  const stack = [];
  let key = null;
  for (const t of tokens) {
    if (new RegExp(SPACE).test(t)) continue;
    if (t === "{") {
      stack.push([]);
      key = null;
    } else if (t === "[") {
      stack.push(null);
      key = null;
    } else if (t === "}" || t === "]") {
      stack.pop();
      key = null;
    } else if (t === ":") {
      if (key === null || stack.length === 0 || !Array.isArray(stack.at(-1))) return [];
      const k = jqStrings(JSON.parse(key));
      if (stack.at(-1).includes(k)) return [];
      stack.at(-1).push(k);
      key = null;
    } else if (t.startsWith('"')) key = t;
    else key = null;
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  return [jqStrings(value)];
}

/** The JavaScript twin of EXPECTED_PROGRAM, for the wrapped value the parse step reads. */
function jqVerdict(wrapped, snapshot) {
  const known = (d) => (d === "approve" || d === "revise" || d === "reject" ? d : "unknown");
  const has = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
  const approvedVerdict = (a) => (a === true ? "approve" : a === false ? "reject" : "unknown");
  const textVerdict = (t, read) => {
    if (typeof t !== "string") return "unknown";
    if (t === "[Approved by operator]") return "approve";
    if (t === "[Rejected by operator]") return "reject";
    const parsed = strictParse(t);
    return parsed.length === 1 ? read(parsed[0]) : "unknown";
  };
  // A decision field counts only when an `approved` or `text` field beside it reads the same verdict.
  const verdict = (x) => {
    if (!isObject(x)) return "unknown";
    if (has(x, "decision")) {
      const d = known(x.decision);
      if (has(x, "approved") && approvedVerdict(x.approved) !== d) return "unknown";
      if (has(x, "text") && textVerdict(x.text, verdict) !== d) return "unknown";
      return d;
    }
    if (sameList(Object.keys(x), ["approved"]) && x.approved === false) return "reject";
    if (sameList(Object.keys(x), ["approved"]) && x.approved === true) return "approve";
    if (sameList(Object.keys(x), snapshot.keys) && x.type === snapshot.type) return "approve";
    return "unknown";
  };
  const top = (v) => (isObject(v) && sameList(Object.keys(v), ["text", "attachments"]) ? textVerdict(v.text, verdict) : verdict(v));
  if (!isObject(wrapped) || !sameList(Object.keys(wrapped), ["answer"])) return "unknown";
  return textVerdict(wrapped.answer, top);
}

/**
 * What the parse step outputs for its text. The runtime's extractor splits the
 * text on three backticks, strips a leading "json" label and repairs each part
 * (json_repair, which tries json.loads first). The trace follows only a text
 * that it reads whole: no code fence, no label, strict JSON. The wrap step
 * writes every text so; any other text throws.
 */
function parseLikeTheStep(node, text) {
  const snapshot = Object.hasOwn(SNAPSHOTS, node.id) ? SNAPSHOTS[node.id] : undefined;
  if (!snapshot) throw new Error(`no snapshot for parse step ${node.id}`);
  const ov = node.output_values ?? {};
  if (!sameList(Object.keys(ov), ["verdict"]) || ov.verdict !== EXPECTED_PROGRAM(snapshot)) {
    throw new Error(`${node.id}: a jq program this trace does not follow`);
  }
  if (node.llm_config !== null || node.retry !== false) throw new Error(`${node.id}: only a parse without a model and without retry is followed`);
  if (!sameList((node.outputs ?? []).map((o) => [o.title, o.default].join("=")), ["verdict="])) {
    throw new Error(`${node.id}: only the one output verdict with the default "" is followed`);
  }
  if (text.includes("```")) throw new Error(`${node.id}: the extractor would split this text on a code fence`);
  if (/^\s*\[?\s*(?:json|JSON)/.test(text)) throw new Error(`${node.id}: the extractor would strip a label from this text`);
  if (strictParse(text).length !== 1) throw new Error(`${node.id}: the extractor would repair this text`);
  return { verdict: jqVerdict(jqStrings(JSON.parse(text)), snapshot) };
}

/**
 * What a template step outputs. The runtime's template step writes one string
 * output, `output`, under the name that the node's output_mapping gives it. The
 * pinned loader refuses a node that declares another output, a second output
 * or none, and the step fails when the declared output is an integer. The
 * trace follows only a node that declares exactly that one output, as a
 * string; any other declaration, and an output_mapping of any key other than
 * `output`, throws.
 */
function renderLikeTheStep(node, variables) {
  const mapping = node.output_mapping ?? {};
  if (Object.keys(mapping).some((k) => k !== "output")) throw new Error(`${node.id}: an output_mapping this trace does not follow`);
  const name = mapping.output ?? "output";
  const declared = (node.outputs ?? []).map((o) => `${o.title}:${o.type}`);
  if (!sameList(declared, [`${name}:string`])) {
    throw new Error(`${node.id} declares the outputs [${declared.join(", ")}]; the runtime's template step writes only ${name}:string`);
  }
  return { [name]: renderTemplate(node.template, variables) };
}

// ---------------------------------------------------------------------------
// The step trace.

const refs = oas.$referenced_components;
const control = oas.control_flow_connections ?? [];
const data = oas.data_flow_connections ?? [];

const START_INPUTS = {
  intent: "find CTOs",
  seedUrls: [],
  targetMemberType: "contact",
  listName: "CTOs",
  cinatra_run_id: "run-1",
};

const CANNED = {
  propose: { seedUrls: ["https://example.test/a"], outputSchema: { type: "object" }, plan: "p" },
  collect: { candidateMembers: [{ name: "A" }], dispatchedRuns: [], failures: [] },
  create: { listId: "L1", memberCount: 1, accountsCreated: 0, contactsCreated: 1, failures: [], summary: "s" },
};

function nextOf(nodeId, branch, controlEdges = control) {
  const edges = controlEdges.filter(
    (e) => e.from_node.$component_ref === nodeId && (branch === undefined ? !e.from_branch || e.from_branch === "next" : e.from_branch === branch),
  );
  if (edges.length !== 1) throw new Error(`${nodeId} has ${edges.length} edges for ${branch ?? "next"}`);
  return edges[0].to_node.$component_ref;
}

function runFlow(answers, flow = oas, canned = CANNED) {
  const flowRefs = flow.$referenced_components;
  const flowControl = flow.control_flow_connections ?? [];
  const flowData = flow.data_flow_connections ?? [];
  const next = (nodeId, branch) => nextOf(nodeId, branch, flowControl);
  const queue = [...answers];
  const produced = new Map(); // nodeId -> { values, at }
  let clock = 0;
  const calls = [];
  const messages = [];

  // The data edges into a step, by name: an edge into an input that the step
  // does not declare throws, and so does an edge from a step that has run that
  // reads an output that step did not write. The output that an edge reads from
  // a step that has not run yet is not checked, nor are the types of an edge's
  // two ends; the pinned loader checks both when it loads the flow.
  function checkEdgesInto(node) {
    const declaredInputs = (node.inputs ?? []).map((i) => i.title);
    for (const e of flowData) {
      if (e.destination_node.$component_ref === node.id && !declaredInputs.includes(e.destination_input)) {
        throw new Error(`${node.id}: the edge ${e.name} writes into ${e.destination_input}, which ${node.id} does not declare as an input`);
      }
    }
    for (const input of node.inputs ?? []) {
      for (const e of flowData) {
        if (e.destination_node.$component_ref !== node.id || e.destination_input !== input.title) continue;
        const source = produced.get(e.source_node.$component_ref);
        if (source && !Object.hasOwn(source.values, e.source_output)) {
          throw new Error(`${node.id}.${input.title}: the edge ${e.name} reads ${e.source_output}, which ${e.source_node.$component_ref} does not write`);
        }
      }
    }
  }

  function inputsOf(node) {
    checkEdgesInto(node);
    const values = {};
    for (const input of node.inputs ?? []) {
      let best = null;
      for (const e of flowData) {
        if (e.destination_node.$component_ref !== node.id || e.destination_input !== input.title) continue;
        const source = produced.get(e.source_node.$component_ref);
        if (source && (!best || source.at > best.at)) {
          best = { at: source.at, value: source.values[e.source_output] };
        }
      }
      if (best) values[input.title] = best.value;
      else if (Object.hasOwn(input, "default")) values[input.title] = input.default;
      else throw new Error(`${node.id}.${input.title} has no value and no default`);
    }
    return values;
  }

  let current = flow.start_node.$component_ref;
  for (let steps = 0; steps < 200; steps += 1) {
    const node = Object.hasOwn(flowRefs, current) ? flowRefs[current] : undefined;
    if (!node) throw new Error(`unknown node ${current}`);
    const record = (values) => {
      const declaredOutputs = node.component_type === "StartNode" && !node.outputs?.length ? node.inputs ?? [] : node.outputs ?? [];
      const declared = declaredOutputs.map((o) => o.title).sort();
      const written = Object.keys(values).sort();
      if (!sameList(written, declared)) {
        throw new Error(`${node.id} writes the outputs [${written.join(", ")}] but declares [${declared.join(", ")}]`);
      }
      produced.set(node.id, { values, at: (clock += 1) });
    };
    switch (node.component_type) {
      case "StartNode": {
        const values = {};
        for (const input of node.inputs) values[input.title] = Object.hasOwn(START_INPUTS, input.title) ? START_INPUTS[input.title] : input.default;
        record(values);
        // After the record, so that an edge from the start into the start is
        // checked against what the start wrote.
        checkEdgesInto(node);
        current = next(node.id);
        break;
      }
      case "ApiNode": {
        const inputs = inputsOf(node);
        calls.push({ step: node.id, inputs });
        if (!Object.hasOwn(canned, node.id)) throw new Error(`no fixed outputs for ${node.id}`);
        record(canned[node.id]);
        current = next(node.id);
        break;
      }
      case "InputMessageNode": {
        inputsOf(node);
        if (queue.length === 0) return { finished: false, pausedAt: node.id, calls, messages };
        record({ userResponse: queue.shift() });
        current = next(node.id);
        break;
      }
      case "PluginExtractNode": {
        const { text } = inputsOf(node);
        record(parseLikeTheStep(node, String(text)));
        current = next(node.id);
        break;
      }
      case "PluginTemplateNode": {
        record(renderLikeTheStep(node, inputsOf(node)));
        current = next(node.id);
        break;
      }
      case "BranchingNode": {
        const inputs = inputsOf(node);
        const keys = Object.keys(inputs);
        if (keys.length !== 1) throw new Error(`${node.id} reads ${keys.length} inputs`);
        const value = String(inputs[keys[0]]);
        const branch = Object.hasOwn(node.mapping ?? {}, value) ? node.mapping[value] : "default";
        record({});
        current = next(node.id, branch);
        break;
      }
      case "OutputMessageNode":
        messages.push({ id: node.id, message: node.message, inputs: inputsOf(node) });
        record({});
        current = next(node.id);
        break;
      case "EndNode":
        inputsOf(node);
        return { finished: queue.length === 0, leftOver: queue.length, calls, messages };
      default:
        throw new Error(`node kind ${node.component_type} is not followed by this trace`);
    }
  }
  throw new Error("the run did not end in 200 steps");
}

// ---------------------------------------------------------------------------

describe("the answers at the reviews drive the run", () => {
  it("has the scenarios", () => {
    expect(scenarios.length).toBeGreaterThan(20);
  });

  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const result = runFlow(scenario.answers);
      expect(result.finished, "the run ends after the given answers").toBe(true);
      const steps = result.calls.map((c) => c.step);
      expect(steps, "the steps that ran").toEqual(scenario.runs);
      expect(result.messages.map((m) => m.id), "the closing step").toEqual([scenario.ends]);
      if (scenario.ends !== "curation_summary") {
        expect(steps, "no CRM list is created").not.toContain("create");
        // The closing text itself, not only the step: the fixture holds the words.
        expect(result.messages[0].message, "the closing text").toBe(scenario.message);
      }
      if (scenario.note) {
        const call = result.calls.filter((c) => c.step === scenario.note.step)[scenario.note.call];
        expect(call, `${scenario.note.step} runs again`).toBeTruthy();
        expect(String(call.inputs[scenario.note.input])).toContain(scenario.note.contains);
      }
    });
  }
});

describe("the step trace reads the template the way the runtime does", () => {
  it("applies whitespace control, set, if, elif, else and filters", () => {
    const t = "{%- set a = x | string | lower | replace(' ', '') -%} {%- if 'ab' in a and n | length > 1 -%} yes {%- elif a == '' -%}empty{%- else -%}no{%- endif -%}";
    expect(renderTemplate(t, { x: "A B", n: ["1", "2"] })).toBe("yes");
    expect(renderTemplate(t, { x: "", n: [] })).toBe("empty");
    expect(renderTemplate(t, { x: "c", n: [] })).toBe("no");
    expect(renderTemplate("{{ (l if 'q' == 'q' else m) | unique(true) | list | length }}", { l: ["a", "a", "b"], m: [] })).toBe("2");
    expect(renderTemplate("{{ s | truncate(3, true, '', 0) }}", { s: "abcdef" })).toBe("abc");
    expect(renderTemplate("{{ x | string }}", { x: null })).toBe("None");
    expect(renderTemplate("{{ '\\u00a0' | length }}", {})).toBe("1");
  });

  it("writes a string with tojson as the runtime's Jinja does", () => {
    // The text that the runtime's jinja2 writes for this input.
    expect(renderTemplate("{{ s | tojson }}", { s: 'a"b\\<>&\'`\u007fé\u{1F600}\n\u0001' })).toBe(
      '"a\\"b\\\\\\u003c\\u003e\\u0026\\u0027`\\u007f\\u00e9\\ud83d\\ude00\\n\\u0001"',
    );
    expect(renderTemplate(refs.list_answer_wrap.template, { answer: "x```y" })).toBe('{"answer": "x\\u0060\\u0060\\u0060y" }');
  });

  it("refuses a constant name as an assignment target", () => {
    for (const name of ["true", "false", "none", "True", "False", "None"]) {
      expect(() => renderTemplate(`{% for ${name} in y %}x{% endfor %}`, { y: [1] })).toThrow();
      expect(() => renderTemplate(`{% set ${name} %}x{% endset %}ok`, {})).toThrow();
      expect(() => renderTemplate(`{% set ${name} = 1 %}ok`, {})).toThrow();
    }
  });

  it("keeps a set inside a block set to that block", () => {
    // The pinned runtime gives "1-a", "1-2" and "12", and refuses d outside its
    // block (checked outside this suite).
    expect(renderTemplate("{% set x = 1 %}{% set c %}{% set x = 2 %}a{% endset %}{{ x | string }}-{{ c | string }}", {})).toBe("1-a");
    expect(renderTemplate("{% set x = 1 %}{% set c %}{% set x = 2 %}{{ x | string }}{% endset %}{{ x | string }}-{{ c | string }}", {})).toBe("1-2");
    expect(renderTemplate("{% set c %}{% for f in y %}{{ f | string }}{% endfor %}{% endset %}{{ c | string }}", { y: [1, 2] })).toBe("12");
    expect(() => renderTemplate("{% set c %}{% set d %}b{% endset %}{{ d | string }}a{% endset %}{{ c | string }}-{{ d | string }}", {})).toThrow();
  });

  it("binds a name in its own map, __proto__ and constructor too", () => {
    // The pinned runtime gives "1-a", "1", "2" and "k", and refuses the last
    // (checked outside this suite).
    expect(renderTemplate("{% set c %}a{% endset %}{{ __proto__ | string }}-{{ c | string }}", JSON.parse('{"__proto__": 1}'))).toBe("1-a");
    expect(renderTemplate("{% for __proto__ in y %}{{ __proto__ | string }}{% endfor %}", { y: [1] })).toBe("1");
    expect(renderTemplate("{% set __proto__ = 2 %}{{ __proto__ | string }}", {})).toBe("2");
    expect(renderTemplate("{% set constructor %}k{% endset %}{{ constructor | string }}", {})).toBe("k");
    expect(() => renderTemplate("{{ constructor | string }}", {})).toThrow();
  });

  it("refuses a tag whose opener and closer do not pair", () => {
    expect(() => renderTemplate("{% for x in y }}{{ x }}{% endfor %}", { y: ["a"] })).toThrow();
    expect(() => renderTemplate("{% if a }}x{% endif %}", { a: true })).toThrow();
    expect(() => renderTemplate("{% set x }}a{% endset %}{{ x | string }}", {})).toThrow();
    expect(() => renderTemplate("{{ a %}", { a: "v" })).toThrow();
    expect(() => renderTemplate("{% if a %}x{% endif }}", { a: true })).toThrow();
  });

  it("refuses a block whose closing statement belongs to another block", () => {
    expect(() => renderTemplate("{% for x in y %}x{% endif %}", { y: [1] })).toThrow();
    expect(() => renderTemplate("{% for x in y %}x{% endset %}", { y: [1] })).toThrow();
    expect(() => renderTemplate("{% if a %}x{% endfor %}", { a: true })).toThrow();
    expect(() => renderTemplate("{% if a %}x{% endset %}", { a: true })).toThrow();
    expect(() => renderTemplate("{% set x %}a{% endif %}{{ x | string }}", {})).toThrow();
    expect(() => renderTemplate("{% set x %}a{% endfor %}{{ x | string }}", {})).toThrow();
  });

  it("refuses a malformed closing tag", () => {
    expect(() => renderTemplate("{% for x in y %}x{% endfor garbage %}", { y: [] })).toThrow();
    expect(() => renderTemplate("{% set x %}a{% endset garbage %}{{ x }}", {})).toThrow();
    expect(() => renderTemplate("{% if a %}x{% endif garbage %}", { a: true })).toThrow();
    expect(() => renderTemplate("{% if a %}x{% else garbage %}y{% endif %}", { a: true })).toThrow();
    expect(() => renderTemplate("{% if a %}x{% elif %}y{% endif %}", { a: true })).toThrow();
    expect(() => renderTemplate("{% for x in y %}x{% endset %}", { y: [] })).toThrow();
    expect(() => renderTemplate("{% set x %}a{% endfor %}{{ x }}", {})).toThrow();
    // The well-formed tags, also with whitespace control, stay followed.
    expect(renderTemplate("{%- for x in y -%}{{ x }}{%- endfor -%}{% set z %}b{%- endset %}{% if a %}{{ z }}{% else %}c{% endif %}", { y: ["a"], a: true })).toBe("ab");
  });

  it("refuses a construct it does not follow", () => {
    expect(() => renderTemplate("{%- for x in y -%}{%- else -%}{%- endfor -%}", { y: [] })).toThrow();
    expect(() => renderTemplate("{% for a, b in y %}{% endfor %}", { y: [] })).toThrow();
    expect(() => renderTemplate("{% for x in y if x %}{% endfor %}", { y: [] })).toThrow();
    expect(() => renderTemplate("{% for x in y %}{% set z = 1 %}{% endfor %}", { y: [1] })).toThrow();
    expect(() => renderTemplate("{% for x in y %}{% endfor %}", { y: null })).toThrow();
    expect(() => renderTemplate("{{ d['k'] }}", { d: {} })).toThrow();
    expect(() => renderTemplate("{{ d[0] }}", { d: ["a"] })).toThrow();
    expect(() => renderTemplate("{% if x is string %}{% endif %}", { x: "a" })).toThrow();
    expect(() => renderTemplate("{{ x | tojson }}", { x: 1 })).toThrow();
    expect(() => renderTemplate("a {#- x #}b", {})).toThrow();
    expect(() => renderTemplate("a {# x -#} b", {})).toThrow();
  });

  it("writes nothing for a comment, also one that holds a print tag", () => {
    expect(renderTemplate("{# hint: {{ x }} #}a {# b #}c", {})).toBe("a c");
  });

  it("refuses comment-looking text inside a print or statement tag", () => {
    // The pinned runtime writes {# x #} for the first (checked outside this suite);
    // the trace does not follow a comment opener inside a tag.
    expect(() => renderTemplate('{{ "{# x #}" }}', {})).toThrow();
    expect(() => renderTemplate("{% if x == '#}' %}a{% endif %}", { x: "" })).toThrow();
  });

  it("reads a loop over a list, a block set, the none and mapping tests and a dict entry", () => {
    const t = "{% set c %}{% for f in xs %}{% if f is mapping and 'k' in f and f['k'] == 'v' %}x{% endif %}{% endfor %}{% endset %}{{ c | length }}";
    expect(renderTemplate(t, { xs: [{ k: "v" }, { k: "w" }, { j: "v" }, "v", 1, { k: "v" }] })).toBe("2");
    expect(renderTemplate("{% if x is none %}N{% elif x is not none %}V{% endif %}", { x: null })).toBe("N");
    expect(renderTemplate("{% if x is none %}N{% elif x is not none %}V{% endif %}", { x: 0 })).toBe("V");
    expect(renderTemplate("{% set f = 1 %}{% for f in xs %}{{ f | string }}{% endfor %}{{ f | string }}", { xs: [2, 3] })).toBe("231");
  });
});

// ---------------------------------------------------------------------------
// The closing message after create (issue 68). Both reviews approve, create
// returns the given outputs, and the text is the closing step's message
// rendered with the inputs that its data edges give it.

describe("the closing message tells what happened after create", () => {
  const closing = (createOutputs) => {
    const result = runFlow(["[Approved by operator]", "[Approved by operator]"], oas, {
      ...CANNED,
      create: { ...CANNED.create, ...createOutputs },
    });
    expect(result.finished, "the run ends after the two approvals").toBe(true);
    expect(result.calls.map((c) => c.step), "the steps that ran").toEqual(["propose", "collect", "create"]);
    expect(result.messages.map((m) => m.id), "the closing step").toEqual(["curation_summary"]);
    return renderTemplate(result.messages[0].message, result.messages[0].inputs);
  };
  const failure = (rowIndex) => ({ rowIndex, stage: "add", error: "The CRM refused the member." });

  it("says that the list was not created and that records made while collecting stay, when no list came back", () => {
    const text = closing({ listId: "", memberCount: 0, failures: [], summary: "The CRM refused the list name." });
    expect(text).toBe(
      "The list was not created. Any accounts and contacts that were created while collecting the candidates stay in your CRM. The CRM refused the list name.",
    );
    expect(text).not.toMatch(/nothing was saved/i);
  });

  const STAY = "The list was not created. Any accounts and contacts that were created while collecting the candidates stay in your CRM.";
  const ONE = "1 entry could not be collected or added; it is listed with the run.";
  const TWO = "2 entries could not be collected or added; they are listed with the run.";

  it("also names the failed entries when no list came back, in the singular for one", () => {
    expect(closing({ listId: "", memberCount: 0, failures: [failure(0)], summary: "s" })).toBe(`${STAY} s ${ONE}`);
    expect(closing({ listId: "", memberCount: 0, failures: [failure(0), failure(1)], summary: "s" })).toBe(`${STAY} s ${TWO}`);
  });

  it("says that nothing came back when the list was created and no entry was added or failed", () => {
    const text = closing({ listId: "L1", memberCount: 0, failures: [], summary: "s" });
    expect(text).toBe("The list was created but no members were added to it - nothing came back from the pages that were searched.");
  });

  it("tells a run whose every entry failed apart from one that found nothing", () => {
    const text = closing({ listId: "L1", memberCount: 0, failures: [failure(0), failure(1)], summary: "s" });
    expect(text).toBe(`The list was created, but no members were added to it: ${TWO}`);
    expect(text).not.toMatch(/nothing came back/i);
  });

  it("names a single failed entry in the singular when the list was created with no member", () => {
    const text = closing({ listId: "L1", memberCount: 0, failures: [failure(0)], summary: "s" });
    expect(text).toBe(`The list was created, but no members were added to it: ${ONE}`);
  });

  it("counts the members added and the entries that failed, in the singular for one", () => {
    expect(closing({ listId: "L1", memberCount: 3, failures: [], summary: "s" })).toBe("3 members were added to the list. s");
    expect(closing({ listId: "L1", memberCount: 3, failures: [failure(3)], summary: "s" })).toBe(`3 members were added to the list. s ${ONE}`);
    expect(closing({ listId: "L1", memberCount: 3, failures: [failure(3), failure(4)], summary: "s" })).toBe(
      `3 members were added to the list. s ${TWO}`,
    );
  });

  // A list that could not be created is no entry: the create step reports it as one failure with the
  // stage crm-list-create and no row (README.md, and the failures declaration of create).
  const listError = { stage: "crm-list-create", error: "CRM rejected list" };
  const NOT_CREATED = "The list could not be created in the CRM; what went wrong is listed with the run.";
  const STAY_ONLY = "Any accounts and contacts that were created while collecting the candidates stay in your CRM.";
  const ALSO = "The run also reported an error while creating the list; it is listed with the run.";

  it("names a list that could not be created as such, and counts no entry for it", () => {
    const text = closing({ listId: "", memberCount: 0, failures: [listError], summary: "Failed to create CRM list — no members were added." });
    expect(text).toBe(`${NOT_CREATED} ${STAY_ONLY} Failed to create CRM list — no members were added.`);
    expect(text).not.toMatch(/entr(y|ies) could not/);
    expect(closing({ listId: "", memberCount: 0, failures: [listError, failure(0)], summary: "s" })).toBe(`${NOT_CREATED} ${STAY_ONLY} s ${ONE}`);
  });

  it("counts the row failures and not the list error when the list came back, and names the list error apart", () => {
    expect(closing({ listId: "L1", memberCount: 0, failures: [listError], summary: "s" })).toBe(
      `The list was created, but no members were added to it. ${ALSO}`,
    );
    expect(closing({ listId: "L1", memberCount: 3, failures: [listError, failure(3)], summary: "s" })).toBe(
      `3 members were added to the list. s ${ONE} ${ALSO}`,
    );
    // An entry without a stage, or one that is not an object, is a row failure.
    expect(closing({ listId: "L1", memberCount: 3, failures: [{ error: "no stage" }, "a string"], summary: "s" })).toBe(
      `3 members were added to the list. s ${TWO}`,
    );
  });

  // A null output is read as unknown, not as a zero or an empty list, and a null summary is not printed.
  const UNKNOWN = "It is not known whether any entry failed.";
  const COUNT_UNKNOWN = "The list was created, but the run did not say how many members were added to it.";

  it("reads a null member count as unknown, not as no members", () => {
    for (const [failures, after] of [[[], ""], [[failure(0)], ` ${ONE}`], [null, ` ${UNKNOWN}`]]) {
      const text = closing({ listId: "L1", memberCount: null, failures, summary: "s" });
      expect(text).toBe(`${COUNT_UNKNOWN} s${after}`);
      expect(text).not.toMatch(/no members|nothing came back/);
    }
  });

  it("reads a null failures list as unknown, not as no failure", () => {
    expect(closing({ listId: "", memberCount: 0, failures: null, summary: "s" })).toBe(`${STAY} s ${UNKNOWN}`);
    const none = closing({ listId: "L1", memberCount: 0, failures: null, summary: "s" });
    expect(none).toBe(`The list was created, but no members were added to it. ${UNKNOWN}`);
    expect(none).not.toMatch(/nothing came back/);
    expect(closing({ listId: "L1", memberCount: 3, failures: null, summary: "s" })).toBe(`3 members were added to the list. s ${UNKNOWN}`);
  });

  it("prints no None for a null summary", () => {
    expect(closing({ listId: "", memberCount: 0, failures: [], summary: null })).toBe(STAY);
    expect(closing({ listId: "L1", memberCount: 3, failures: [], summary: null })).toBe("3 members were added to the list.");
    const text = closing({ listId: "L1", memberCount: null, failures: null, summary: null });
    expect(text).toBe(`${COUNT_UNKNOWN} ${UNKNOWN}`);
    expect(text).not.toMatch(/None/);
  });

  // No list id, and a memberCount that is not null or zero: the message does not
  // say that the list was not created, and says that this is not known. The
  // cases pass null or an empty string; a listId that the response leaves out
  // reaches the template as null through the API step's extraction (read in the
  // runtime, not driven by a test).
  const NO_ID = "No list came back from the run, although it reported that members were added; it is not known whether the list was created.";
  const SUMMARY = "The run searched 4 pages.";

  it("makes no claim about the list's creation when no list id came back and the member count is not null or zero", () => {
    for (const listId of [null, ""]) {
      const text = closing({ listId, memberCount: 3, failures: [], summary: SUMMARY });
      expect(text).toBe(`${NO_ID} ${STAY_ONLY} ${SUMMARY}`);
      expect(text).not.toMatch(/was not created|could not be created|members were added to the list/);
    }
    expect(closing({ listId: null, memberCount: 3, failures: [failure(0)], summary: SUMMARY })).toBe(`${NO_ID} ${STAY_ONLY} ${SUMMARY} ${ONE}`);
    expect(closing({ listId: "", memberCount: 2, failures: [listError], summary: SUMMARY })).toBe(`${NO_ID} ${STAY_ONLY} ${SUMMARY} ${ALSO}`);
    expect(closing({ listId: null, memberCount: 1, failures: null, summary: null })).toBe(`${NO_ID} ${STAY_ONLY} ${UNKNOWN}`);
  });

  it("names a reported list error after a null member count, and counts no entry for it", () => {
    const text = closing({ listId: "L1", memberCount: null, failures: [listError], summary: "s" });
    expect(text).toBe(`${COUNT_UNKNOWN} s ${ALSO}`);
    expect(text).not.toMatch(/entr(y|ies) could not|no members|nothing came back/);
  });

  it("counts the row failures and names a reported list error apart when the list came back with no member", () => {
    const text = closing({ listId: "L1", memberCount: 0, failures: [failure(0), listError, failure(1)], summary: "s" });
    expect(text).toBe(`The list was created, but no members were added to it: ${TWO} ${ALSO}`);
    expect(text).not.toMatch(/nothing came back/);
  });

  it("names a reported list error after the members added, with no row failure", () => {
    const text = closing({ listId: "L1", memberCount: 3, failures: [listError], summary: "s" });
    expect(text).toBe(`3 members were added to the list. s ${ALSO}`);
    expect(text).not.toMatch(/entr(y|ies) could not/);
  });
});

describe("the step trace reads the parse step the way the runtime does", () => {
  const node = refs.list_decision_parse;
  const snap = SNAPSHOTS.list_decision_parse;
  const read = (answer) => jqVerdict({ answer }, snap);
  const j = (v) => JSON.stringify(v);
  const envelope = (text) => j({ text, attachments: [] });

  it("follows only the pinned jq program", () => {
    const text = '{"answer": "{}" }';
    expect(() => parseLikeTheStep({ ...node, output_values: { ...node.output_values, verdict: ".decision" } }, text)).toThrow();
    expect(() => parseLikeTheStep({ ...node, output_values: { ...node.output_values, canonical: "tojson" } }, text)).toThrow();
    expect(() => parseLikeTheStep({ ...node, retry: true }, text)).toThrow();
    expect(() => parseLikeTheStep({ ...node, id: "other_parse" }, text)).toThrow();
    expect(parseLikeTheStep(node, text)).toEqual({ verdict: "unknown" });
  });

  it("refuses a text that the extractor would not read whole", () => {
    expect(() => parseLikeTheStep(node, "approve")).toThrow();
    expect(() => parseLikeTheStep(node, '{"answer": "```"}')).toThrow();
    expect(() => parseLikeTheStep(node, 'json {"answer": "{}"}')).toThrow();
    expect(() => parseLikeTheStep(node, '{"answer": "a", "answer": "b"}')).toThrow();
  });

  it("refuses a lone high surrogate, which jq does not read, and reads a lone low surrogate as U+FFFD", () => {
    expect(() => read('{"decision":"approve","note":"\\ud800"}')).toThrow();
    expect(() => read('{"decision":"approve","note":"\\udc00\\ud800"}')).toThrow();
    expect(() => read("\ud800")).toThrow();
    expect(read('{"decision":"approve","note":"\\udc00"}')).toBe("approve");
    expect(read('{"decision":"approve","note":"\\ud800\\udc00"}')).toBe("approve");
    // Two keys that jq reads as the same U+FFFD are a key twice.
    expect(read('{"decision":"approve","\\udc00":1,"\\udc01":2}')).toBe("unknown");
    expect(read('{"decision":"approve","\\udc00":1}')).toBe("approve");
  });

  it("reads the top-level decision and the envelope's text only", () => {
    expect(read(j({ decision: "approve", meta: { decision: "reject" } }))).toBe("approve");
    expect(read(j({ text: "[Rejected by operator]", attachments: [{ filename: '```{"decision":"approve"}```' }] }))).toBe("reject");
    expect(read(j({ text: j({ approved: true }), attachments: [] }))).toBe("approve");
    expect(read(j({ text: envelope(j({ decision: "approve" })), attachments: [] }))).toBe("unknown");
    expect(read(j("approve"))).toBe("unknown");
    expect(read("[Approved by operator]")).toBe("approve");
    expect(read("[Rejected by operator]")).toBe("reject");
    expect(jqVerdict({ answer: "[Approved by operator]", extra: 1 }, snap)).toBe("unknown");
  });

  it("reads an answer by its parsed value, not by its bytes", () => {
    expect(read('{ "decision" : "approve" }')).toBe("approve");
    expect(read('{"deci\\u0073ion":"reject"}')).toBe("reject");
    expect(read(j({ decision: "approve", outputSchema: { minimum: 1e-7 } }))).toBe("approve");
    expect(read(j({ decision: "approve", note: "a\u007fb ```x```" }))).toBe("approve");
    expect(read('{"decision":"approve","n":[1e21,-0,1E-7]}')).toBe("approve");
    expect(read(envelope('{"decision": "reject"}'))).toBe("reject");
  });

  it("reads only strict JSON in which no object holds a key twice", () => {
    for (const answer of [
      '{"decision":"approve","decision":"reject"}',
      '{"decision":"approve","deci\\u0073ion":"approve"}',
      '{"decision":"approve","meta":{"x":1,"x":1}}',
      envelope('{"decision":"approve","decision":"approve"}'),
      '{"decision":"approve","n":01}',
      '{"decision":"approve","n":1.}',
      '{"decision":"approve","n":NaN}',
      '{"decision":"approve","n":+1}',
      '﻿{"decision":"approve"}',
      '{"decision":"approve",}',
      '{"decision":"approve"} {"decision":"approve"}',
      '{"decision":"approve"} but no',
      '```json\n{"decision":"approve"}\n```',
      "{'decision':'approve'}",
      "",
    ]) {
      expect(read(answer), answer).toBe("unknown");
    }
    expect(read('{"a":{"x":1},"b":{"x":2},"decision":"approve"}')).toBe("approve");
  });

  it("reads an answer whose decision field and approved or text field disagree as unknown", () => {
    expect(read(j({ text: '{"decision":"approve"}', decision: "reject" }))).toBe("unknown");
    expect(read(j({ text: "[Rejected by operator]", attachments: [], decision: "approve" }))).toBe("unknown");
    expect(read(j({ text: "[Approved by operator]", attachments: [], decision: "approve" }))).toBe("approve");
    expect(read(j({ approved: false, decision: "approve" }))).toBe("unknown");
    expect(read(j({ approved: true, decision: "reject" }))).toBe("unknown");
    expect(read(j({ approved: true, decision: "approve" }))).toBe("approve");
    expect(read(j({ approved: false, decision: "reject" }))).toBe("reject");
    // All three signals: the approved field agrees and the text does not.
    expect(read(j({ decision: "approve", approved: true, text: "[Rejected by operator]" }))).toBe("unknown");
    expect(read(envelope(j({ decision: "approve", approved: true, text: "[Rejected by operator]" })))).toBe("unknown");
    expect(read(j({ decision: "approve", approved: true, text: "[Approved by operator]" }))).toBe("approve");
  });
});

describe("the step trace follows the declared outputs of a template step the way the runtime does", () => {
  // The pinned runtime's template step writes one string output, `output`
  // (renamed by the node's output_mapping, if it has one). The loader refuses
  // a node that declares any other output, or none; the step fails when the
  // declared output is not a string; and a data edge that reads an output its
  // source does not write is refused when the flow is loaded.
  const approveBoth = ['{"decision":"approve"}', '{"decision":"approve"}'];
  const withWrap = (change) => {
    const flow = structuredClone(oas);
    const node = flow.$referenced_components.schema_answer_wrap;
    const edge = flow.data_flow_connections.find(
      (e) => e.source_node.$component_ref === "schema_answer_wrap" && e.destination_node.$component_ref === "schema_decision_parse",
    );
    change(node, edge);
    return flow;
  };

  it("follows each template step's one declared string output, also when the node renames it", () => {
    for (const id of ["schema_answer_wrap", "schema_decision", "list_answer_wrap", "list_decision"]) {
      expect(refs[id].outputs, id).toEqual([{ title: "output", type: "string" }]);
    }
    expect(runFlow(approveBoth).calls.map((c) => c.step)).toEqual(["propose", "collect", "create"]);
    const renamed = withWrap((node, edge) => {
      node.output_mapping = { output: "wrapped" };
      node.outputs[0].title = "wrapped";
      edge.source_output = "wrapped";
    });
    expect(runFlow(approveBoth, renamed).calls.map((c) => c.step)).toEqual(["propose", "collect", "create"]);
  });

  it("refuses a template step whose declared outputs are not the one string output the runtime writes", () => {
    const broken = {
      "renamed declaration, edge unchanged": (node) => {
        node.outputs[0].title = "wrapped";
      },
      "a second output": (node) => {
        node.outputs.push({ title: "extra", type: "string" });
      },
      "no output": (node) => {
        node.outputs = [];
      },
      "not a string": (node) => {
        node.outputs[0].type = "integer";
      },
    };
    for (const [name, change] of Object.entries(broken)) {
      expect(() => runFlow(approveBoth, withWrap(change)), name).toThrow(/declares the outputs/);
    }
  });

  it("refuses an output_mapping that renames anything but the step's one output", () => {
    const flow = withWrap((node) => {
      node.output_mapping = { other: "x" };
    });
    expect(() => runFlow(approveBoth, flow)).toThrow(/an output_mapping this trace does not follow/);
  });

  it("refuses a data edge that reads an output its source does not write", () => {
    const flow = withWrap((node, edge) => {
      edge.source_output = "wrapped";
    });
    expect(() => runFlow(approveBoth, flow)).toThrow(/does not write/);
  });

  it("refuses a data edge into the end that reads an output its source does not write", () => {
    const flow = structuredClone(oas);
    const edge = flow.data_flow_connections.find(
      (e) => e.source_node.$component_ref === "collect" && e.destination_node.$component_ref === "end" && e.source_output === "dispatchedRuns",
    );
    edge.source_output = "missingOutput";
    expect(() => runFlow(approveBoth, flow)).toThrow(/does not write/);
  });
});

describe("the step trace tells a step that ran and wrote nothing from one that has not run, and reads only own properties", () => {
  // The pinned loader refuses a data edge that names an output its source does
  // not declare, or an input its destination does not declare. A branching
  // step and an output message step declare no output, so an edge that reads
  // one of them is refused. A name that every JavaScript object inherits, such
  // as toString or constructor, is not an output, an input, a variable, a
  // filter, a step or a parse step of the flow.
  const rejectFirst = ['{"decision":"reject"}'];
  const approveBoth = ['{"decision":"approve"}', '{"decision":"approve"}'];
  const withEdgeToEnd = (source, output) => {
    const flow = structuredClone(oas);
    flow.data_flow_connections.push({
      component_type: "DataFlowEdge",
      name: `${source}_${output}_to_end_dispatchedRuns`,
      source_node: { $component_ref: source },
      source_output: output,
      destination_node: { $component_ref: "end" },
      destination_input: "dispatchedRuns",
    });
    return flow;
  };
  const withEdgeIntoStart = (output, input) => {
    const flow = structuredClone(oas);
    flow.data_flow_connections.push({
      component_type: "DataFlowEdge",
      name: `start_${output}_to_start_${input}`,
      source_node: { $component_ref: "start" },
      source_output: output,
      destination_node: { $component_ref: "start" },
      destination_input: input,
    });
    return flow;
  };
  const renamed = (from, to) => {
    const flow = structuredClone(oas);
    const node = flow.$referenced_components[from];
    delete flow.$referenced_components[from];
    flow.$referenced_components[to] = { ...node, id: to };
    for (const e of flow.control_flow_connections) {
      if (e.from_node.$component_ref === from) e.from_node.$component_ref = to;
      if (e.to_node.$component_ref === from) e.to_node.$component_ref = to;
    }
    for (const e of flow.data_flow_connections) {
      if (e.source_node.$component_ref === from) e.source_node.$component_ref = to;
      if (e.destination_node.$component_ref === from) e.destination_node.$component_ref = to;
    }
    return flow;
  };

  it("runs the flow to the end on a first answer that rejects", () => {
    const result = runFlow(rejectFirst);
    expect(result.finished).toBe(true);
    expect(result.messages.map((m) => m.id)).toEqual(["schema_declined"]);
  });

  it("refuses an edge that reads a name every object inherits from a step that has run", () => {
    expect(() => runFlow(rejectFirst, withEdgeToEnd("schema_answer_wrap", "toString"))).toThrow(
      /reads toString, which schema_answer_wrap does not write/,
    );
  });

  it("refuses an edge from a branching step that has run, which writes nothing", () => {
    expect(() => runFlow(rejectFirst, withEdgeToEnd("schema_branch", "missingOutput"))).toThrow(
      /reads missingOutput, which schema_branch does not write/,
    );
  });

  it("refuses an edge from an output message step that has run, which writes nothing", () => {
    expect(() => runFlow(rejectFirst, withEdgeToEnd("schema_declined", "missingOutput"))).toThrow(
      /reads missingOutput, which schema_declined does not write/,
    );
  });

  it("refuses an edge into an input that its destination does not declare", () => {
    const flow = structuredClone(oas);
    const edge = flow.data_flow_connections.find(
      (e) => e.source_node.$component_ref === "collect" && e.destination_node.$component_ref === "end" && e.source_output === "dispatchedRuns",
    );
    edge.destination_input = "missingInput";
    expect(() => runFlow(approveBoth, flow)).toThrow(/writes into missingInput, which end does not declare as an input/);
  });

  it("refuses a step that writes an output it does not declare", () => {
    const flow = structuredClone(oas);
    const node = flow.$referenced_components.collect;
    node.outputs = node.outputs.filter((o) => o.title !== "failures");
    expect(() => runFlow(approveBoth, flow)).toThrow(/collect writes the outputs \[.*failures.*\] but declares \[/);
  });

  it("takes a start input named like an inherited property from its default", () => {
    const flow = structuredClone(oas);
    flow.$referenced_components.start.inputs.push({ title: "constructor", type: "string", default: "from the default" });
    const edge = flow.data_flow_connections.find((e) => e.source_node.$component_ref === "start" && e.destination_input === "intent");
    edge.source_output = "constructor";
    expect(runFlow(rejectFirst, flow).calls[0].inputs.intent).toBe("from the default");
  });

  it("refuses a control edge to a step that the flow does not have, also when its name is inherited", () => {
    const flow = structuredClone(oas);
    flow.control_flow_connections.find((e) => e.from_node.$component_ref === "start").to_node.$component_ref = "toString";
    expect(() => runFlow(rejectFirst, flow)).toThrow(/unknown node toString/);
  });

  it("refuses an API step without fixed outputs, also when its name is inherited", () => {
    expect(() => runFlow(approveBoth, renamed("create", "constructor"))).toThrow(/no fixed outputs for constructor/);
  });

  it("refuses a parse step without a snapshot, also when its name is inherited", () => {
    expect(() => parseLikeTheStep({ ...refs.schema_decision_parse, id: "constructor" }, "{}")).toThrow(/no snapshot for parse step constructor/);
  });

  it("refuses a filter that the trace does not follow, also when its name is inherited", () => {
    expect(() => renderTemplate("{%- if x | constructor -%}a{%- else -%}b{%- endif -%}", { x: "a" })).toThrow(/filter constructor is not followed/);
  });

  it("refuses a variable that the template is not given, also when its name is inherited", () => {
    expect(() => renderTemplate("{%- if toString -%}a{%- else -%}b{%- endif -%}", {})).toThrow(/toString is not defined/);
  });

  it("refuses a data edge into the start that names an input the start does not declare", () => {
    expect(() => runFlow(rejectFirst, withEdgeIntoStart("listName", "nope"))).toThrow(
      /writes into nope, which start does not declare as an input/,
    );
  });

  it("refuses a data edge into the start that reads an output the start does not write", () => {
    expect(() => runFlow(rejectFirst, withEdgeIntoStart("nope", "listName"))).toThrow(
      /reads nope, which start does not write/,
    );
  });
});
