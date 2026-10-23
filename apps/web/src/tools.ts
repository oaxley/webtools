export type ToolCategory = 'network' | 'security' | 'identifiers' | 'data';

export const CATEGORIES: { id: ToolCategory; label: string; blurb: string }[] = [
  { id: 'network', label: 'Network', blurb: 'Subnets, DNS and HTTP.' },
  { id: 'security', label: 'Security', blurb: 'Tokens, certificates and secrets.' },
  { id: 'identifiers', label: 'Identifiers', blurb: 'Unique IDs for databases and URLs.' },
  { id: 'data', label: 'Data', blurb: 'Encode, format and validate payloads.' },
];

export interface Tool {
  id: string;
  category: ToolCategory;
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
  /** Matching REST endpoint (relative to the API origin), if any. */
  api?: { method: 'GET' | 'POST'; path: string };
  /** Matching MCP tool name, if any. */
  mcp?: string;
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
    category: 'network',
    name: 'IP Subnet Calculator',
    description: 'Network, broadcast, mask and usable hosts from any IPv4 CIDR.',
    tags: ['ip', 'cidr', 'subnet', 'network', 'broadcast', 'mask'],
    path: '/ip',
    monogram: 'IP',
    accent: '#2563eb',
    available: true,
    api: { method: 'GET', path: '/api/v1/ip' },
    mcp: 'calculate_cidr',
  },
  {
    id: 'jwt',
    category: 'security',
    name: 'JWT Decoder',
    description: 'Decode and inspect a JSON Web Token.',
    tags: ['jwt', 'token', 'decode', 'jwt.io', 'oauth', 'oidc'],
    path: '/jwt',
    monogram: 'JWT',
    accent: '#7c3aed',
    available: true,
    api: { method: 'POST', path: '/api/v1/jwt' },
    mcp: 'decode_jwt',
  },
  {
    id: 'dns',
    category: 'network',
    name: 'DNS Lookup',
    description: 'Query A, AAAA, MX, TXT and other records for any domain.',
    tags: ['dns', 'domain', 'records', 'mx', 'txt'],
    path: '/dns',
    monogram: 'DNS',
    accent: '#7c3aed',
    available: false,
  },
  {
    id: 'x509',
    category: 'security',
    name: 'X.509 Certificate Decoder',
    description:
      'Decode and inspect PEM or DER-encoded X.509 certificates.',
    tags: [
      'x509',
      'ssl',
      'tls',
      'certificate',
      'pem',
      'der',
      'pki',
      'https',
    ],
    path: '/x509',
    monogram: 'X509',
    accent: '#059669',
    available: true,
    api: { method: 'POST', path: '/api/v1/x509' },
    mcp: 'decode_x509',
  },
  {
    id: 'json',
    category: 'data',
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
    category: 'data',
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
    category: 'identifiers',
    name: 'UUID Generator',
    description: 'Generate v4 and v7 universally unique identifiers.',
    tags: ['uuid', 'guid', 'random', 'identifier', 'v4', 'v7'],
    path: '/uuid',
    monogram: 'ID',
    accent: '#0891b2',
    available: true,
    api: { method: 'GET', path: '/api/v1/uuid' },
    mcp: 'generate_uuid',
  },
  {
    id: 'nanoid',
    category: 'identifiers',
    name: 'NanoID Generator',
    description: 'Generate compact, URL-friendly random identifiers.',
    tags: ['nanoid', 'id', 'random', 'url-safe', 'identifier', 'short'],
    path: '/nanoid',
    monogram: 'NID',
    accent: '#0d9488',
    available: true,
    api: { method: 'GET', path: '/api/v1/nanoid' },
    mcp: 'generate_nanoid',
  },
  {
    id: 'ulid',
    category: 'identifiers',
    name: 'ULID Generator',
    description: 'Generate sortable, 26-character IDs that start with a timestamp.',
    tags: ['ulid', 'id', 'sortable', 'time-ordered', 'identifier', 'crockford', 'base32'],
    path: '/ulid',
    monogram: 'UL',
    accent: '#0369a1',
    available: true,
    api: { method: 'GET', path: '/api/v1/ulid' },
    mcp: 'generate_ulid',
  },
  {
    id: 'password',
    category: 'security',
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
    category: 'network',
    name: 'HTTP Headers Inspector',
    description: 'Fetch and inspect response headers for any URL.',
    tags: ['http', 'headers', 'response', 'url', 'inspector'],
    path: '/headers',
    monogram: 'H',
    accent: '#57534e',
    available: false,
  },
];

/** Look up a tool by id; throws on typos so they surface in development. */
export function findTool(id: string): Tool {
  const tool = TOOLS.find((t) => t.id === id);
  if (!tool) throw new Error(`Unknown tool id '${id}'`);
  return tool;
}
