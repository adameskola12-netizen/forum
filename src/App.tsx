// @ts-nocheck
import React, { useState, useEffect, useMemo } from "react";
import Papa from "papaparse";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, ReferenceLine,
} from "recharts";
import {
  Upload, ArrowUpRight, ArrowDownRight, Trash2,
} from "lucide-react";

// ————————————————————————————————————————————————————————————————
// THEME — warm editorial palette, not generic SaaS
// ————————————————————————————————————————————————————————————————
const C = {
  ink: "#1a1612",
  paper: "#faf7f2",
  paperDeep: "#f4efe6",
  line: "#e8e0d2",
  muted: "#8a7f70",
  accent: "#b8532a",
  accent2: "#c4974a",
  accent3: "#4a6b5c",
  accent4: "#6b5b8a",
  accent5: "#a8623b",
  good: "#4a6b5c",
  bad: "#b8532a",
};
const AREA_COLORS = {
  "Forum Pickleball": C.accent,
  "Forum Fitness": C.accent3,
  "Forum Golf": C.accent2,
  "Forum Offices": C.accent4,
  "No area": C.muted,
};
const SOURCE_COLORS = {
  MEMBERSHIP: C.accent,
  BOOKING: C.accent3,
  EVENT_SIGNUP: C.accent2,
  OTHER: C.accent4,
  SHOP: C.accent5,
  REFUND: "#c44536",
  TRANSFER: "#9a8f80",
  REPLAY: C.muted,
};

// ————————————————————————————————————————————————————————————————
// HELPERS
// ————————————————————————————————————————————————————————————————
const fmt$ = (n) => {
  if (n == null || isNaN(n)) return "$0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  if (abs >= 1_000) return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `${sign}$${abs.toFixed(0)}`;
};
const fmt$precise = (n) => {
  if (n == null || isNaN(n)) return "$0.00";
  return (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtInt = (n) => (n == null ? "0" : Math.round(n).toLocaleString());
const fmtPct = (n) => (n == null || isNaN(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);
const ymd = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};
const startOfWeek = (d) => {
  const nd = new Date(d); nd.setHours(0, 0, 0, 0);
  const day = nd.getDay();
  nd.setDate(nd.getDate() - day);
  return nd;
};
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const startOfQuarter = (d) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
const startOfYear = (d) => new Date(d.getFullYear(), 0, 1);
const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const endOfQuarter = (d) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 0);
const endOfYear = (d) => new Date(d.getFullYear(), 11, 31);
const daysBetween = (a, b) => Math.round((b - a) / 86_400_000) + 1;

// ————————————————————————————————————————————————————————————————
// CSV PARSE — PodPlay Settlements schema
// ————————————————————————————————————————————————————————————————
const REQUIRED_COLS = ["ID", "Date (UTC)", "Source", "Net Revenue", "Gross"];
function parseCSVFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (res) => {
        if (res.errors?.length) {
          const fatal = res.errors.find((e) => e.type === "Delimiter" || e.code === "MissingQuotes");
          if (fatal) return reject(new Error(fatal.message));
        }
        const cols = res.meta.fields || [];
        const missing = REQUIRED_COLS.filter((c) => !cols.includes(c));
        if (missing.length) return reject(new Error(`Missing columns: ${missing.join(", ")}`));
        resolve(res.data);
      },
      error: (err) => reject(err),
    });
  });
}
function normalizeRows(rows) {
  const num = (v) => {
    if (v == null || v === "") return 0;
    const n = parseFloat(String(v).replace(/[$,]/g, ""));
    return isNaN(n) ? 0 : n;
  };
  return rows
    .map((r) => {
      const dt = r["Date (UTC)"] ? new Date(r["Date (UTC)"].replace(" ", "T") + "Z") : null;
      if (!dt || isNaN(dt.getTime())) return null;
      const local = new Date(dt.getTime() - 5 * 3600_000);
      return {
        id: r.ID,
        date: local,
        dateKey: ymd(local),
        source: r.Source || "OTHER",
        eventType: r["Event Type"] || "",
        description: r.Description || "",
        email: r.Email || "",
        customer: r["Customer Name"] || "",
        membership: r.Membership || "",
        area: r.Areas || "No area",
        subtotal: num(r.Subtotal),
        discounts: num(r.Discounts),
        gross: num(r.Gross),
        fee: num(r["Payment Fee"]),
        netRevenue: num(r["Net Revenue"]),
        paymentMethod: r["Payment Method"] || "",
        reportingCategory: r["Reporting Category"] || "",
      };
    })
    .filter(Boolean);
}

// ————————————————————————————————————————————————————————————————
// AGGREGATION
// ————————————————————————————————————————————————————————————————
const PERIOD_DEFS = {
  day:     { label: "Day",     start: (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; }, end: (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; } },
  week:    { label: "Week",    start: startOfWeek, end: (d) => { const s = startOfWeek(d); return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6, 23, 59, 59); } },
  month:   { label: "Month",   start: startOfMonth, end: (d) => { const e = endOfMonth(d); return new Date(e.getFullYear(), e.getMonth(), e.getDate(), 23, 59, 59); } },
  quarter: { label: "Quarter", start: startOfQuarter, end: (d) => { const e = endOfQuarter(d); return new Date(e.getFullYear(), e.getMonth(), e.getDate(), 23, 59, 59); } },
  year:    { label: "Year",    start: startOfYear, end: (d) => { const e = endOfYear(d); return new Date(e.getFullYear(), e.getMonth(), e.getDate(), 23, 59, 59); } },
};
function rangeForAnchor(anchor, period) {
  const def = PERIOD_DEFS[period];
  return { start: def.start(anchor), end: def.end(anchor), label: labelForAnchor(anchor, period) };
}
function labelForAnchor(d, period) {
  if (period === "day")   return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  if (period === "week")  { const s = startOfWeek(d); const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6); return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`; }
  if (period === "month") return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  if (period === "quarter") return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
  if (period === "year")  return `${d.getFullYear()}`;
}
function shiftAnchor(anchor, period, n) {
  const d = new Date(anchor);
  if (period === "day")     d.setDate(d.getDate() + n);
  if (period === "week")    d.setDate(d.getDate() + 7 * n);
  if (period === "month")   d.setMonth(d.getMonth() + n);
  if (period === "quarter") d.setMonth(d.getMonth() + 3 * n);
  if (period === "year")    d.setFullYear(d.getFullYear() + n);
  return d;
}
function filterInRange(rows, start, end) {
  const s = start.getTime(); const e = end.getTime();
  return rows.filter((r) => r.date.getTime() >= s && r.date.getTime() <= e);
}
function summarize(rows) {
  const gross = rows.reduce((a, r) => a + r.gross, 0);
  const net = rows.reduce((a, r) => a + r.netRevenue, 0);
  const fees = rows.reduce((a, r) => a + r.fee, 0);
  const discounts = rows.reduce((a, r) => a + r.discounts, 0);
  const txns = rows.length;
  const uniq = new Set(rows.filter(r => r.email).map(r => r.email.toLowerCase())).size;
  return { gross, net, fees, discounts, txns, uniqueCustomers: uniq };
}
function dailyBreakdown(rows, start, end) {
  const byDay = new Map();
  const d = new Date(start); d.setHours(0,0,0,0);
  const last = new Date(end); last.setHours(0,0,0,0);
  while (d <= last) { byDay.set(ymd(d), { date: ymd(d), gross: 0, net: 0, txns: 0, members: 0, booking: 0, events: 0, other: 0 }); d.setDate(d.getDate() + 1); }
  rows.forEach(r => {
    const row = byDay.get(r.dateKey);
    if (!row) return;
    row.gross += r.gross; row.net += r.netRevenue; row.txns++;
    if (r.source === "MEMBERSHIP") row.members += r.netRevenue;
    else if (r.source === "BOOKING") row.booking += r.netRevenue;
    else if (r.source === "EVENT_SIGNUP") row.events += r.netRevenue;
    else row.other += r.netRevenue;
  });
  return Array.from(byDay.values());
}
function breakdownBy(rows, key) {
  const m = new Map();
  rows.forEach(r => {
    const k = r[key] || "Unknown";
    if (!m.has(k)) m.set(k, { name: k, net: 0, gross: 0, txns: 0 });
    const b = m.get(k); b.net += r.netRevenue; b.gross += r.gross; b.txns++;
  });
  return Array.from(m.values()).sort((a, b) => b.net - a.net);
}
function membershipMetrics(rows) {
  const mem = rows.filter(r => r.source === "MEMBERSHIP" && r.netRevenue > 0);
  const byTier = new Map();
  mem.forEach(r => {
    const tier = r.description.replace(/^Membership - /, "");
    if (!byTier.has(tier)) byTier.set(tier, { tier, count: 0, revenue: 0, members: new Set() });
    const b = byTier.get(tier);
    b.count++; b.revenue += r.netRevenue;
    if (r.email) b.members.add(r.email.toLowerCase());
  });
  const tiers = Array.from(byTier.values()).map(t => ({
    tier: t.tier, count: t.count, revenue: t.revenue, uniqueMembers: t.members.size,
  })).sort((a, b) => b.revenue - a.revenue);
  const totalMRR = mem.reduce((a, r) => {
    if (/Annual/i.test(r.description)) return a + r.netRevenue / 12;
    return a + r.netRevenue;
  }, 0);
  const uniqueMembers = new Set(mem.filter(r => r.email).map(r => r.email.toLowerCase())).size;
  return { tiers, totalMRR, uniqueMembers, totalMembershipRevenue: mem.reduce((a, r) => a + r.netRevenue, 0) };
}
function topCustomers(rows, n = 10) {
  const m = new Map();
  rows.forEach(r => {
    const k = r.email.toLowerCase() || r.customer;
    if (!k) return;
    if (!m.has(k)) m.set(k, { email: r.email, customer: r.customer, net: 0, txns: 0, membership: r.membership });
    const b = m.get(k); b.net += r.netRevenue; b.txns++;
  });
  return Array.from(m.values()).sort((a, b) => b.net - a.net).slice(0, n);
}
function projectPeriod(dailyRows, elapsedDays, totalDays, totalToDate) {
  if (elapsedDays <= 0) return { runRate: 0, linear: 0, blended: 0 };
  const avg = totalToDate / elapsedDays;
  const runRate = avg * totalDays;
  const xs = dailyRows.slice(0, elapsedDays).map((_, i) => i);
  const ys = dailyRows.slice(0, elapsedDays).map(d => d.net);
  let slope = 0, intercept = avg;
  if (xs.length > 1) {
    const n = xs.length;
    const sx = xs.reduce((a, v) => a + v, 0);
    const sy = ys.reduce((a, v) => a + v, 0);
    const sxx = xs.reduce((a, v) => a + v * v, 0);
    const sxy = xs.reduce((a, v, i) => a + v * ys[i], 0);
    const denom = (n * sxx - sx * sx);
    if (denom !== 0) {
      slope = (n * sxy - sx * sy) / denom;
      intercept = (sy - slope * sx) / n;
    }
  }
  let linear = 0;
  for (let i = 0; i < totalDays; i++) linear += Math.max(0, intercept + slope * i);
  const blended = 0.5 * runRate + 0.5 * linear;
  return { runRate, linear, blended };
}

// ————————————————————————————————————————————————————————————————
// STORAGE — localStorage (replaces window.storage from artifact)
// ————————————————————————————————————————————————————————————————
const GOALS_KEY = "forum_goals_v1";
const DATA_KEY = "forum_data_v1";

function saveData(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("save error", e);
  }
}
function loadData(key) {
  try {
    const r = localStorage.getItem(key);
    if (r) return JSON.parse(r);
  } catch (e) {
    console.error("load error", e);
  }
  return null;
}

// ————————————————————————————————————————————————————————————————
// UI PRIMITIVES
// ————————————————————————————————————————————————————————————————
const KPICard = ({ label, value, sub, trend, accent }) => (
  <div className="rounded-none border border-[color:var(--line)] bg-[color:var(--paper)] p-5 relative overflow-hidden">
    <div className="absolute top-0 left-0 w-1 h-full" style={{ background: accent || C.ink }} />
    <div className="text-[10px] tracking-[0.2em] uppercase text-[color:var(--muted)] mb-2 font-medium">{label}</div>
    <div className="flex items-baseline gap-2">
      <div className="text-3xl font-serif text-[color:var(--ink)] tracking-tight">{value}</div>
      {trend != null && (
        <div className={`text-xs flex items-center gap-0.5 ${trend >= 0 ? "text-[color:var(--good)]" : "text-[color:var(--bad)]"}`}>
          {trend >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
          {fmtPct(trend)}
        </div>
      )}
    </div>
    {sub && <div className="text-xs text-[color:var(--muted)] mt-1">{sub}</div>}
  </div>
);
const Section = ({ eyebrow, title, children, right }) => (
  <section className="mb-10">
    <div className="flex items-end justify-between border-b border-[color:var(--line)] pb-3 mb-5">
      <div>
        {eyebrow && <div className="text-[10px] tracking-[0.25em] uppercase text-[color:var(--accent)] mb-1 font-medium">{eyebrow}</div>}
        <h2 className="text-2xl font-serif text-[color:var(--ink)]">{title}</h2>
      </div>
      {right}
    </div>
    {children}
  </section>
);
const Pill = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 text-xs tracking-wide border transition-colors ${
      active
        ? "bg-[color:var(--ink)] text-[color:var(--paper)] border-[color:var(--ink)]"
        : "bg-transparent text-[color:var(--ink)] border-[color:var(--line)] hover:border-[color:var(--ink)]"
    }`}
  >
    {children}
  </button>
);
const TooltipBox = ({ active, payload, label, formatter }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[color:var(--paper)] border border-[color:var(--ink)] p-2 text-xs shadow-lg">
      {label && <div className="font-medium mb-1">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2 h-2" style={{ background: p.color }} />
          <span className="text-[color:var(--muted)]">{p.name}:</span>
          <span className="font-medium">{formatter ? formatter(p.value) : fmt$(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

// ————————————————————————————————————————————————————————————————
// MAIN APP
// ————————————————————————————————————————————————————————————————
export default function ForumDashboard() {
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("overview");
  const [period, setPeriod] = useState("month");
  const [anchor, setAnchor] = useState(new Date(2026, 2, 15));
  const [goals, setGoals] = useState({});
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const savedRows = loadData(DATA_KEY);
    const savedGoals = loadData(GOALS_KEY);
    if (savedRows?.length) {
      setRows(savedRows.map(r => ({ ...r, date: new Date(r.date) })));
    }
    if (savedGoals) setGoals(savedGoals);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded && rows.length > 0) {
      const serializable = rows.map(r => ({ ...r, date: r.date.toISOString() }));
      saveData(DATA_KEY, serializable);
    }
  }, [rows, loaded]);
  useEffect(() => { if (loaded) saveData(GOALS_KEY, goals); }, [goals, loaded]);

  useEffect(() => {
    if (rows.length > 0) {
      const maxDate = rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0].date);
      setAnchor(maxDate);
    }
  }, [rows.length]);

  const handleFiles = async (files) => {
    setUploading(true); setError("");
    try {
      const allNew = [];
      for (const f of files) {
        const parsed = await parseCSVFile(f);
        allNew.push(...normalizeRows(parsed));
      }
      const existingIds = new Set(rows.map(r => r.id));
      const merged = [...rows, ...allNew.filter(r => !existingIds.has(r.id))];
      merged.sort((a, b) => a.date - b.date);
      setRows(merged);
    } catch (e) {
      setError(e.message || "Failed to parse CSV.");
    } finally {
      setUploading(false);
    }
  };

  const clearData = () => {
    if (confirm("Clear all transaction data? Goals will be kept.")) {
      setRows([]);
      saveData(DATA_KEY, []);
    }
  };

  const range = useMemo(() => rangeForAnchor(anchor, period), [anchor, period]);
  const windowRows = useMemo(() => filterInRange(rows, range.start, range.end), [rows, range]);
  const summary = useMemo(() => summarize(windowRows), [windowRows]);
  const prevRange = useMemo(() => rangeForAnchor(shiftAnchor(anchor, period, -1), period), [anchor, period]);
  const prevRows = useMemo(() => filterInRange(rows, prevRange.start, prevRange.end), [rows, prevRange]);
  const prevSummary = useMemo(() => summarize(prevRows), [prevRows]);
  const pct = (a, b) => (b === 0 ? null : ((a - b) / Math.abs(b)) * 100);
  const daily = useMemo(() => dailyBreakdown(windowRows, range.start, range.end), [windowRows, range]);
  const byArea = useMemo(() => breakdownBy(windowRows, "area"), [windowRows]);
  const bySource = useMemo(() => breakdownBy(windowRows, "source"), [windowRows]);
  const byEventType = useMemo(() => breakdownBy(windowRows.filter(r => r.eventType), "eventType"), [windowRows]);
  const memMetrics = useMemo(() => membershipMetrics(windowRows), [windowRows]);
  const customers = useMemo(() => topCustomers(windowRows), [windowRows]);

  const now = new Date();
  const totalDays = daysBetween(range.start, range.end);
  const effectiveNow = now < range.start ? range.start : (now > range.end ? range.end : now);
  const elapsedDays = Math.max(1, Math.min(totalDays, daysBetween(range.start, effectiveNow)));
  const isComplete = now >= range.end;
  const projection = useMemo(() => projectPeriod(daily, elapsedDays, totalDays, summary.net), [daily, elapsedDays, totalDays, summary.net]);
  const goalKey = `${period}:${ymd(range.start)}`;
  const currentGoal = goals[goalKey]?.netRevenue ?? 0;
  const onPace = currentGoal > 0 ? (summary.net / (currentGoal * (elapsedDays / totalDays))) * 100 : null;
  const setGoal = (key, field, val) => {
    setGoals(g => ({ ...g, [key]: { ...(g[key] || {}), [field]: val } }));
  };

  if (!loaded) {
    return <div className="min-h-screen bg-[color:var(--paper)] flex items-center justify-center text-[color:var(--muted)] font-serif italic">Preparing the books…</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="min-h-screen bg-[color:var(--paper)] flex items-center justify-center p-6">
        <div className="max-w-2xl w-full">
          <div className="text-[10px] tracking-[0.3em] uppercase text-[color:var(--accent)] mb-3">Forum Delano · Performance</div>
          <h1 className="text-5xl font-serif text-[color:var(--ink)] leading-tight mb-3">The House Ledger</h1>
          <p className="text-[color:var(--muted)] mb-8 font-serif italic text-lg">A studio for tracking what the Forum earns, week by week, court by court.</p>
          <UploadZone onFiles={handleFiles} uploading={uploading} error={error} />
          <div className="mt-6 text-xs text-[color:var(--muted)] leading-relaxed">
            Drop PodPlay <em>Settlements</em> CSV exports. Multiple files merge automatically; duplicates are de-duped by transaction ID. Your data is stored locally to this dashboard.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-[color:var(--paper)] text-[color:var(--ink)]">
      <header className="border-b border-[color:var(--line)] bg-[color:var(--paper)] sticky top-0 z-20 backdrop-blur">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div>
              <div className="text-[10px] tracking-[0.3em] uppercase text-[color:var(--accent)]">Forum Delano</div>
              <div className="font-serif text-xl leading-none mt-0.5">The House Ledger</div>
            </div>
            <nav className="flex gap-1">
              {[
                ["overview", "Overview"],
                ["periods", "Time Periods"],
                ["mix", "Revenue Mix"],
                ["members", "Memberships"],
                ["goals", "Goals & Pacing"],
                ["projections", "Projections"],
              ].map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`text-xs px-3 py-2 tracking-wide transition-colors ${
                    tab === k ? "text-[color:var(--ink)] font-semibold" : "text-[color:var(--muted)] hover:text-[color:var(--ink)]"
                  }`}
                >
                  {l}
                  {tab === k && <div className="h-0.5 bg-[color:var(--accent)] mt-1 -mb-3" />}
                </button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <UploadButton onFiles={handleFiles} uploading={uploading} />
            <button onClick={clearData} className="text-xs text-[color:var(--muted)] hover:text-[color:var(--bad)] p-2" title="Clear data">
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between border-t border-[color:var(--line)]/50">
          <div className="flex items-center gap-3">
            <div className="text-[10px] tracking-[0.25em] uppercase text-[color:var(--muted)]">Viewing</div>
            <div className="flex gap-1">
              {Object.keys(PERIOD_DEFS).map(k => (
                <Pill key={k} active={period === k} onClick={() => setPeriod(k)}>{PERIOD_DEFS[k].label}</Pill>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setAnchor(shiftAnchor(anchor, period, -1))} className="text-[color:var(--muted)] hover:text-[color:var(--ink)] w-8 h-8 flex items-center justify-center border border-[color:var(--line)]">‹</button>
            <div className="font-serif text-lg min-w-[260px] text-center">{range.label}</div>
            <button onClick={() => setAnchor(shiftAnchor(anchor, period, 1))} className="text-[color:var(--muted)] hover:text-[color:var(--ink)] w-8 h-8 flex items-center justify-center border border-[color:var(--line)]">›</button>
            <button onClick={() => setAnchor(new Date())} className="text-xs text-[color:var(--muted)] hover:text-[color:var(--ink)] px-2">Today</button>
          </div>
        </div>
      </header>
      <main className="max-w-[1400px] mx-auto px-6 py-8">
        {error && <div className="mb-4 p-3 bg-[color:var(--accent)]/10 border border-[color:var(--accent)] text-sm">{error}</div>}
        {tab === "overview" && (
          <OverviewTab
            summary={summary} prevSummary={prevSummary} pct={pct}
            daily={daily} byArea={byArea} bySource={bySource}
            period={period} range={range} projection={projection}
            elapsedDays={elapsedDays} totalDays={totalDays} isComplete={isComplete}
            currentGoal={currentGoal} memMetrics={memMetrics}
          />
        )}
        {tab === "periods" && <PeriodsTab rows={rows} period={period} anchor={anchor} />}
        {tab === "mix" && <MixTab byArea={byArea} bySource={bySource} byEventType={byEventType} windowRows={windowRows} />}
        {tab === "members" && <MembersTab memMetrics={memMetrics} customers={customers} />}
        {tab === "goals" && (
          <GoalsTab
            period={period} range={range} goalKey={goalKey}
            goals={goals} setGoal={setGoal}
            summary={summary} projection={projection}
            elapsedDays={elapsedDays} totalDays={totalDays} onPace={onPace}
            daily={daily}
          />
        )}
        {tab === "projections" && (
          <ProjectionsTab
            rows={rows} range={range}
            summary={summary} daily={daily} projection={projection}
            elapsedDays={elapsedDays} totalDays={totalDays} isComplete={isComplete}
          />
        )}
      </main>
      <footer className="max-w-[1400px] mx-auto px-6 py-8 border-t border-[color:var(--line)] text-xs text-[color:var(--muted)] flex justify-between">
        <div>{rows.length.toLocaleString()} transactions loaded · {new Set(rows.map(r => r.email.toLowerCase())).size} unique customers overall</div>
        <div className="font-serif italic">Forum Delano · House Ledger v1</div>
      </footer>
    </div>
  );
}

// ————————————————————————————————————————————————————————————————
// OVERVIEW TAB
// ————————————————————————————————————————————————————————————————
function OverviewTab({ summary, prevSummary, pct, daily, byArea, bySource, period, range, projection, elapsedDays, totalDays, isComplete, currentGoal, memMetrics }) {
  return (
    <>
      <Section eyebrow="Snapshot" title={`Performance · ${PERIOD_DEFS[period].label}`}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border border-[color:var(--line)] divide-x divide-[color:var(--line)]">
          <KPICard label="Net Revenue" value={fmt$(summary.net)} sub={`vs prior: ${fmt$(prevSummary.net)}`} trend={pct(summary.net, prevSummary.net)} accent={C.accent} />
          <KPICard label="Transactions" value={fmtInt(summary.txns)} sub={`vs prior: ${fmtInt(prevSummary.txns)}`} trend={pct(summary.txns, prevSummary.txns)} accent={C.accent3} />
          <KPICard label="Unique Customers" value={fmtInt(summary.uniqueCustomers)} sub={`vs prior: ${fmtInt(prevSummary.uniqueCustomers)}`} trend={pct(summary.uniqueCustomers, prevSummary.uniqueCustomers)} accent={C.accent2} />
          <KPICard label="MRR (est.)" value={fmt$(memMetrics.totalMRR)} sub={`${memMetrics.uniqueMembers} paying members`} accent={C.accent4} />
        </div>
      </Section>
      <Section eyebrow="This Period" title="Daily trajectory" right={
        currentGoal > 0 && !isComplete && (
          <div className="text-xs text-[color:var(--muted)]">
            Goal: <span className="font-semibold text-[color:var(--ink)]">{fmt$(currentGoal)}</span> ·
            Projected: <span className="font-semibold text-[color:var(--ink)]">{fmt$(projection.blended)}</span>
          </div>
        )
      }>
        <div className="border border-[color:var(--line)] bg-[color:var(--paper)] p-4 h-80">
          <ResponsiveContainer>
            <AreaChart data={daily}>
              <defs>
                <linearGradient id="revG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.accent} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={C.accent} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke={C.line} vertical={false} />
              <XAxis dataKey="date" stroke={C.muted} tick={{ fontSize: 11 }} tickFormatter={(d) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })} />
              <YAxis stroke={C.muted} tick={{ fontSize: 11 }} tickFormatter={fmt$} />
              <Tooltip content={(props) => <TooltipBox {...props} formatter={fmt$precise} />} />
              {currentGoal > 0 && <ReferenceLine y={currentGoal / totalDays} stroke={C.accent2} strokeDasharray="4 4" label={{ value: "Daily Goal Pace", fill: C.accent2, fontSize: 10, position: "right" }} />}
              <Area type="monotone" dataKey="net" name="Net Revenue" stroke={C.accent} strokeWidth={2} fill="url(#revG)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Section>
      <div className="grid md:grid-cols-2 gap-6">
        <Section eyebrow="By Venue" title="Revenue by area">
          <div className="border border-[color:var(--line)] bg-[color:var(--paper)] p-4">
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={byArea} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={C.line} horizontal={false} />
                  <XAxis type="number" stroke={C.muted} tick={{ fontSize: 11 }} tickFormatter={fmt$} />
                  <YAxis type="category" dataKey="name" stroke={C.muted} tick={{ fontSize: 11 }} width={120} />
                  <Tooltip content={(props) => <TooltipBox {...props} formatter={fmt$precise} />} />
                  <Bar dataKey="net" name="Net Revenue">
                    {byArea.map((e, i) => <Cell key={i} fill={AREA_COLORS[e.name] || C.muted} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Section>
        <Section eyebrow="By Stream" title="Revenue by source">
          <div className="border border-[color:var(--line)] bg-[color:var(--paper)] p-4">
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={bySource} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={C.line} horizontal={false} />
                  <XAxis type="number" stroke={C.muted} tick={{ fontSize: 11 }} tickFormatter={fmt$} />
                  <YAxis type="category" dataKey="name" stroke={C.muted} tick={{ fontSize: 11 }} width={120} />
                  <Tooltip content={(props) => <TooltipBox {...props} formatter={fmt$precise} />} />
                  <Bar dataKey="net" name="Net Revenue">
                    {bySource.map((e, i) => <Cell key={i} fill={SOURCE_COLORS[e.name] || C.muted} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Section>
      </div>
      <Section eyebrow="Operational" title="Fees, discounts, and leakage">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border border-[color:var(--line)] divide-x divide-[color:var(--line)]">
          <KPICard label="Gross" value={fmt$precise(summary.gross)} sub="Before fees" />
          <KPICard label="Discounts Given" value={fmt$precise(summary.discounts)} sub={summary.gross > 0 ? `${(summary.discounts / (summary.gross + summary.discounts) * 100).toFixed(1)}% of subtotal` : ""} accent={C.accent2} />
          <KPICard label="Processing Fees" value={fmt$precise(summary.fees)} sub={summary.gross > 0 ? `${(summary.fees / summary.gross * 100).toFixed(2)}% of gross` : ""} accent={C.accent4} />
          <KPICard label="Net Revenue" value={fmt$precise(summary.net)} sub="What the business keeps" accent={C.accent} />
        </div>
      </Section>
    </>
  );
}

// ————————————————————————————————————————————————————————————————
// PERIODS TAB
// ————————————————————————————————————————————————————————————————
function PeriodsTab({ rows, period, anchor }) {
  const recentPeriods = [];
  for (let i = 5; i >= 0; i--) {
    const a = shiftAnchor(anchor, period, -i);
    const r = rangeForAnchor(a, period);
    const rr = filterInRange(rows, r.start, r.end);
    const s = summarize(rr);
    recentPeriods.push({
      label: r.label,
      shortLabel: period === "month" ? r.start.toLocaleDateString(undefined, {month:"short", year:"2-digit"}) : period === "week" ? r.start.toLocaleDateString(undefined, {month:"numeric", day:"numeric"}) : r.label,
      ...s,
    });
  }
  const dowData = [0, 1, 2, 3, 4, 5, 6].map(d => ({ day: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d], net: 0, txns: 0 }));
  rows.forEach(r => { const d = r.date.getDay(); dowData[d].net += r.netRevenue; dowData[d].txns++; });
  const hourData = Array.from({ length: 24 }, (_, h) => ({ hour: h, net: 0, txns: 0 }));
  rows.forEach(r => { const h = r.date.getHours(); hourData[h].net += r.netRevenue; hourData[h].txns++; });
  return (
    <>
      <Section eyebrow="Trend" title={`Last 6 ${PERIOD_DEFS[period].label.toLowerCase()}s`}>
        <div className="border border-[color:var(--line)] bg-[color:var(--paper)] p-4 h-80">
          <ResponsiveContainer>
            <BarChart data={recentPeriods}>
              <CartesianGrid strokeDasharray="2 4" stroke={C.line} vertical={false} />
              <XAxis dataKey="shortLabel" stroke={C.muted} tick={{ fontSize: 11 }} />
              <YAxis stroke={C.muted} tick={{ fontSize: 11 }} tickFormatter={fmt$} />
              <Tooltip content={(props) => <TooltipBox {...props} formatter={fmt$precise} />} />
              <Bar dataKey="net" name="Net Revenue" fill={C.accent} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 grid grid-cols-6 border-l border-[color:var(--line)]">
          {recentPeriods.map((p, i) => (
            <div key={i} className="p-3 border-r border-t border-b border-[color:var(--line)]">
              <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">{p.shortLabel}</div>
              <div className="font-serif text-lg">{fmt$(p.net)}</div>
              <div className="text-xs text-[color:var(--muted)]">{fmtInt(p.txns)} txns · {fmtInt(p.uniqueCustomers)} cust</div>
            </div>
          ))}
        </div>
      </Section>
      <div className="grid md:grid-cols-2 gap-6">
        <Section eyebrow="Rhythm" title="By day of week (all-time)">
          <div className="border border-[color:var(--line)] bg-[color:var(--paper)] p-4 h-64">
            <ResponsiveContainer>
              <BarChart data={dowData}>
                <CartesianGrid strokeDasharray="2 4" stroke={C.line} vertical={false} />
                <XAxis dataKey="day" stroke={C.muted} tick={{ fontSize: 11 }} />
                <YAxis stroke={C.muted} tick={{ fontSize: 11 }} tickFormatter={fmt$} />
                <Tooltip content={(props) => <TooltipBox {...props} formatter={fmt$precise} />} />
                <Bar dataKey="net" name="Net Revenue" fill={C.accent3} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
        <Section eyebrow="Rhythm" title="By hour of day (local)">
          <div className="border border-[color:var(--line)] bg-[color:var(--paper)] p-4 h-64">
            <ResponsiveContainer>
              <BarChart data={hourData}>
                <CartesianGrid strokeDasharray="2 4" stroke={C.line} vertical={false} />
                <XAxis dataKey="hour" stroke={C.muted} tick={{ fontSize: 11 }} tickFormatter={(h) => `${h}h`} />
                <YAxis stroke={C.muted} tick={{ fontSize: 11 }} tickFormatter={fmt$} />
                <Tooltip content={(props) => <TooltipBox {...props} formatter={fmt$precise} />} />
                <Bar dataKey="net" name="Net Revenue" fill={C.accent2} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>
    </>
  );
}

// ————————————————————————————————————————————————————————————————
// MIX TAB
// ————————————————————————————————————————————————————————————————
function MixTab({ byArea, bySource, byEventType, windowRows }) {
  const stackedDaily = useMemo(() => {
    const byKey = new Map();
    windowRows.forEach(r => {
      if (!byKey.has(r.dateKey)) byKey.set(r.dateKey, { date: r.dateKey, "Forum Pickleball": 0, "Forum Fitness": 0, "Forum Golf": 0, "Forum Offices": 0, "No area": 0 });
      const row = byKey.get(r.dateKey);
      const k = ["Forum Pickleball", "Forum Fitness", "Forum Golf", "Forum Offices"].includes(r.area) ? r.area : "No area";
      row[k] = (row[k] || 0) + r.netRevenue;
    });
    return Array.from(byKey.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [windowRows]);
  return (
    <>
      <Section eyebrow="Composition" title="Revenue mix by area">
        <div className="border border-[color:var(--line)] bg-[color:var(--paper)] p-4 h-80 mb-4">
          <ResponsiveContainer>
            <AreaChart data={stackedDaily}>
              <CartesianGrid strokeDasharray="2 4" stroke={C.line} vertical={false} />
              <XAxis dataKey="date" stroke={C.muted} tick={{ fontSize: 11 }} tickFormatter={(d) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })} />
              <YAxis stroke={C.muted} tick={{ fontSize: 11 }} tickFormatter={fmt$} />
              <Tooltip content={(props) => <TooltipBox {...props} formatter={fmt$precise} />} />
              {["Forum Pickleball", "Forum Fitness", "Forum Golf", "Forum Offices", "No area"].map((k) => (
                <Area key={k} type="monotone" dataKey={k} stackId="1" stroke={AREA_COLORS[k]} fill={AREA_COLORS[k]} fillOpacity={0.7} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <MixTable rows={byArea} label="Area" palette={AREA_COLORS} />
      </Section>
      <Section eyebrow="Composition" title="Revenue mix by source">
        <MixTable rows={bySource} label="Source" palette={SOURCE_COLORS} />
      </Section>
      <Section eyebrow="Composition" title="By event type">
        <MixTable rows={byEventType.slice(0, 12)} label="Event Type" />
      </Section>
    </>
  );
}
function MixTable({ rows, label, palette }) {
  const total = rows.reduce((a, r) => a + Math.abs(r.net), 0);
  return (
    <div className="border border-[color:var(--line)] bg-[color:var(--paper)]">
      <div className="grid grid-cols-12 gap-4 p-3 border-b border-[color:var(--line)] text-[10px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
        <div className="col-span-4">{label}</div>
        <div className="col-span-1 text-right">Txns</div>
        <div className="col-span-3 text-right">Net Revenue</div>
        <div className="col-span-4">Share</div>
      </div>
      {rows.map((r, i) => {
        const pct = total > 0 ? (Math.abs(r.net) / total) * 100 : 0;
        return (
          <div key={i} className="grid grid-cols-12 gap-4 p-3 border-b border-[color:var(--line)] last:border-b-0 items-center text-sm">
            <div className="col-span-4 flex items-center gap-2">
              {palette && <div className="w-2.5 h-2.5" style={{ background: palette[r.name] || C.muted }} />}
              <span>{r.name}</span>
            </div>
            <div className="col-span-1 text-right text-[color:var(--muted)]">{fmtInt(r.txns)}</div>
            <div className="col-span-3 text-right font-serif">{fmt$precise(r.net)}</div>
            <div className="col-span-4 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-[color:var(--line)]">
                <div className="h-full" style={{ width: `${pct}%`, background: palette?.[r.name] || C.ink }} />
              </div>
              <span className="text-xs text-[color:var(--muted)] w-12 text-right">{pct.toFixed(1)}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ————————————————————————————————————————————————————————————————
// MEMBERS TAB
// ————————————————————————————————————————————————————————————————
function MembersTab({ memMetrics, customers }) {
  const { tiers, totalMRR, uniqueMembers, totalMembershipRevenue } = memMetrics;
  return (
    <>
      <Section eyebrow="Recurring" title="Membership performance">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border border-[color:var(--line)] divide-x divide-[color:var(--line)]">
          <KPICard label="MRR (est.)" value={fmt$(totalMRR)} sub="Annuals ÷ 12" accent={C.accent} />
          <KPICard label="ARR (est.)" value={fmt$(totalMRR * 12)} sub="MRR × 12" accent={C.accent3} />
          <KPICard label="Paying Members" value={fmtInt(uniqueMembers)} sub="Unique billers this period" accent={C.accent2} />
          <KPICard label="Member Revenue" value={fmt$(totalMembershipRevenue)} sub="Billed this period" accent={C.accent4} />
        </div>
      </Section>
      <Section eyebrow="By Tier" title="Membership tier breakdown">
        <div className="border border-[color:var(--line)] bg-[color:var(--paper)]">
          <div className="grid grid-cols-12 gap-4 p-3 border-b border-[color:var(--line)] text-[10px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
            <div className="col-span-5">Tier</div>
            <div className="col-span-2 text-right">Members</div>
            <div className="col-span-2 text-right">Charges</div>
            <div className="col-span-3 text-right">Revenue</div>
          </div>
          {tiers.map((t, i) => (
            <div key={i} className="grid grid-cols-12 gap-4 p-3 border-b border-[color:var(--line)] last:border-b-0 items-center text-sm">
              <div className="col-span-5 font-medium">{t.tier}</div>
              <div className="col-span-2 text-right">{fmtInt(t.uniqueMembers)}</div>
              <div className="col-span-2 text-right text-[color:var(--muted)]">{fmtInt(t.count)}</div>
              <div className="col-span-3 text-right font-serif">{fmt$precise(t.revenue)}</div>
            </div>
          ))}
        </div>
      </Section>
      <Section eyebrow="Top Spenders" title="Most valuable customers this period">
        <div className="border border-[color:var(--line)] bg-[color:var(--paper)]">
          <div className="grid grid-cols-12 gap-4 p-3 border-b border-[color:var(--line)] text-[10px] tracking-[0.2em] uppercase text-[color:var(--muted)]">
            <div className="col-span-1">#</div>
            <div className="col-span-4">Customer</div>
            <div className="col-span-3">Membership</div>
            <div className="col-span-2 text-right">Txns</div>
            <div className="col-span-2 text-right">Spend</div>
          </div>
          {customers.map((c, i) => (
            <div key={i} className="grid grid-cols-12 gap-4 p-3 border-b border-[color:var(--line)] last:border-b-0 items-center text-sm">
              <div className="col-span-1 font-serif text-[color:var(--muted)]">{String(i + 1).padStart(2, "0")}</div>
              <div className="col-span-4 font-medium truncate">{c.customer || c.email}</div>
              <div className="col-span-3 text-xs text-[color:var(--muted)] truncate">{c.membership || "—"}</div>
              <div className="col-span-2 text-right">{fmtInt(c.txns)}</div>
              <div className="col-span-2 text-right font-serif">{fmt$precise(c.net)}</div>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

// ————————————————————————————————————————————————————————————————
// GOALS TAB
// ————————————————————————————————————————————————————————————————
function GoalsTab({ period, range, goalKey, goals, setGoal, summary, projection, elapsedDays, totalDays, onPace, daily }) {
  const goalForPeriod = goals[goalKey] || {};
  const netGoal = goalForPeriod.netRevenue || 0;
  const txnGoal = goalForPeriod.txns || 0;
  const custGoal = goalForPeriod.customers || 0;
  const paceAt = (goal, actual) => goal > 0 ? (actual / (goal * (elapsedDays / totalDays))) * 100 : null;
  return (
    <>
      <Section eyebrow="Targets" title={`Goals for ${range.label}`}>
        <div className="grid md:grid-cols-3 gap-4">
          <GoalSetter
            label="Net Revenue Goal"
            value={netGoal}
            actual={summary.net}
            pace={paceAt(netGoal, summary.net)}
            projection={projection.blended}
            onChange={(v) => setGoal(goalKey, "netRevenue", v)}
            formatter={fmt$precise}
            accent={C.accent}
          />
          <GoalSetter
            label="Transaction Goal"
            value={txnGoal}
            actual={summary.txns}
            pace={paceAt(txnGoal, summary.txns)}
            onChange={(v) => setGoal(goalKey, "txns", v)}
            formatter={fmtInt}
            accent={C.accent3}
          />
          <GoalSetter
            label="Unique Customer Goal"
            value={custGoal}
            actual={summary.uniqueCustomers}
            pace={paceAt(custGoal, summary.uniqueCustomers)}
            onChange={(v) => setGoal(goalKey, "customers", v)}
            formatter={fmtInt}
            accent={C.accent2}
          />
        </div>
      </Section>
      {netGoal > 0 && (
        <Section eyebrow="Trajectory" title="Cumulative pacing vs. goal">
          <div className="border border-[color:var(--line)] bg-[color:var(--paper)] p-4 h-80">
            <ResponsiveContainer>
              <LineChart data={daily.map((d, i) => {
                const cum = daily.slice(0, i + 1).reduce((a, x) => a + x.net, 0);
                return { date: d.date, cumulative: cum, paceTarget: netGoal * ((i + 1) / totalDays) };
              })}>
                <CartesianGrid strokeDasharray="2 4" stroke={C.line} vertical={false} />
                <XAxis dataKey="date" stroke={C.muted} tick={{ fontSize: 11 }} tickFormatter={(d) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })} />
                <YAxis stroke={C.muted} tick={{ fontSize: 11 }} tickFormatter={fmt$} />
                <Tooltip content={(props) => <TooltipBox {...props} formatter={fmt$precise} />} />
                <Line type="monotone" dataKey="cumulative" name="Actual (cumulative)" stroke={C.accent} strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="paceTarget" name="Goal Pace" stroke={C.accent2} strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}
    </>
  );
}
function GoalSetter({ label, value, actual, pace, projection, onChange, formatter, accent }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const pctComplete = value > 0 ? (actual / value) * 100 : 0;
  const status = pace == null ? null : pace >= 100 ? "ahead" : pace >= 90 ? "on pace" : "behind";
  const statusColor = status === "ahead" ? C.good : status === "on pace" ? C.accent2 : C.bad;
  return (
    <div className="border border-[color:var(--line)] bg-[color:var(--paper)] p-5 relative">
      <div className="absolute top-0 left-0 w-full h-0.5" style={{ background: accent }} />
      <div className="text-[10px] tracking-[0.2em] uppercase text-[color:var(--muted)] mb-3">{label}</div>
      <div className="flex items-center gap-2 mb-4">
        <input
          type="number"
          value={local}
          onChange={(e) => setLocal(parseFloat(e.target.value) || 0)}
          onBlur={() => onChange(local)}
          className="w-full text-2xl font-serif bg-transparent border-b border-[color:var(--line)] focus:border-[color:var(--ink)] outline-none pb-1"
          placeholder="Set goal"
        />
      </div>
      <div className="space-y-1.5 text-sm">
        <div className="flex justify-between"><span className="text-[color:var(--muted)]">Actual</span><span className="font-serif">{formatter(actual)}</span></div>
        {projection != null && (
          <div className="flex justify-between"><span className="text-[color:var(--muted)]">Projected</span><span className="font-serif">{formatter(projection)}</span></div>
        )}
        {value > 0 && <div className="flex justify-between"><span className="text-[color:var(--muted)]">To goal</span><span className="font-serif">{formatter(Math.max(0, value - actual))}</span></div>}
      </div>
      {value > 0 && (
        <>
          <div className="mt-4 h-2 bg-[color:var(--line)] relative overflow-hidden">
            <div className="h-full absolute" style={{ width: `${Math.min(100, pctComplete)}%`, background: accent }} />
          </div>
          <div className="flex justify-between mt-1 text-xs">
            <span className="text-[color:var(--muted)]">{pctComplete.toFixed(0)}% complete</span>
            {status && <span style={{ color: statusColor }} className="uppercase tracking-wider font-medium text-[10px]">{status} · {pace.toFixed(0)}%</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ————————————————————————————————————————————————————————————————
// PROJECTIONS TAB
// ————————————————————————————————————————————————————————————————
function ProjectionsTab({ rows, range, summary, daily, projection, elapsedDays, totalDays, isComplete }) {
  const now = new Date();
  const trailing = (days) => {
    const start = new Date(now); start.setDate(start.getDate() - days);
    const rr = filterInRange(rows, start, now);
    return summarize(rr);
  };
  const t30 = trailing(30);
  const t90 = trailing(90);
  const projChart = useMemo(() => {
    const totalNet = summary.net;
    const avgDaily = elapsedDays > 0 ? totalNet / elapsedDays : 0;
    return daily.map((d, i) => {
      const cum = daily.slice(0, i + 1).reduce((a, x) => a + x.net, 0);
      const isFuture = i >= elapsedDays;
      return {
        date: d.date,
        actual: isFuture ? null : cum,
        runRate: totalNet + avgDaily * Math.max(0, i + 1 - elapsedDays),
        linear: projection.linear * ((i + 1) / totalDays),
      };
    });
  }, [daily, elapsedDays, summary.net, projection.linear, totalDays]);
  return (
    <>
      <Section eyebrow="Forward View" title={`${range.label} projection`}>
        <div className="grid md:grid-cols-3 gap-0 border border-[color:var(--line)] divide-x divide-[color:var(--line)] mb-6">
          <KPICard label="Run-Rate Projection" value={fmt$(projection.runRate)} sub="Simple average × days remaining" accent={C.accent2} />
          <KPICard label="Linear Projection" value={fmt$(projection.linear)} sub="Slope-adjusted forecast" accent={C.accent3} />
          <KPICard label="Blended Projection" value={fmt$(projection.blended)} sub="50/50 of both methods" accent={C.accent} />
        </div>
        {!isComplete && (
          <div className="border border-[color:var(--line)] bg-[color:var(--paper)] p-4 h-80 mb-6">
            <ResponsiveContainer>
              <LineChart data={projChart}>
                <CartesianGrid strokeDasharray="2 4" stroke={C.line} vertical={false} />
                <XAxis dataKey="date" stroke={C.muted} tick={{ fontSize: 11 }} tickFormatter={(d) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })} />
                <YAxis stroke={C.muted} tick={{ fontSize: 11 }} tickFormatter={fmt$} />
                <Tooltip content={(props) => <TooltipBox {...props} formatter={fmt$precise} />} />
                <Line type="monotone" dataKey="actual" name="Actual" stroke={C.accent} strokeWidth={2.5} dot={false} connectNulls={false} />
                <Line type="monotone" dataKey="runRate" name="Run-Rate Projection" stroke={C.accent2} strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                <Line type="monotone" dataKey="linear" name="Linear Projection" stroke={C.accent3} strokeWidth={1.5} strokeDasharray="6 2" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {isComplete && (
          <div className="border border-[color:var(--line)] bg-[color:var(--paperDeep)] p-5 italic text-[color:var(--muted)]">
            This period is complete — actual landed at {fmt$precise(summary.net)}. Projections are available for the current or future periods.
          </div>
        )}
      </Section>
      <Section eyebrow="Trailing" title="Recent run-rates (all periods)">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border border-[color:var(--line)] divide-x divide-[color:var(--line)]">
          <KPICard label="Trailing 30 Days" value={fmt$(t30.net)} sub={`${fmtInt(t30.txns)} txns`} />
          <KPICard label="Trailing 90 Days" value={fmt$(t90.net)} sub={`${fmtInt(t90.txns)} txns`} />
          <KPICard label="Annualized (30d)" value={fmt$(t30.net * 365 / 30)} sub="T30 × 365/30" accent={C.accent} />
          <KPICard label="Annualized (90d)" value={fmt$(t90.net * 365 / 90)} sub="T90 × 365/90" accent={C.accent3} />
        </div>
        <div className="mt-3 text-xs text-[color:var(--muted)] italic">Annualized figures get more reliable as you load more months of history. With a single month in the dataset, treat these as directional only.</div>
      </Section>
    </>
  );
}

// ————————————————————————————————————————————————————————————————
// UPLOAD COMPONENTS
// ————————————————————————————————————————————————————————————————
function UploadZone({ onFiles, uploading, error }) {
  const [drag, setDrag] = useState(false);
  const onDrop = (e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) onFiles(Array.from(e.dataTransfer.files)); };
  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); setDrag(true); }}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      className={`border-2 border-dashed p-12 text-center transition-colors ${drag ? "border-[color:var(--accent)] bg-[color:var(--accent)]/5" : "border-[color:var(--line)]"}`}
    >
      <Upload size={32} className="mx-auto mb-3 text-[color:var(--muted)]" />
      <div className="font-serif text-xl mb-1">Drop settlement exports here</div>
      <div className="text-xs text-[color:var(--muted)] mb-4">PodPlay CSV format — single file or multiple</div>
      <label className="inline-block cursor-pointer">
        <input type="file" accept=".csv" multiple className="hidden" onChange={(e) => e.target.files?.length && onFiles(Array.from(e.target.files))} />
        <span className="inline-block bg-[color:var(--ink)] text-[color:var(--paper)] px-6 py-2.5 text-xs tracking-wider uppercase">
          {uploading ? "Parsing..." : "Browse files"}
        </span>
      </label>
      {error && <div className="mt-4 text-[color:var(--bad)] text-sm">{error}</div>}
    </div>
  );
}
function UploadButton({ onFiles, uploading }) {
  return (
    <label className="cursor-pointer inline-flex items-center gap-1.5 text-xs border border-[color:var(--line)] px-3 py-1.5 hover:border-[color:var(--ink)] transition-colors">
      <input type="file" accept=".csv" multiple className="hidden" onChange={(e) => e.target.files?.length && onFiles(Array.from(e.target.files))} />
      <Upload size={12} />
      {uploading ? "Parsing..." : "Add CSV"}
    </label>
  );
}
