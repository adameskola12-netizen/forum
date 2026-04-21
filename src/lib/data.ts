// @ts-nocheck
// Data access layer. All Supabase queries live here so App.tsx can stay
// focused on UI state. Shape conversions between DB (snake_case) and
// app (camelCase) happen here.

import { supabase } from "./supabase";

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------
function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// DB row → app row. Applies the UTC-to-Central (-5h) shift for day-level bucketing
// while preserving the original UTC in r.dateUtc.
function hydrateTransaction(r) {
  const dateUtc = new Date(r.date_utc);
  const local = new Date(dateUtc.getTime() - 5 * 3600_000);
  return {
    id: r.id,
    dateUtc,
    date: local,
    dateKey: ymd(local),
    source: r.source || "OTHER",
    eventType: r.event_type || "",
    description: r.description || "",
    email: r.email || "",
    customer: r.customer_name || "",
    membership: r.membership || "",
    area: r.area || "No area",
    subtotal: Number(r.subtotal) || 0,
    discounts: Number(r.discounts) || 0,
    gross: Number(r.gross) || 0,
    fee: Number(r.payment_fee) || 0,
    netRevenue: Number(r.net_revenue) || 0,
    paymentMethod: r.payment_method || "",
    reportingCategory: r.reporting_category || "",
  };
}

// app goal field ↔ DB metric enum
const APP_TO_METRIC = {
  netRevenue: "net_revenue",
  txns: "transactions",
  customers: "unique_customers",
};
const METRIC_TO_APP = {
  net_revenue: "netRevenue",
  transactions: "txns",
  unique_customers: "customers",
};

// ----------------------------------------------------------------------------
// transactions
// ----------------------------------------------------------------------------

// Fetch transactions, optionally bounded by a date range. Paginates through
// PostgREST's default 1000-row page limit until exhausted.
export async function fetchTransactions({ start = null, end = null } = {}) {
  const pageSize = 1000;
  const rows = [];
  let from = 0;
  while (true) {
    let q = supabase
      .from("transactions")
      .select("*")
      .order("date_utc", { ascending: true })
      .range(from, from + pageSize - 1);
    if (start) q = q.gte("date_utc", start.toISOString());
    if (end) q = q.lte("date_utc", end.toISOString());
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows.map(hydrateTransaction);
}

// Upsert a batch of normalized rows (from App.tsx normalizeRows).
// Rows must have r.dateUtc (raw UTC Date) and r.raw (original CSV row).
// Chunks to 500 rows per request to stay under request body limits.
// Returns { added, skipped } where added = rows newly inserted,
// skipped = rows whose id already existed.
export async function insertTransactions(rows, uploadedBy) {
  if (!rows.length) return { added: 0, skipped: 0 };

  const payload = rows.map((r) => ({
    id: r.id,
    date_utc: r.dateUtc.toISOString(),
    source: r.source,
    event_type: r.eventType || null,
    description: r.description || null,
    email: r.email || null,
    customer_name: r.customer || null,
    membership: r.membership || null,
    area: r.area || null,
    subtotal: r.subtotal,
    discounts: r.discounts,
    gross: r.gross,
    payment_fee: r.fee,
    net_revenue: r.netRevenue,
    payment_method: r.paymentMethod || null,
    reporting_category: r.reportingCategory || null,
    raw_row: r.raw ?? null,
    uploaded_by: uploadedBy,
  }));

  const chunkSize = 500;
  let totalAdded = 0;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("transactions")
      .upsert(chunk, { onConflict: "id", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    totalAdded += data?.length ?? 0;
  }
  return { added: totalAdded, skipped: payload.length - totalAdded };
}

// ----------------------------------------------------------------------------
// goals
// ----------------------------------------------------------------------------

// Fetch all goals and reshape into the map the UI uses:
//   { "month:2026-04-01": { netRevenue: 60000, txns: 500, customers: 100 } }
export async function fetchGoals() {
  const { data, error } = await supabase.from("goals").select("*");
  if (error) throw error;
  const goals = {};
  for (const g of data) {
    const k = `${g.period}:${g.period_key}`;
    if (!goals[k]) goals[k] = {};
    const appField = METRIC_TO_APP[g.metric] ?? g.metric;
    goals[k][appField] = Number(g.value);
  }
  return goals;
}

// Upsert a single goal. period/periodKey derived from the UI's goalKey.
export async function upsertGoal({ period, periodKey, metric, value, createdBy }) {
  const dbMetric = APP_TO_METRIC[metric] ?? metric;
  const { error } = await supabase.from("goals").upsert(
    {
      period,
      period_key: periodKey,
      metric: dbMetric,
      value,
      created_by: createdBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "period,period_key,metric" }
  );
  if (error) throw error;
}

// ----------------------------------------------------------------------------
// uploads (audit log)
// ----------------------------------------------------------------------------

export async function recordUpload({
  uploadedBy,
  fileName,
  rowsAdded,
  rowsSkipped,
  rowsFailed,
  earliestDate,
  latestDate,
}) {
  const { error } = await supabase.from("uploads").insert({
    uploaded_by: uploadedBy,
    file_name: fileName ?? null,
    rows_added: rowsAdded ?? 0,
    rows_skipped: rowsSkipped ?? 0,
    rows_failed: rowsFailed ?? 0,
    earliest_transaction_date: earliestDate ? earliestDate.toISOString() : null,
    latest_transaction_date: latestDate ? latestDate.toISOString() : null,
  });
  if (error) throw error;
}

export async function listUploads(limit = 50) {
  const { data, error } = await supabase
    .from("uploads")
    .select("*")
    .order("uploaded_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// ----------------------------------------------------------------------------
// destructive — owner only per RLS
// ----------------------------------------------------------------------------

// Wipe transactions and goals. RLS enforces owner-only DELETE on both tables.
// Uploads audit log is intentionally preserved (including this clear event's
// side effects are visible through absence of transactions).
export async function clearAllData() {
  // neq('id', '__sentinel__') is the idiomatic way to "delete all" in PostgREST
  const r1 = await supabase.from("transactions").delete().neq("id", "__never__");
  if (r1.error) throw r1.error;
  const r2 = await supabase.from("goals").delete().neq("period", "__never__");
  if (r2.error) throw r2.error;
}
