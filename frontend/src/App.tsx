import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  Activity, ArrowDownToLine, ArrowLeft, ArrowRight, BarChart3, Box, Check, ChevronDown,
  CircleHelp, Clock3, Database, Fingerprint, Globe2, HardDrive, Info, Layers3, LockKeyhole,
  Network, PanelLeftClose, Radar, RefreshCw, Search, Server, Settings2, ShieldCheck,
  ShieldAlert, TerminalSquare, Waypoints, X, Zap
} from 'lucide-react'
import type { DnsRecord, GraphNode, HistoryItem, Page, Result, Stats } from './types'

const API = '/api'
const MENU: { page: Page; label: string; icon: typeof Radar }[] = [
  { page: 'overview', label: 'Обзор', icon: BarChart3 },
  { page: 'investigate', label: 'Поиск активов', icon: Radar },
  { page: 'history', label: 'История запросов', icon: Database },
  { page: 'graph', label: 'Граф связей', icon: Waypoints },
]
const emptyStats: Stats = { total_analyses: 0, unique_targets: 0, domain_analyses: 0, ip_analyses: 0, recent: [], daily: [], updated_at: '' }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try { response = await fetch(path, init) }
  catch { throw new Error('Не получается подключиться к серверу API. Проверь, что backend запущен на порту 8000.') }
  if (!response.ok) {
    let detail = `Ошибка ${response.status}`
    try { const json = await response.json(); detail = typeof json.detail === 'string' ? json.detail : detail } catch { /* ignore */ }
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

function formatDate(iso?: string) {
  if (!iso) return '—'
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function saveText(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click()
  URL.revokeObjectURL(url)
}

function quoteCSV(text: unknown) { return '"' + String(text ?? '').replaceAll('"', '""') + '"' }
function exportResult(result: Result, kind: 'json' | 'csv') {
  const name = `${result.target.replace(/[^a-zA-Z0-9.-]/g, '_')}-${result.id}`
  if (kind === 'json') saveText(`${name}.json`, JSON.stringify(result, null, 2), 'application/json;charset=utf-8')
  else {
    const rows = [['record_type', 'value'], ...result.dns.map(r => [r.type, r.value])]
    saveText(`${name}-dns.csv`, '\uFEFF' + rows.map(row => row.map(quoteCSV).join(',')).join('\r\n'), 'text/csv;charset=utf-8')
  }
}

function IconTag({ children }: { children: ReactNode }) { return <span className="icon-tag">{children}</span> }
function StatusDot({ online }: { online: boolean }) { return <span className={`status-dot ${online ? 'online' : 'offline'}`} /> }

function NetworkGraph({ nodes, edges }: { nodes: GraphNode[]; edges: Result['graph']['edges'] }) {
  const [selected, setSelected] = useState<string | null>(null)
  const visibleNodes = nodes.slice(0, 18)
  const positions = useMemo(() => {
    const output: Record<string, { x: number; y: number }> = {}
    visibleNodes.forEach((node, i) => {
      const theta = (i - 1) * 2 * Math.PI / Math.max(1, visibleNodes.length - 1) - Math.PI / 2
      output[node.id] = i === 0 ? { x: 390, y: 190 } : { x: 390 + 245 * Math.cos(theta), y: 190 + 143 * Math.sin(theta) }
    })
    return output
    // Stable by node identities, not array reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.map(node => node.id).join('|')])
  if (!visibleNodes.length) return <EmptyState title="Граф пока пуст" subtitle="Выполни анализ домена, чтобы увидеть связи." />
  return (
    <div className="graph-wrap">
      <div className="graph-legend"><span><i className="legend-dot purple" />Цель</span><span><i className="legend-dot blue" />DNS / IP</span><span><i className="legend-dot light" />Поддомен</span></div>
      <svg viewBox="0 0 780 400" className="graph-svg" role="img" aria-label={`Граф инфраструктуры: ${visibleNodes.length} узлов`}>
        <defs><radialGradient id="center-glow"><stop offset="0" stopColor="#7f55ff" stopOpacity="0.28"/><stop offset="1" stopColor="#7f55ff" stopOpacity="0"/></radialGradient></defs>
        <circle cx="390" cy="190" r="112" fill="url(#center-glow)" />
        {edges.filter(e => positions[e.source] && positions[e.target]).map((edge, i) => (
          <line key={`${edge.source}-${edge.target}-${i}`} x1={positions[edge.source].x} y1={positions[edge.source].y}
            x2={positions[edge.target].x} y2={positions[edge.target].y} stroke="#585576" strokeWidth="1" strokeOpacity=".62" strokeDasharray={edge.type === 'CT' ? '4 5' : undefined} />
        ))}
        {visibleNodes.map((node, i) => {
          const pos = positions[node.id]; const central = i === 0; const focused = selected === node.id
          const fill = central ? '#9e76ff' : node.type === 'subdomain' ? '#71a6e8' : '#9c9daf'
          return <g key={node.id} className="graph-node" onClick={() => setSelected(node.id)} tabIndex={0} role="button"
            aria-label={`Выбрать узел ${node.label}`} onKeyDown={e => { if (e.key === 'Enter') setSelected(node.id) }}>
            {(central || focused) && <circle cx={pos.x} cy={pos.y} r={central ? 27 : 19} fill="none" stroke={fill} strokeOpacity=".22" strokeWidth="9" />}
            <circle cx={pos.x} cy={pos.y} r={central ? 16 : focused ? 11 : 8} fill={fill} stroke="#14131f" strokeWidth="3" />
            <text x={pos.x} y={pos.y + (central ? 35 : 27)} textAnchor="middle" fill={central || focused ? '#f6f4ff' : '#aaa9c0'} fontSize={central ? 14 : 11} fontFamily="JetBrains Mono, monospace">
              {node.label.length > 29 ? node.label.slice(0, 27) + '…' : node.label}
            </text>
          </g>
        })}
      </svg>
      <div className="graph-foot"><span>{visibleNodes.length} отображаемых узлов · {edges.length} связей</span><span className="muted">{selected ? `Выбрано: ${selected}` : 'Нажми на узел для подробностей'}</span></div>
    </div>
  )
}

function EmptyState({ title, subtitle, button }: { title: string; subtitle: string; button?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Network size={28}/></div><h3>{title}</h3><p>{subtitle}</p>{button}</div>
}

function DataTable({ records }: { records: DnsRecord[] }) {
  const [filter, setFilter] = useState('ALL')
  const types = ['ALL', ...Array.from(new Set(records.map(r => r.type)))]
  const visible = filter === 'ALL' ? records : records.filter(r => r.type === filter)
  return <>
    <div className="filter-tabs">{types.map(type => <button key={type} className={`filter-tab ${filter === type ? 'selected' : ''}`} onClick={() => setFilter(type)}>{type}{type === 'ALL' && <span> {records.length}</span>}</button>)}</div>
    <div className="table-scroll"><table className="data-table"><thead><tr><th>Тип</th><th>Значение</th></tr></thead><tbody>{visible.map((record, i) => <tr key={`${record.type}-${i}`}><td><span className="dns-tag">{record.type}</span></td><td className="monospace wrap-anywhere">{record.value}</td></tr>)}</tbody></table></div>
    {visible.length === 0 && <p className="muted table-empty">Нет записей по выбранному фильтру.</p>}
  </>
}

function UsageChart({ daily }: { daily: Stats['daily'] }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - 6 + i)
    const iso = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
    return { label: date.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', ''), count: daily.find(d => d.day === iso)?.count ?? 0 }
  })
  const max = Math.max(1, ...days.map(d => d.count))
  return <div className="usage-chart">{days.map((d, i) => <div className="chart-col" key={i}><div className="chart-bar-track"><div className="chart-bar" title={`${d.count} запросов`} style={{ height: `${Math.max(d.count ? 8 : 2, (d.count / max) * 100)}%` }} /></div><span>{d.label}</span></div>)}</div>
}

export default function App() {
  const [page, setPage] = useState<Page>('overview')
  const [query, setQuery] = useState('')
  const [authorized, setAuthorized] = useState(false)
  const [includeCT, setIncludeCT] = useState(false)
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [stats, setStats] = useState<Stats>(emptyStats)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyFilter, setHistoryFilter] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [statsData, historyData] = await Promise.all([
        request<Stats>(`${API}/stats`), request<{ items: HistoryItem[] }>(`${API}/history?limit=100`)
      ])
      setStats(statsData); setHistory(historyData.items); setConnected(true)
    } catch { setConnected(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    const target = query.trim()
    if (!target || busy) return
    setBusy(true); setError(''); setExportOpen(false); setPage('investigate')
    try {
      const response = await request<Result>(`${API}/analyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, authorized_probe: authorized, include_ct: includeCT })
      })
      setResult(response); setQuery(response.target); await refresh()
    } catch (exc) { setError(exc instanceof Error ? exc.message : 'Неизвестная ошибка') }
    finally { setBusy(false) }
  }

  async function openAnalysis(id: number) {
    setError(''); setBusy(true)
    try { setResult(await request<Result>(`${API}/history/${id}`)); setPage('investigate') }
    catch (exc) { setError(exc instanceof Error ? exc.message : 'Не удалось загрузить запись') }
    finally { setBusy(false) }
  }

  const filteredHistory = history.filter(row => row.target.toLowerCase().includes(historyFilter.toLowerCase()))
  const pageTitles: Record<Page, string> = { overview: 'Обзор платформы', investigate: 'Поиск и анализ', history: 'История исследований', graph: 'Карта инфраструктуры' }
  return <div className={`app-shell ${collapsed ? 'collapsed' : ''}`}>
    <aside className="sidebar">
      <button className="logo-panel" onClick={() => setPage('overview')} aria-label="Requiem Atlas, на главную">
        <div className="logo-mark"><Radar size={23} strokeWidth={2.1} /></div>
        {!collapsed && <div className="logo-title">requiem<span>.atlas</span><small>INTELLIGENCE PLATFORM</small></div>}
      </button>
      <div className="side-divider" />
      {!collapsed && <div className="side-label">WORKSPACE</div>}
      <nav className="side-nav" aria-label="Основная навигация">
        {MENU.map(({ page: targetPage, label, icon: Icon }) => <button key={targetPage}
          className={`side-link ${page === targetPage ? 'active' : ''}`} onClick={() => setPage(targetPage)} title={label}>
          <Icon size={19} strokeWidth={1.8} /> {!collapsed && <span>{label}</span>}
          {!collapsed && targetPage === 'history' && history.length > 0 && <b>{history.length}</b>}
        </button>)}
      </nav>
      {!collapsed && <><div className="side-label side-label-second">SYSTEM</div><div className="side-system"><ShieldCheck size={17} /><span>Безопасная разведка<small>Local-first / no broad scan</small></span></div></>}
      <div className="sidebar-bottom">
        {!collapsed && <div className="side-support"><div className="support-symbol"><TerminalSquare size={18}/></div><div><strong>ATLAS CORE</strong><p>Исследуй свою инфраструктуру и публичные данные.</p></div></div>}
        <button className="side-link collapse-btn" title="Свернуть меню" onClick={() => setCollapsed(v => !v)}><PanelLeftClose size={19} />{!collapsed && <span>Свернуть меню</span>}</button>
        <div className="side-bottom-status"><StatusDot online={connected}/>{!collapsed && <span>{connected ? 'Система подключена' : 'API не подключён'}</span>}</div>
      </div>
    </aside>

    <main className="main-panel">
      <header className="topbar"><div className="breadcrumb">REQUIEM / <span>{pageTitles[page]}</span></div><div className="top-actions"><span className="version">BUILD 0.1.0 / MVP</span><div className="top-line" /><div className="top-status"><StatusDot online={connected}/>{connected ? 'API ONLINE' : 'API OFFLINE'}</div><button className="avatar" title="Локальный профиль">R</button></div></header>
      <div className="content">
        {error && <div className="error-banner" role="alert"><ShieldAlert size={18}/><span>{error}</span><button aria-label="Закрыть" onClick={() => setError('')}><X size={16}/></button></div>}

        {page === 'overview' && <>
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>INTELLIGENCE OVERVIEW</div><h1>Цифровая инфраструктура.<br/><span>Под контролем.</span></h1><p>Исследуй публичные активы, анализируй связи и сохраняй результаты в одном месте.</p></div><span className="outline-token"><Activity size={14} /> LIVE WORKSPACE</span></div>
          <div className="search-hero"><div className="search-hero-top"><div className="search-hero-title"><Radar size={19}/><strong>Начать исследование</strong></div><span>DOMAIN · IP · DNS · TLS</span></div><form onSubmit={submit} className="search-entry"><Search size={21}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Домен или IP, например cloudflare.com" aria-label="Домен или IP"/><button disabled={busy || !query.trim()}>{busy ? <RefreshCw className="spin" size={17}/> : <ArrowRight size={18}/>}<span>{busy ? 'Анализ…' : 'Исследовать'}</span></button></form><div className="search-examples">ПОПРОБУЙ: {['example.org', 'cloudflare.com', '1.1.1.1'].map(example => <button key={example} onClick={() => { setQuery(example); setPage('investigate') }}>{example} <ArrowRight size={12}/></button>)}</div></div>
          <div className="metrics-grid"><Metric icon={<Layers3 size={20}/>} title="Всего исследований" value={stats.total_analyses} note="Сохранено локально"/><Metric icon={<Globe2 size={20}/>} title="Уникальных целей" value={stats.unique_targets} note="Домены и адреса"/><Metric icon={<Server size={20}/>} title="Анализов доменов" value={stats.domain_analyses} note="DNS и RDAP"/><Metric icon={<HardDrive size={20}/>} title="Анализов IP" value={stats.ip_analyses} note="Публичные адреса"/></div>
          <div className="dashboard-grid"><section className="panel activity-panel"><div className="panel-head"><div><h2>Активность запросов</h2><p>Количество исследований за последние 7 дней</p></div><IconTag><BarChart3 size={17}/></IconTag></div><UsageChart daily={stats.daily}/></section><section className="panel recent-panel"><div className="panel-head"><div><h2>Последние цели</h2><p>Недавно исследованные активы</p></div><button className="subtle-link" onClick={() => setPage('history')}>Все <ArrowRight size={14}/></button></div>{stats.recent.length ? <div className="recent-list">{stats.recent.slice(0, 4).map(row => <button className="recent-row" key={row.id} onClick={() => void openAnalysis(row.id)}><span className="recent-icon">{row.kind === 'domain' ? <Globe2 size={17}/> : <Server size={17}/>}</span><span className="recent-name"><strong>{row.target}</strong><small>{formatDate(row.scanned_at)}</small></span><ArrowRight size={16}/></button>)}</div> : <div className="no-recent"><Fingerprint size={24}/><span>Пока нет запросов. Начни с поиска выше.</span></div>}</section></div>
          <div className="section-bottom"><div className="privacy-note"><LockKeyhole size={16}/> Данные исследований хранятся в твоей локальной базе.</div><span>BUILT FOR CLARITY. DESIGNED FOR CONTROL.</span></div>
        </>}

        {page === 'investigate' && <>
          <div className="standard-heading"><div className="eyebrow"><span className="eyebrow-line"/>ASSET INVESTIGATION</div><div className="standard-heading-row"><div><h1>Исследование активов</h1><p>Публичные DNS, RDAP, сертификаты и ограниченные HTTP-проверки.</p></div><span className="outline-token"><ShieldCheck size={14}/> READ-ONLY BY DEFAULT</span></div></div>
          <section className="panel search-panel"><form className="search-entry flat" onSubmit={submit}><Search size={20}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Введи домен или публичный IP" aria-label="Цель исследования"/><button disabled={busy || !query.trim()}>{busy ? <RefreshCw size={17} className="spin"/> : <Radar size={17}/>}<span>{busy ? 'Выполняется…' : 'Анализировать'}</span></button></form><div className="check-options"><label className="checkline"><input type="checkbox" checked={includeCT} onChange={e => setIncludeCT(e.target.checked)}/><span className="custom-checkbox"><Check size={12}/></span> Искать поддомены в публичных CT-логах <span className="hint">медленнее</span></label><label className="checkline"><input type="checkbox" checked={authorized} onChange={e => setAuthorized(e.target.checked)}/><span className="custom-checkbox"><Check size={12}/></span> Разрешаю HTTP/TLS-проверку этой цели <span className="hint">только мои / разрешённые активы</span></label></div></section>
          {busy && <div className="scan-progress"><span className="spinner-circle"/><div><strong>Собираем открытые данные…</strong><p>DNS, RDAP и дополнительные источники могут отвечать несколько секунд.</p></div></div>}
          {!result && !busy && <div className="investigation-empty"><div className="faint-grid"/><div className="empty-icon large"><Radar size={33}/></div><div className="eyebrow">START WITH AN ASSET</div><h2>От домена до полной картины.</h2><p>Введи домен или публичный IP. Мы соберём доступные сведения и построим граф связей. Результаты останутся в истории.</p><div className="feature-pills"><span><Globe2 size={14}/> DNS</span><span><ShieldCheck size={14}/> RDAP</span><span><LockKeyhole size={14}/> TLS</span><span><Waypoints size={14}/> GRAPH</span></div></div>}
          {result && <div className="results-container"><div className="result-title"><div><div className="eyebrow">ANALYSIS #{result.id.toString().padStart(4, '0')}</div><h2>{result.target}</h2><p><StatusDot online/> {result.kind === 'domain' ? 'DOMAIN' : 'PUBLIC IP'} <span className="sep">·</span> {formatDate(result.scanned_at)} <span className="sep">·</span> {result.authorized_probe ? 'HTTP/TLS разрешены' : 'Пассивный режим'}</p></div><div className="result-actions"><button className="btn secondary" onClick={() => setPage('graph')}><Waypoints size={16}/> Граф</button><div className="dropdown-parent"><button className="btn secondary" onClick={() => setExportOpen(v => !v)} aria-expanded={exportOpen}><ArrowDownToLine size={16}/> Экспорт <ChevronDown size={14}/></button>{exportOpen && <div className="export-popover"><button onClick={() => { exportResult(result, 'json'); setExportOpen(false) }}>JSON · Полные данные</button><button onClick={() => { exportResult(result, 'csv'); setExportOpen(false) }}>CSV · DNS-записи</button></div>}</div></div></div>
            <div className="result-stats"><div><span>DNS-записей</span><strong>{result.summary.dns_records}</strong></div><div><span>IP-адресов</span><strong>{result.summary.ips}</strong></div><div><span>Поддоменов (CT)</span><strong>{result.summary.subdomains}</strong></div><div><span>Связей на графе</span><strong>{result.graph.edges.length}</strong></div></div>
            <div className="result-grid"><section className="panel dns-panel"><div className="panel-head"><div><h2>DNS Registry</h2><p>Записи, полученные на момент запроса</p></div><IconTag><Database size={17}/></IconTag></div>{result.dns.length ? <DataTable key={result.id} records={result.dns}/> : <div className="info-empty">Для этой цели DNS-записей нет.</div>}</section><div className="result-side"><section className="panel"><div className="panel-head"><div><h2>RDAP / Registration</h2><p>Информация из публичного реестра</p></div><IconTag><Fingerprint size={17}/></IconTag></div>{Object.keys(result.rdap).length ? <div className="detail-list"><Detail name="Name" value={result.rdap.name}/><Detail name="Handle" value={result.rdap.handle}/><Detail name="Address range" value={result.rdap.start_address && result.rdap.end_address ? `${result.rdap.start_address} → ${result.rdap.end_address}` : ''}/><Detail name="Status" value={result.rdap.status?.join(', ')}/>{result.rdap.events?.slice(0, 3).map((e, i) => <Detail key={i} name={e.action ?? 'event'} value={e.date?.slice(0, 10)}/>)}</div> : <div className="info-empty">Реестр не предоставил данные для этой цели.</div>}</section><section className="panel"><div className="panel-head"><div><h2>HTTP / TLS</h2><p>{result.authorized_probe ? 'Сетевые проверки' : 'Отключено в пассивном режиме'}</p></div><IconTag><LockKeyhole size={17}/></IconTag></div>{!result.authorized_probe ? <div className="info-empty"><Info size={15}/> Для проверки заголовков и TLS включи разрешение выше.</div> : <div className="detail-list"><Detail name="HTTP status" value={result.http.status?.toString()}/><Detail name="Endpoint" value={result.http.url}/><Detail name="TLS protocol" value={result.tls.protocol}/><Detail name="Issuer" value={result.tls.issuer}/><Detail name="Expires" value={result.tls.expires}/>{Object.entries(result.http.headers ?? {}).map(([name, value]) => <Detail key={name} name={name} value={value}/>)}</div>}</section></div></div>
            <div className="result-grid lower"><section className="panel"><div className="panel-head"><div><h2>Infrastructure graph</h2><p>Связи, найденные в DNS и CT</p></div><button className="subtle-link" onClick={() => setPage('graph')}>Развернуть <ArrowRight size={14}/></button></div><NetworkGraph nodes={result.graph.nodes} edges={result.graph.edges}/></section><section className="panel"><div className="panel-head"><div><h2>Наблюдения</h2><p>Наличие данных ≠ подтверждённая уязвимость</p></div><IconTag><ShieldCheck size={17}/></IconTag></div><div className="findings">{result.security.map((entry, i) => <div key={i} className="finding"><div className={`finding-symbol ${entry.level}`}><Info size={16}/></div><div><strong>{entry.title}</strong><p>{entry.detail}</p></div></div>)}</div>{result.notes.length > 0 && <div className="notes"><strong>Примечания источников</strong>{result.notes.map((note, i) => <p key={i}>· {note}</p>)}</div>}{result.subdomains.length > 0 && <div className="subdomain-list"><strong>Поддомены (CT)</strong>{result.subdomains.slice(0, 12).map(host => <span key={host}>{host}</span>)}</div>}</section></div></div>}
        </>}

        {page === 'history' && <><div className="standard-heading"><div className="eyebrow"><span className="eyebrow-line"/>RESEARCH ARCHIVE</div><div className="standard-heading-row"><div><h1>История исследований</h1><p>Локальный архив результатов. Ничего не исчезает после перезагрузки.</p></div><button className="btn secondary" onClick={() => void refresh()}><RefreshCw size={16}/> Обновить</button></div></div><section className="panel history-panel"><div className="panel-head"><div><h2>Сохранённые анализы <span className="muted">/ {history.length}</span></h2><p>Последние 100 результатов</p></div><div className="mini-search"><Search size={16}/><input placeholder="Найти цель…" value={historyFilter} onChange={e => setHistoryFilter(e.target.value)}/></div></div>{filteredHistory.length ? <div className="table-scroll"><table className="data-table history-table"><thead><tr><th>Цель</th><th>Тип</th><th>DNS</th><th>IP</th><th>Время</th><th /></tr></thead><tbody>{filteredHistory.map(row => <tr key={row.id}><td><button className="target-link" onClick={() => void openAnalysis(row.id)}>{row.target}</button></td><td><span className="dns-tag">{row.kind.toUpperCase()}</span></td><td>{row.summary.dns_records ?? 0}</td><td>{row.summary.ips ?? 0}</td><td>{formatDate(row.scanned_at)}</td><td><button className="table-arrow" onClick={() => void openAnalysis(row.id)} aria-label={`Открыть ${row.target}`}><ArrowRight size={17}/></button></td></tr>)}</tbody></table></div> : <EmptyState title="Пока нет сохранённых исследований" subtitle="После первого анализа он появится здесь." button={<button className="btn primary" onClick={() => setPage('investigate')}>Перейти к поиску <ArrowRight size={16}/></button>}/>}</section></>}

        {page === 'graph' && <><div className="standard-heading"><div className="eyebrow"><span className="eyebrow-line"/>INFRASTRUCTURE INTELLIGENCE</div><div className="standard-heading-row"><div><h1>Карта инфраструктуры</h1><p>Визуальная модель DNS-адресов, сервисных узлов и публичных CT-записей.</p></div>{result && <button className="btn secondary" onClick={() => setPage('investigate')}><ArrowLeft size={16}/> К результатам</button>}</div></div><section className="panel graph-page-panel"><div className="panel-head"><div><h2>{result?.target || 'Текущая цель'}</h2><p>{result ? `${result.graph.nodes.length} узлов · ${result.graph.edges.length} связей` : 'Выбери запись из истории или выполни анализ'}</p></div><IconTag><Network size={18}/></IconTag></div>{result ? <NetworkGraph nodes={result.graph.nodes} edges={result.graph.edges}/> : <EmptyState title="Сначала найди цель" subtitle="Граф строится на основе проверенных DNS-записей и найденных публичных сведений." button={<button className="btn primary" onClick={() => setPage('investigate')}>Начать анализ <ArrowRight size={16}/></button>}/>}</section><div className="graph-disclaimer"><Info size={15}/> Граф отображает установленные связи, но не доказывает принадлежность всех узлов одному владельцу.</div></>}
      </div>
      <footer className="app-footer"><span>© 2026 REQUIEM ATLAS</span><span>BUILT WITH PYTHON + REACT <span className="footer-sep">/</span> LOCAL-FIRST OSINT</span><a href="http://127.0.0.1:8000/docs" target="_blank" rel="noreferrer"><CircleHelp size={14}/> API DOCS</a></footer>
    </main>
  </div>
}

function Metric({ icon, title, value, note }: { icon: ReactNode; title: string; value: number; note: string }) {
  return <div className="metric-card"><div className="metric-icon">{icon}</div><span className="metric-title">{title}</span><strong>{value.toLocaleString('ru-RU')}</strong><small><span className="small-spark"/> {note}</small></div>
}
function Detail({ name, value }: { name: string; value?: string }) {
  if (!value) return null
  return <div className="detail-row"><span>{name}</span><strong>{value}</strong></div>
}
