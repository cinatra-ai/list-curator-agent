// The answers at the two reviews drive the run (issue 65): these tests run the
// flow of cinatra/oas.json step by step and record which model-bridge steps
// start, for every answer in tests/fixtures/gate-answer-scenarios.json.
//
// The step trace below follows the pinned runtime's rules for the node kinds
// this flow uses, and refuses any other kind or construct, so that a change it
// cannot follow fails here instead of passing:
//   - an ApiNode is recorded with its inputs and returns fixed outputs; no
//     request is sent;
//   - an InputMessageNode takes the next answer as its `userResponse`;
//   - a PluginRegexNode returns every match of its pattern (the value of the
//     one group), without the empty ones, like Python's re.findall;
//   - a PluginTemplateNode renders its Jinja template (the subset below);
//   - a BranchingNode follows the branch that its mapping names for the value,
//     else "default";
//   - an input takes the newest value of a data edge into it, else its default.
//
// The same scenarios were run through the pinned runtime (wayflowcore 26.1.2)
// with a stub bridge; the step lists matched these expectations.
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
// A Jinja subset: {%- set / if / elif / else / endif -%}, text, and the
// expressions and filters the decision steps use. Anything else throws.

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
};

function evaluate(node, scope) {
  switch (node.k) {
    case "lit":
      return node.v;
    case "var":
      if (!(node.name in scope)) throw new Error(`${node.name} is not defined`);
      return scope[node.name];
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
    case "filter": {
      const fn = FILTERS[node.name];
      if (!fn) throw new Error(`filter ${node.name} is not followed`);
      return fn(evaluate(node.value, scope), ...node.args.map((a) => evaluate(a, scope)));
    }
    default:
      throw new Error(`node ${node.k} is not followed`);
  }
}

function renderTemplate(template, variables) {
  // Split into text and tags, applying the "-" whitespace control.
  const parts = [];
  const re = /(\{%-?|\{\{-?)([\s\S]*?)(-?%\}|-?\}\})/g;
  let last = 0;
  let m;
  while ((m = re.exec(template)) !== null) {
    parts.push({ kind: "text", value: template.slice(last, m.index) });
    parts.push({
      kind: m[1].startsWith("{%") ? "stmt" : "print",
      body: m[2].trim(),
      trimBefore: m[1].endsWith("-"),
      trimAfter: m[3].startsWith("-"),
    });
    last = re.lastIndex;
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
  let pos = 0;
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
      if (stops.includes(word)) return body;
      pos += 1;
      if (word === "set") {
        const sm = /^set\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/.exec(part.body);
        if (!sm) throw new Error(`set not followed: ${part.body}`);
        body.push({ k: "set", name: sm[1], expr: parseExpression(sm[2]) });
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

  const scope = { ...variables };
  let out = "";
  function run(body) {
    for (const st of body) {
      if (st.k === "text") out += st.v;
      else if (st.k === "print") out += pyStr(evaluate(st.expr, scope));
      else if (st.k === "set") scope[st.name] = evaluate(st.expr, scope);
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
// Python re.findall for the patterns the flow uses.

function findall(pattern, text) {
  if (/\(\?P|\(\?[aiLmsux]|\\[AZ]/.test(pattern)) throw new Error(`pattern ${pattern} uses a construct this trace does not follow`);
  const re = new RegExp(pattern, "g");
  const groups = new RegExp(`${pattern}|`).exec("").length - 1;
  if (groups > 1) throw new Error("findall with more than one group is not followed");
  const found = [];
  for (const m of text.matchAll(re)) found.push(groups === 1 ? (m[1] ?? "") : m[0]);
  return found.filter((v) => v !== "");
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

function nextOf(nodeId, branch) {
  const edges = control.filter(
    (e) => e.from_node.$component_ref === nodeId && (branch === undefined ? !e.from_branch || e.from_branch === "next" : e.from_branch === branch),
  );
  if (edges.length !== 1) throw new Error(`${nodeId} has ${edges.length} edges for ${branch ?? "next"}`);
  return edges[0].to_node.$component_ref;
}

function runFlow(answers) {
  const queue = [...answers];
  const produced = new Map(); // nodeId -> { values, at }
  let clock = 0;
  const calls = [];
  const messages = [];

  function inputsOf(node) {
    const values = {};
    for (const input of node.inputs ?? []) {
      let best = null;
      for (const e of data) {
        if (e.destination_node.$component_ref !== node.id || e.destination_input !== input.title) continue;
        const source = produced.get(e.source_node.$component_ref);
        if (source && e.source_output in source.values && (!best || source.at > best.at)) {
          best = { at: source.at, value: source.values[e.source_output] };
        }
      }
      if (best) values[input.title] = best.value;
      else if ("default" in input) values[input.title] = input.default;
      else throw new Error(`${node.id}.${input.title} has no value and no default`);
    }
    return values;
  }

  let current = oas.start_node.$component_ref;
  for (let steps = 0; steps < 200; steps += 1) {
    const node = refs[current];
    if (!node) throw new Error(`unknown node ${current}`);
    const record = (values) => produced.set(node.id, { values, at: (clock += 1) });
    switch (node.component_type) {
      case "StartNode": {
        const values = {};
        for (const input of node.inputs) values[input.title] = input.title in START_INPUTS ? START_INPUTS[input.title] : input.default;
        record(values);
        current = nextOf(node.id);
        break;
      }
      case "ApiNode": {
        const inputs = inputsOf(node);
        calls.push({ step: node.id, inputs });
        if (!CANNED[node.id]) throw new Error(`no fixed outputs for ${node.id}`);
        record(CANNED[node.id]);
        current = nextOf(node.id);
        break;
      }
      case "InputMessageNode": {
        inputsOf(node);
        if (queue.length === 0) return { finished: false, pausedAt: node.id, calls, messages };
        record({ userResponse: queue.shift() });
        current = nextOf(node.id);
        break;
      }
      case "PluginRegexNode": {
        if (node.return_first_match_only !== false) throw new Error(`${node.id}: only return_first_match_only false is followed`);
        const { text } = inputsOf(node);
        record({ output: findall(node.regex_pattern, String(text)) });
        current = nextOf(node.id);
        break;
      }
      case "PluginTemplateNode": {
        record({ output: renderTemplate(node.template, inputsOf(node)) });
        current = nextOf(node.id);
        break;
      }
      case "BranchingNode": {
        const inputs = inputsOf(node);
        const keys = Object.keys(inputs);
        if (keys.length !== 1) throw new Error(`${node.id} reads ${keys.length} inputs`);
        const value = String(inputs[keys[0]]);
        const branch = Object.prototype.hasOwnProperty.call(node.mapping ?? {}, value) ? node.mapping[value] : "default";
        current = nextOf(node.id, branch);
        break;
      }
      case "OutputMessageNode":
        inputsOf(node);
        messages.push({ id: node.id, message: node.message });
        current = nextOf(node.id);
        break;
      case "EndNode":
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
      if (!scenario.runs.includes("create")) {
        expect(steps, "no CRM list is created").not.toContain("create");
        expect(result.messages.map((m) => m.id), "the run ends with a closing message").toEqual([
          scenario.runs.includes("collect") ? "list_declined" : "schema_declined",
        ]);
      } else {
        expect(result.messages.map((m) => m.id)).toEqual(["curation_summary"]);
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

  it("refuses a construct it does not follow", () => {
    expect(() => renderTemplate("{%- for x in y -%}{%- endfor -%}", { y: [] })).toThrow();
    expect(() => renderTemplate("{{ x | tojson }}", { x: 1 })).toThrow();
    expect(() => findall("(?P<d>a)", "a")).toThrow();
  });

  it("finds the matches like re.findall", () => {
    expect(findall('"d":"([^"]*)"', '{"d":"x","e":{"d":"y"},"f":{"d":""}}')).toEqual(["x", "y"]);
  });
});
