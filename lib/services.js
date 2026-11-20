// Services the planner can pick from. Those marked `guide: true` have steps in
// Cairn's guide library, kept current by the monthly job and approved by hand.
// The others are well known but rely on the planner's own steps for now; when a
// guide is added to the library later, existing entries pick it up by key.
export const POPULAR_SERVICES = [
  { key: 'apple', name: 'Apple', hint: 'Apple ID, iCloud, Apple Music, App Store', guide: true },
  { key: 'google', name: 'Google', hint: 'Gmail, Google Photos, YouTube, Drive', guide: true },
  { key: 'netflix', name: 'Netflix', hint: 'Streaming', guide: true },
  { key: 'spotify', name: 'Spotify', hint: 'Music and podcasts', guide: true },
  { key: 'amazon', name: 'Amazon', hint: 'Shopping, Prime Video, Kindle, Alexa' },
  { key: 'microsoft', name: 'Microsoft', hint: 'Outlook, OneDrive, Xbox, Office' },
  { key: 'disney', name: 'Disney+', hint: 'Streaming' },
  { key: 'facebook', name: 'Facebook', hint: 'Social media' },
  { key: 'instagram', name: 'Instagram', hint: 'Social media' },
  { key: 'dropbox', name: 'Dropbox', hint: 'File storage' },
];

// Starting points for things only the household knows about.
export const CUSTOM_IDEAS = [
  { name: 'Home Wi-Fi router', note: '' },
  { name: 'Garage door opener', note: '' },
  { name: 'Home alarm system', note: '' },
  { name: 'Phone and broadband provider', note: '' },
  { name: 'Electricity or gas account', note: '' },
];

export const ACTIONS = {
  keep: { label: 'Keep it going', short: 'Keep' },
  transfer: { label: 'Transfer it to someone', short: 'Transfer' },
  close: { label: 'Close it', short: 'Close' },
};

export function findService(key) {
  return POPULAR_SERVICES.find((s) => s.key === key) || null;
}

// Gentle guard rail: Cairn is not for money. We cannot see what people type,
// so this check runs in the browser, on the name and the secret.
const FINANCIAL_WORDS = [
  'bank', 'banking', 'credit union', 'credit card', 'mortgage', 'savings', 'checking account',
  'paypal', 'venmo', 'zelle', 'cash app', 'wise', 'revolut', 'monzo', 'starling',
  'wallet', 'crypto', 'bitcoin', 'ethereum', 'coinbase', 'binance', 'kraken', 'metamask', 'ledger', 'trezor',
  'seed phrase', 'vanguard', 'fidelity', 'schwab', 'robinhood', 'etrade', 'e*trade', 'brokerage',
  'investment', 'pension', '401k', '401(k)', 'ira', 'isa', 'stocks', 'shares',
];

export function looksFinancial(name, secret) {
  const n = ` ${String(name || '').toLowerCase()} `;
  const hit = FINANCIAL_WORDS.some((w) =>
    new RegExp(`(^|[^a-z])${w.replace(/[()*]/g, '\\$&')}([^a-z]|$)`).test(n)
  );
  // 12 or 24 plain lowercase words is the shape of a crypto wallet recovery phrase.
  const words = String(secret || '').trim().split(/\s+/);
  const seedPhrase = (words.length === 12 || words.length === 24) && words.every((w) => /^[a-z]{3,8}$/.test(w));
  return hit || seedPhrase;
}
