'use strict';

const URL_PATTERN = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
// Bare domains (no scheme/www) are only treated as links when the TLD is a known one,
// so ordinary words like "notes.txt" are not flagged.
const BARE_DOMAIN_PATTERN = /(?<![@\w.-])((?:[a-z0-9-]+\.)+(?:com|net|org|gg|io|gift|zip|mov|country|kim|cam|gq|ml|tk|cf|work|click|top|xyz|me|co|ly|app|dev|site|online|store|shop|link))(?:\/[^\s<>"']*)?\b/gi;
const INVITE_PATTERN = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[A-Za-z0-9-]+/i;
const SUSPICIOUS_TLDS = new Set(['zip', 'mov', 'country', 'kim', 'cam', 'gq', 'ml', 'tk', 'cf', 'work', 'click', 'top', 'xyz']);
const BRAND_KEYWORDS = ['discord', 'nitro', 'steam', 'paypal', 'binance', 'metamask'];
const TRUSTED_BRAND_DOMAINS = new Set([
  'discord.com', 'discord.gg', 'discordapp.com', 'discord.media', 'steamcommunity.com', 'steampowered.com',
  'paypal.com', 'binance.com', 'metamask.io',
]);
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function extractUrls(text) {
  if (!text) return [];
  const source = String(text);
  const found = [...source.matchAll(URL_PATTERN)].map((m) => m[1]);
  const schemed = new Set(found.map((u) => u.toLowerCase()));
  for (const m of source.matchAll(BARE_DOMAIN_PATTERN)) {
    const candidate = m[0];
    const alreadyCovered = [...schemed].some((u) => u.includes(candidate.toLowerCase()));
    if (!alreadyCovered) found.push(candidate);
  }
  return found.map((u) => u.replace(/[),.;!?]+$/, ''));
}

function hostOf(url) {
  try {
    const withScheme = /^https?:\/\//i.test(url) ? url : `http://${url}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

/** Common second-level suffixes (a small, deliberate subset of the Public Suffix List). */
const TWO_LEVEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'co.in',
  'com.br', 'com.mx', 'co.za', 'com.sg', 'com.tr', 'com.cn', 'com.hk', 'co.kr', 'com.ar', 'co.id',
]);

function registrableDomain(host) {
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  return TWO_LEVEL_SUFFIXES.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

/** True if host is the domain or one of its subdomains. */
function domainMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Heuristic phishing / suspicious-link analysis. This is NOT a malware scanner;
 * it flags patterns commonly used in scams so moderators can review or block them.
 */
function analyzeUrl(url) {
  const host = hostOf(url);
  if (!host) return { host: null, suspicious: true, reasons: ['unparseable_url'] };
  const reasons = [];
  if (IPV4.test(host) || host.startsWith('[')) reasons.push('ip_literal_host');
  if (host.split('.').some((label) => label.startsWith('xn--'))) reasons.push('punycode_host');
  if (host.split('.').length > 5) reasons.push('excessive_subdomains');
  const tld = host.split('.').pop();
  if (SUSPICIOUS_TLDS.has(tld)) reasons.push('suspicious_tld');
  const base = registrableDomain(host);
  if (!TRUSTED_BRAND_DOMAINS.has(base) && BRAND_KEYWORDS.some((k) => host.includes(k))) {
    reasons.push('brand_lookalike');
  }
  return { host, registrable: base, suspicious: reasons.length > 0, reasons };
}

function isInvite(text) {
  return INVITE_PATTERN.test(String(text || ''));
}

module.exports = { extractUrls, hostOf, analyzeUrl, domainMatches, isInvite, registrableDomain, SUSPICIOUS_TLDS };
