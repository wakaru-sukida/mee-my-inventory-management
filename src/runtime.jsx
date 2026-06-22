// src/runtime.jsx
// รันไทม์เล็ก ๆ ที่ทำหน้าที่แทน support.js ของ Claude Design Composer:
//  - DCLogic : base class (= React.Component) + auto-save hook
//  - compile : แปลง AST ของเทมเพลต (จาก scripts/prepare.mjs) เป็น React element โดยอ่านค่าจาก renderVals()
//
// ไวยากรณ์เทมเพลตที่รองรับ: {{ path }}, <sc-if value="{{x}}">, <sc-for list="{{arr}}" as="i">,
// onClick/onInput/onChange="{{fn}}", style="...", style-hover="...", class, readOnly ฯลฯ
import React from 'react';
import ast from './generated/template.json';

/* ---------- helpers ---------- */
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function parseStyle(css) {
  const out = {};
  for (const decl of String(css).split(';')) {
    const idx = decl.indexOf(':');
    if (idx < 0) continue;
    const key = decl.slice(0, idx).trim();
    const val = decl.slice(idx + 1).trim();
    if (!key) continue;
    out[key.startsWith('--') ? key : camel(key)] = val;
  }
  return out;
}

// แยกข้อความ/แอตทริบิวต์ออกเป็นส่วน static และ {{ expr }}
function splitParts(str) {
  const parts = [];
  const re = /\{\{\s*([^}]*?)\s*\}\}/g;
  let last = 0, m;
  while ((m = re.exec(str))) {
    if (m.index > last) parts.push({ lit: str.slice(last, m.index) });
    parts.push({ expr: m[1] });
    last = m.index + m[0].length;
  }
  if (last < str.length) parts.push({ lit: str.slice(last) });
  return parts;
}

function resolveExpr(path, scope) {
  const p = path.trim();
  if (p === 'true') return true;
  if (p === 'false') return false;
  if (p === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(p)) return Number(p);
  const segs = p.split('.');
  let v = scope[segs[0]];
  for (let i = 1; i < segs.length && v != null; i++) v = v[segs[i]];
  return v;
}

// ต่อ parts เป็นสตริง (สำหรับ attr/style/class)
function partsToString(parts, scope) {
  let s = '';
  for (const part of parts) {
    if (part.lit != null) s += part.lit;
    else { const v = resolveExpr(part.expr, scope); s += v == null ? '' : v; }
  }
  return s;
}

const EVENTS = { onclick: 'onClick', oninput: 'onChange', onchange: 'onChange', onsubmit: 'onSubmit' };
const BOOL_ATTRS = new Set(['readonly', 'disabled', 'checked', 'muted', 'autoplay', 'playsinline', 'autofocus', 'required']);
const ATTR_RENAME = { class: 'className', readonly: 'readOnly', autoplay: 'autoPlay', playsinline: 'playsInline', for: 'htmlFor', crossorigin: 'crossOrigin', autocomplete: 'autoComplete', tabindex: 'tabIndex', maxlength: 'maxLength', srcobject: 'srcObject' };

// hover: เก็บกฎ CSS ไว้ฉีดทีหลัง (inline style ชนะ class จึงต้องใส่ !important)
const hoverRules = [];
let hoverSeq = 0;
function hoverClass(css) {
  const cls = 'dch-' + (hoverSeq++);
  const body = String(css).split(';').map((d) => {
    const i = d.indexOf(':'); if (i < 0) return '';
    return d.slice(0, i).trim() + ':' + d.slice(i + 1).trim() + ' !important';
  }).filter(Boolean).join(';');
  hoverRules.push(`.${cls}:hover{${body}}`);
  return cls;
}

function injectHoverStyles() {
  if (typeof document === 'undefined' || !hoverRules.length) return;
  if (document.getElementById('dc-hover-styles')) return;
  const el = document.createElement('style');
  el.id = 'dc-hover-styles';
  el.textContent = hoverRules.join('\n');
  document.head.appendChild(el);
}

/* ---------- compiler: AST node -> render function (scope) => ReactNode ---------- */
let keySeq = 0;

function compileChildren(nodes) {
  const compiled = nodes.map(compileNode).filter(Boolean);
  return (scope) => {
    const out = [];
    for (const fn of compiled) {
      const r = fn(scope);
      if (Array.isArray(r)) out.push(...r);
      else if (r != null && r !== false) out.push(r);
    }
    return out;
  };
}

function compileNode(node) {
  if (node.text != null) {
    const parts = splitParts(node.text);
    if (parts.length === 1 && parts[0].lit != null) return () => parts[0].lit;
    return (scope) => {
      const out = [];
      for (const part of parts) {
        if (part.lit != null) { out.push(part.lit); continue; }
        const v = resolveExpr(part.expr, scope);
        if (v == null) continue;
        if (Array.isArray(v)) out.push(...v);
        else out.push(v); // React element หรือ string/number
      }
      return out;
    };
  }

  const tag = node.tag;

  if (tag === 'sc-if') {
    const cond = splitParts(node.attrs.value || '')[0];
    const inner = compileChildren(node.children);
    return (scope) => {
      const v = cond && cond.expr != null ? resolveExpr(cond.expr, scope) : cond && cond.lit;
      return v ? inner(scope) : null;
    };
  }

  if (tag === 'sc-for') {
    const listExpr = splitParts(node.attrs.list || '')[0];
    const asName = node.attrs.as || 'item';
    const inner = compileChildren(node.children);
    const myKey = 'f' + (keySeq++);
    return (scope) => {
      const list = listExpr && listExpr.expr != null ? resolveExpr(listExpr.expr, scope) : [];
      if (!Array.isArray(list)) return [];
      return list.map((item, i) =>
        React.createElement(React.Fragment, { key: myKey + '_' + i }, ...inner({ ...scope, [asName]: item }))
      );
    };
  }

  // องค์ประกอบทั่วไป
  const childFn = compileChildren(node.children);
  const staticProps = {};
  const dynProps = []; // {name, parts} | {name, expr, kind}
  let hoverCls = null;

  for (const [rawName, rawVal] of Object.entries(node.attrs)) {
    const lower = rawName.toLowerCase();
    if (lower === 'hint-placeholder-val' || lower === 'hint-placeholder-count' || lower === 'as' || lower === 'list') continue;
    if (lower === 'style-hover') { hoverCls = hoverClass(rawVal); continue; }

    const isExpr = typeof rawVal === 'string' && rawVal.includes('{{');

    if (EVENTS[lower]) {
      const single = splitParts(rawVal)[0];
      dynProps.push({ name: EVENTS[lower], kind: 'fn', expr: single && single.expr });
      continue;
    }
    if (lower === 'style') {
      if (isExpr) dynProps.push({ name: 'style', kind: 'style', parts: splitParts(rawVal) });
      else staticProps.style = parseStyle(rawVal);
      continue;
    }
    if (BOOL_ATTRS.has(lower)) {
      const target = ATTR_RENAME[lower] || lower;
      if (rawVal === true) { staticProps[target] = true; }
      else if (isExpr) dynProps.push({ name: target, kind: 'bool', parts: splitParts(rawVal) });
      else staticProps[target] = rawVal !== 'false';
      continue;
    }
    const target = ATTR_RENAME[lower] || (rawName.includes('-') && !/^(data|aria)-/.test(lower) ? camel(rawName) : rawName);
    if (rawVal === true) { staticProps[target] = true; continue; }
    if (isExpr) dynProps.push({ name: target, kind: 'str', parts: splitParts(rawVal) });
    else staticProps[target] = rawVal;
  }

  return (scope) => {
    const props = { ...staticProps };
    for (const dp of dynProps) {
      if (dp.kind === 'fn') props[dp.name] = dp.expr ? resolveExpr(dp.expr, scope) : undefined;
      else if (dp.kind === 'style') props.style = parseStyle(partsToString(dp.parts, scope));
      else if (dp.kind === 'bool') {
        const single = dp.parts.length === 1 && dp.parts[0].expr != null ? resolveExpr(dp.parts[0].expr, scope) : partsToString(dp.parts, scope);
        props[dp.name] = !!single && single !== 'false';
      } else {
        // single expr -> เก็บค่าจริง (อาจเป็น string/number), หลายส่วน -> ต่อเป็น string
        if (dp.parts.length === 1 && dp.parts[0].expr != null) {
          const v = resolveExpr(dp.parts[0].expr, scope);
          props[dp.name] = v == null ? '' : v;
        } else props[dp.name] = partsToString(dp.parts, scope);
      }
    }
    if (hoverCls) props.className = (props.className ? props.className + ' ' : '') + hoverCls;
    return React.createElement(tag, props, ...childFn(scope));
  };
}

// คอมไพล์เทมเพลตครั้งเดียวตอนโหลดโมดูล
const compiledRoot = compileChildren(ast);

/* ---------- DCLogic base ---------- */
let saveHook = null;
export function setSaveHook(fn) { saveHook = fn; }

export class DCLogic extends React.Component {
  setState(updater, cb) {
    super.setState(updater, cb);
    if (!this._suppressSave && saveHook) saveHook(this);
  }
  forceUpdate(cb) {
    super.forceUpdate(cb);
    if (!this._suppressSave && saveHook) saveHook(this);
  }
  render() {
    const scope = this.renderVals();
    return React.createElement(React.Fragment, null, ...compiledRoot(scope));
  }
}

export { injectHoverStyles };
