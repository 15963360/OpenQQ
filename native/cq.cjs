'use strict';

// OneBot v11 CQ code: [CQ:type,key=value,...] inside a string, with &amp; &#91; &#93; (and &#44; in values) escaped.
const code = /\[CQ:([A-Za-z0-9_-]+)((?:,[A-Za-z0-9_.-]+=[^,\]]*)*)\]/g;

const unescapeText = value => value.replaceAll('&#91;', '[').replaceAll('&#93;', ']').replaceAll('&amp;', '&');
const unescapeValue = value => unescapeText(value.replaceAll('&#44;', ','));
const escapeText = value => String(value).replaceAll('&', '&amp;').replaceAll('[', '&#91;').replaceAll(']', '&#93;');
const escapeValue = value => escapeText(value).replaceAll(',', '&#44;');

// Anything that is not a well-formed code stays literal text, as go-cqhttp does.
function parseCQ(input) {
  if (typeof input !== 'string') throw new TypeError('CQ 解析需要字符串');
  const segments = [];
  let last = 0;
  const pushText = text => { if (text) segments.push({ type: 'text', data: { text: unescapeText(text) } }); };
  for (const match of input.matchAll(code)) {
    pushText(input.slice(last, match.index));
    const data = {};
    for (const pair of match[2].split(',').slice(1)) {
      const at = pair.indexOf('=');
      data[pair.slice(0, at)] = unescapeValue(pair.slice(at + 1));
    }
    segments.push({ type: match[1], data });
    last = match.index + match[0].length;
  }
  pushText(input.slice(last));
  return segments;
}

module.exports = { parseCQ, escapeText, escapeValue };
