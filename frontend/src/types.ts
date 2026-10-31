export type Page = 'overview' | 'investigate' | 'history' | 'graph'
export interface DnsRecord { type: string; value: string }
export interface GraphNode { id: string; label: string; type: string }
export interface GraphEdge { source: string; target: string; type: string }
export interface HistoryItem {
  id: number
  target: string
  kind: string
  scanned_at: string
  summary: Summary
}
export interface Summary { dns_records: number; ips: number; subdomains: number; nodes: number; http_status?: number | null }
export interface Result extends HistoryItem {
  authorized_probe: boolean
  ct_enabled: boolean
  dns: DnsRecord[]
  ip_addresses: string[]
  rdap: {
    handle?: string; name?: string; status?: string[];
    start_address?: string; end_address?: string;
    events?: { action: string; date: string }[]; source?: string
  }
  subdomains: string[]
  tls: { validated?: boolean; common_name?: string; issuer?: string; expires?: string; protocol?: string; san?: string[]; error?: string }
  http: { url?: string; status?: number; headers?: Record<string, string>; scheme?: string; error?: string }
  graph: { nodes: GraphNode[]; edges: GraphEdge[] }
  security: { level: string; title: string; detail: string }[]
  notes: string[]
}
export interface Stats {
  total_analyses: number
  unique_targets: number
  domain_analyses: number
  ip_analyses: number
  recent: { id: number; target: string; kind: string; scanned_at: string }[]
  daily: { day: string; count: number }[]
  updated_at: string
}
