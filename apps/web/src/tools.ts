export interface Tool {
  id: string;
  name: string;
  description: string;
  tags: string[];
  /** Route the tool will live at. Only used once the tool page exists. */
  path: string;
  /** Monogram shown on the card tile. */
  monogram: string;
  /** Accent color for the card tile. */
  accent: string;
  /** Tools that are not ready yet render with a "Soon" badge. */
  available: boolean;
}

export interface NavItem {
  label: string;
  href: string;
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Blog', href: '/blog' },
  { label: 'API', href: '/api' },
  { label: 'MCP', href: '/mcp' },
  { label: 'Contacts', href: '/contacts' },
];

export const TOOLS: Tool[] = [
  {
    id: 'cidr',
    name: 'IP Subnet Calculator',
    description: 'Network, broadcast, mask and usable hosts from any IPv4 CIDR.',
    tags: ['ip', 'cidr', 'subnet', 'network', 'broadcast', 'mask'],
    path: '/ip',
    monogram: 'IP',
    accent: '#2563eb',
    available: true,
  },
  {
    id: 'dns',
    name: 'DNS Lookup',
    description: 'Query A, AAAA, MX, TXT and other records for any domain.',
    tags: ['dns', 'domain', 'records', 'mx', 'txt'],
    path: '/dns',
    monogram: 'DNS',
    accent: '#7c3aed',
    available: false,
  },
  {
    id: 'ssl',
    name: 'SSL Checker',
    description: 'Inspect certificate chains, expiry dates and issuers.',
    tags: ['ssl', 'tls', 'certificate', 'https', 'expiry'],
    path: '/ssl',
    monogram: 'SSL',
    accent: '#059669',
    available: false,
  },
  {
    id: 'json',
    name: 'JSON Formatter',
    description: 'Format, validate and minify JSON payloads.',
    tags: ['json', 'format', 'validate', 'minify'],
    path: '/json',
    monogram: '{}',
    accent: '#d97706',
    available: false,
  },
  {
    id: 'base64',
    name: 'Base64 Encoder',
    description: 'Encode and decode Base64 strings and files.',
    tags: ['base64', 'encode', 'decode'],
    path: '/base64',
    monogram: 'B64',
    accent: '#db2777',
    available: false,
  },
  {
    id: 'uuid',
    name: 'UUID Generator',
    description: 'Generate v4 and v7 universally unique identifiers.',
    tags: ['uuid', 'guid', 'random', 'identifier'],
    path: '/uuid',
    monogram: 'ID',
    accent: '#0891b2',
    available: false,
  },
  {
    id: 'password',
    name: 'Password Generator',
    description: 'Create strong random passwords with custom rules.',
    tags: ['password', 'random', 'security', 'generator'],
    path: '/password',
    monogram: 'PW',
    accent: '#4d7c0f',
    available: false,
  },
  {
    id: 'headers',
    name: 'HTTP Headers Inspector',
    description: 'Fetch and inspect response headers for any URL.',
    tags: ['http', 'headers', 'response', 'url', 'inspector'],
    path: '/headers',
    monogram: 'H',
    accent: '#57534e',
    available: false,
  },
];
