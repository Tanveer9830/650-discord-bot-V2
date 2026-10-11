'use strict';

const { extractUrls, analyzeUrl, domainMatches, hostOf, isInvite } = require('./links');

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Normalise text for word matching: lowercase, strip zero-width characters, fold common leetspeak. */
function normaliseForWords(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[0@]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/7/g, 't')
    .replace(/\$/g, 's')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ');
}

function containsBlockedWord(text, words) {
  const normal = normaliseForWords(text);
  for (const word of words) {
    const w = normaliseForWords(word).trim();
    if (!w) continue;
    const re = new RegExp(`(^|\\s)${escapeRegExp(w)}(?=\\s|$)`, 'u');
    if (re.test(normal)) return word;
  }
  return null;
}

/** Sliding-window per-user message counter for anti-spam. */
function createSpamTracker() {
  const windows = new Map();
  return {
    record(key, nowMs, windowMs) {
      const list = (windows.get(key) || []).filter((t) => nowMs - t < windowMs);
      list.push(nowMs);
      windows.set(key, list);
      if (windows.size > 20000) {
        for (const [k, arr] of windows) if (!arr.length || nowMs - arr[arr.length - 1] >= windowMs) windows.delete(k);
      }
      return list.length;
    },
    reset(key) {
      windows.delete(key);
    },
  };
}

/**
 * Pure evaluation of one message against a guild's automod configuration.
 * Returns { rule, reason } for the first violated rule, or null.
 * Exempt authors (security exemptions / trusted integrations) are checked by the caller.
 */
function evaluateMessage({ content = '', settings, words = [], blockedDomains = [], spam = null }) {
  if (!settings || !settings.enabled) return null;

  if (settings.word_filter) {
    const hit = containsBlockedWord(content, words);
    if (hit) return { rule: 'word_filter', reason: 'Blocked word' };
  }

  if (settings.block_invites && isInvite(content)) {
    return { rule: 'invite', reason: 'Server invite link' };
  }

  const urls = extractUrls(content);
  if (urls.length) {
    for (const url of urls) {
      const host = hostOf(url);
      if (!host) continue;
      if (blockedDomains.some((d) => domainMatches(host, d))) {
        return { rule: 'blocked_domain', reason: 'Blocked domain' };
      }
    }
    if (settings.block_links) return { rule: 'link', reason: 'Links are not allowed here' };
    for (const url of urls) {
      const verdict = analyzeUrl(url);
      if (verdict.suspicious) {
        return { rule: 'phishing', reason: `Suspicious link (${verdict.reasons.join(', ')})` };
      }
    }
  }

  if (settings.anti_spam && spam) {
    if (spam.count > settings.spam_max_messages) {
      return { rule: 'spam', reason: 'Message flood detected' };
    }
  }
  return null;
}

module.exports = { evaluateMessage, containsBlockedWord, normaliseForWords, createSpamTracker };
