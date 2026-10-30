import { useCallback, useEffect, useMemo, useState } from 'react';
import { Radar, RefreshCw, SlidersHorizontal, Lock, ChevronDown, Settings2 } from 'lucide-react';
import { apiClient } from '../api/client';
import { SignalAction, SignalCheck, SignalItem, SignalReport, SignalRule, SignalRulesResponse } from '../types/models';
import IconTile from '../components/ui/IconTile';
import RingGauge from '../components/ui/RingGauge';
import Chip from '../components/ui/Chip';
import CountUp from '../components/CountUp';
import SignalRuleEditor from '../components/signals/SignalRuleEditor';
import { getAccountTypeMeta } from '../utils/accountType';

type FilterValue = 'all' | 'SELL' | 'BUY' | 'CONFLICT' | 'HOLD';

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'SELL', label: '매도' },
  { value: 'BUY', label: '매수' },
  { value: 'CONFLICT', label: '충돌' },
  { value: 'HOLD', label: '관망' },
];

const ACTION_META: Record<SignalAction, { label: string; badge: string; ring: string; dot: string }> = {
  SELL: { label: '매도 검토', badge: 'border border-rose-400/30 bg-rose-500/10 text-rose-200', ring: 'rgb(var(--c-rose-400))', dot: 'bg-rose-400' },
  BUY: { label: '매수 검토', badge: 'border border-mint-400/30 bg-mint-400/10 text-mint-300', ring: 'rgb(var(--c-mint-400))', dot: 'bg-mint-400' },
  CONFLICT: { label: '신호 충돌', badge: 'border border-amber-400/30 bg-amber-400/10 text-amber-200', ring: 'rgb(var(--c-amber-400))', dot: 'bg-amber-400' },
  HOLD: { label: '관망', badge: 'border border-white/10 bg-white/[0.05] text-zinc-300', ring: 'rgb(var(--c-zinc-400))', dot: 'bg-zinc-400' },
  NO_PRICE: { label: '시세 없음', badge: 'border border-white/10 bg-white/[0.04] text-zinc-500', ring: 'rgb(var(--c-zinc-500))', dot: 'bg-zinc-500' },
};

// 체크 항목별 비교 방향
const CHECK_OPS: Record<string, string> = {
  take_profit: '≥',
  stop_loss: '≤',
  weight_over: '≥',
  weight_under: '≤',
  dividend_payback: '≥',
  low_yield: '≤',
  buy_dip: '≤',
  high_yield: '≥',
};

const fmtKrw = (v: number) => `₩${Math.round(v).toLocaleString('ko-KR')}`;
const fmtSignedKrw = (v: number) => `${v < 0 ? '-' : '+'}₩${Math.abs(Math.round(v)).toLocaleString('ko-KR')}`;
const fmtNum = (v: number, d = 1) => v.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const fmtPct = (v: number, d = 1) => `${fmtNum(v, d)}%`;
const fmtSignedPct = (v: number, d = 1) => `${v > 0 ? '+' : ''}${fmtNum(v, d)}%`;
const signTone = (v: number) => (v > 0 ? 'text-mint-300' : v < 0 ? 'text-rose-300' : 'text-zinc-300');

function formatPrice(v: number, currency: string) {
  return currency === 'USD' ? `$${fmtNum(v, 2)}` : `₩${Math.round(v).toLocaleString('ko-KR')}`;
}

function checkText(c: SignalCheck) {
  const op = CHECK_OPS[c.code] ?? '→';
  const unit = c.unit || '%';
  return `${c.label} ${fmtNum(c.value)}${unit} ${op} ${fmtNum(c.threshold)}${unit}`;
}

function ringInfo(item: SignalItem): { value: number; text: string } | null {
  if (item.action === 'NO_PRICE') return null;
  if (item.action === 'BUY') {
    const dip = item.buy_checks.find((c) => c.code === 'buy_dip');
    if (!dip || !dip.threshold) return null;
    return { value: (item.from_avg_pct / dip.threshold) * 100, text: fmtSignedPct(item.total_return_pct) };
  }
  const tp = item.sell_checks.find((c) => c.code === 'take_profit');
  if (!tp || !tp.threshold) return null;
  return { value: (item.total_return_pct / tp.threshold) * 100, text: fmtSignedPct(item.total_return_pct) };
}

function Metric({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="surface-inset min-w-0 px-3 py-2.5">
      <div className="label-mono">{label}</div>
      <div className="num mt-1 truncate text-sm font-medium text-white">{children}</div>
      {sub && <div className="num mt-0.5 truncate text-[11px] text-zinc-500">{sub}</div>}
    </div>
  );
}

function ModeHint({ mode }: { mode?: 'any' | 'all' }) {
  if (!mode) return null;
  return <span className="ml-1.5 text-zinc-600">({mode === 'all' ? '모두 충족' : '하나 이상'})</span>;
}

function CheckGroup({ title, checks, tone, mode }: { title: string; checks: SignalCheck[]; tone: 'sell' | 'buy'; mode?: 'any' | 'all' }) {
  if (checks.length === 0) return null;
  const metClass =
    tone === 'sell' ? '!border-rose-400/30 !bg-rose-500/10 !text-rose-200' : '!border-mint-400/30 !bg-mint-400/10 !text-mint-300';
  return (
    <div>
      <div className="label-mono mb-1.5">
        {title}
        <ModeHint mode={mode} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {checks.map((c) =>
          c.met ? (
            <Chip key={c.code} check className={`${metClass} ${tone === 'sell' ? '[&_svg]:!text-rose-300' : ''}`}>
              {checkText(c)}
            </Chip>
          ) : (
            <Chip key={c.code} className="!text-zinc-500">
              <span className="text-zinc-600">·</span>
              {checkText(c)}
            </Chip>
          ),
        )}
      </div>
    </div>
  );
}

function SignalCard({ item, rule, onEdit }: { item: SignalItem; rule?: SignalRule; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const meta = ACTION_META[item.action];
  const actionLabel = item.action === 'SELL' && item.restricted_only ? '리밸런싱 검토' : meta.label;
  const ring = ringInfo(item);
  const noPrice = item.action === 'NO_PRICE';

  return (
    <article className="surface flex flex-col p-5 sm:p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold tracking-tight text-white">{item.name}</h3>
          <p className="label-mono mt-0.5">{item.ticker}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {item.rule_source === 'asset' && <span className="badge border border-sky-400/25 bg-sky-400/10 text-sky-200">개별 전략</span>}
          <span className={`badge ${meta.badge}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
            {actionLabel}
          </span>
        </div>
      </header>

      {item.restricted_only && (
        <div className="mt-2.5">
          <span className="badge border border-amber-400/25 bg-amber-400/10 text-amber-200">
            <Lock className="h-3 w-3" />
            연금·IRP 내 리밸런싱
          </span>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
        {ring && (
          <div className="flex justify-center sm:block">
            <RingGauge value={ring.value} size={96} stroke={4} color={meta.ring} label="목표 대비">
              <span className="text-[15px]">{ring.text}</span>
            </RingGauge>
          </div>
        )}
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
          {noPrice ? (
            <div className="surface-inset col-span-2 px-3 py-4 text-center text-sm text-zinc-500">
              현재 시세를 불러오지 못해 신호를 계산하지 못했습니다.
            </div>
          ) : (
            <>
              <Metric label="평가금액">{fmtKrw(item.market_value_krw)}</Metric>
              <Metric
                label="실질 수익률"
                sub={<span className={signTone(item.total_return_krw)}>{fmtSignedKrw(item.total_return_krw)}</span>}
              >
                <span className={signTone(item.total_return_pct)}>{fmtSignedPct(item.total_return_pct)}</span>
              </Metric>
              <Metric label="누적 배당" sub={`회수율 ${fmtPct(item.dividend_payback_pct)}`}>
                {fmtKrw(item.dividends_krw)}
              </Metric>
              <Metric label="배당수익률" sub="현재 / 원금 기준">
                {fmtPct(item.current_yield_pct, 2)} <span className="text-zinc-500">/ {fmtPct(item.yield_on_cost_pct, 2)}</span>
              </Metric>
              <Metric label="비중">{fmtPct(item.weight_pct)}</Metric>
              <Metric label="평단 대비" sub={`${formatPrice(item.avg_price, item.currency)} → ${formatPrice(item.current_price, item.currency)}`}>
                <span className={signTone(item.from_avg_pct)}>{fmtSignedPct(item.from_avg_pct)}</span>
              </Metric>
            </>
          )}
        </div>
      </div>

      {(item.sell_checks.length > 0 || item.buy_checks.length > 0) && (
        <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
          <CheckGroup title="매도 조건" checks={item.sell_checks} tone="sell" mode={rule?.sell_mode} />
          <CheckGroup title="매수 조건" checks={item.buy_checks} tone="buy" mode={rule?.buy_mode} />
        </div>
      )}

      <footer className="mt-4 border-t border-white/[0.06] pt-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
            계좌별 보기 <span className="num text-zinc-600">{item.accounts.length}</span>
          </button>
          <button type="button" onClick={onEdit} className="btn-ghost !px-3 !py-1.5 !text-xs">
            <Settings2 className="h-3.5 w-3.5" />
            전략 설정
          </button>
        </div>
        {open && (
          <ul className="mt-3 space-y-2">
            {item.accounts.map((a) => {
              const t = getAccountTypeMeta({ account_type: a.account_type });
              return (
                <li key={a.account_id} className="surface-inset flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm text-zinc-100">{a.account_name}</span>
                    <span className="label-mono">{a.broker}</span>
                    <span className={`badge ${t.badgeClass}`}>{t.short}</span>
                  </div>
                  <div className="num flex items-center gap-3 text-xs text-zinc-400">
                    <span>{fmtNum(a.quantity, 4)}주</span>
                    <span>평단 {formatPrice(a.avg_price, item.currency)}</span>
                    <span className="text-zinc-200">{fmtKrw(a.market_value_krw)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </footer>
    </article>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="surface h-24" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="surface h-72" />
        ))}
      </div>
    </div>
  );
}

type EditorState = { mode: 'default' } | { mode: 'asset'; item: SignalItem } | null;

export default function SignalsDashboard() {
  const [report, setReport] = useState<SignalReport | null>(null);
  const [rules, setRules] = useState<SignalRulesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>('all');
  const [editor, setEditor] = useState<EditorState>(null);

  const load = useCallback(async (initial = false) => {
    try {
      if (initial) setLoading(true);
      else setRefreshing(true);
      setError(null);
      const [r, ru] = await Promise.all([apiClient.GetSignals(), apiClient.GetSignalRules().catch(() => null)]);
      setReport(r);
      setRules(ru);
    } catch (err) {
      console.error('Failed to load signals:', err);
      setError(err instanceof Error ? err.message : '매매 신호를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  const ruleFor = (item: SignalItem): SignalRule | undefined =>
    rules?.overrides?.find((o) => o.asset_id === item.asset_id) ?? rules?.default;

  const items = report?.items ?? [];
  const visible = useMemo(() => (filter === 'all' ? items : items.filter((i) => i.action === filter)), [items, filter]);
  const summary = report?.summary;

  const stats: { label: string; value: number; tone: string }[] = [
    { label: '매도 신호', value: summary?.sell ?? 0, tone: 'text-rose-300' },
    { label: '매수 신호', value: summary?.buy ?? 0, tone: 'text-mint-300' },
    { label: '충돌', value: summary?.conflict ?? 0, tone: 'text-amber-300' },
    { label: '관망', value: summary?.hold ?? 0, tone: 'text-zinc-300' },
  ];

  const filterTone: Record<FilterValue, string> = {
    all: '',
    SELL: '!text-rose-300',
    BUY: '!text-mint-300',
    CONFLICT: '!text-amber-300',
    HOLD: '',
  };

  const handleSaved = () => {
    setEditor(null);
    load(false);
  };

  return (
    <div>
      <div className="mb-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <IconTile icon={Radar} tone="mint" />
          <div>
            <h1 className="text-2xl font-light tracking-tight text-white sm:text-3xl">매매 신호</h1>
            <p className="label-mono mt-0.5">규칙 기반 · 매도 / 매수 검토 알림</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost" disabled={!rules} onClick={() => setEditor({ mode: 'default' })}>
            <SlidersHorizontal className="h-4 w-4" />
            기본 전략
          </button>
          <button type="button" className="btn-icon !h-9 !w-9" onClick={() => load(false)} disabled={refreshing} aria-label="새로고침" title="새로고침">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <p className="mb-6 text-xs leading-relaxed text-zinc-500">
        설정한 규칙에 따른 알림이며 투자 권유가 아닙니다. 수익률은 배당·실현손익 포함, 현재 환율 원화 기준.
      </p>

      {error && (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-rose-200">
          <span className="text-sm">{error}</span>
          <button type="button" className="btn-ghost !py-1 !text-xs" onClick={() => load(true)}>다시 시도</button>
        </div>
      )}

      {loading ? (
        <Skeleton />
      ) : report ? (
        <>
          <div className="surface mb-6 flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-stretch gap-4 sm:gap-6">
              {stats.map((s, i) => (
                <div key={s.label} className="flex items-stretch gap-4 sm:gap-6">
                  {i > 0 && <span className="divider-v" />}
                  <div className="min-w-0">
                    <div className="label-mono whitespace-nowrap">{s.label}</div>
                    <CountUp value={s.value} format={(v) => String(Math.round(v))} className={`num mt-1 block text-3xl font-light ${s.tone}`} />
                  </div>
                </div>
              ))}
            </div>
            <div className="glass-pill flex self-start overflow-x-auto p-1 lg:self-auto" role="group" aria-label="신호 필터">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  className={`pill-item ${filter === f.value ? `pill-item-active ${filterTone[f.value]}` : ''}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {items.length === 0 ? (
            <div className="surface py-16 text-center">
              <p className="text-sm text-zinc-400">보유 중인 종목이 없어 계산할 신호가 없습니다.</p>
              <p className="label-mono mt-1">주식/ETF 탭에서 종목과 매수 내역을 등록해 보세요</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="surface py-16 text-center text-sm text-zinc-400">해당하는 신호가 없습니다.</div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {visible.map((item) => (
                <SignalCard key={item.asset_id} item={item} rule={ruleFor(item)} onEdit={() => rules && setEditor({ mode: 'asset', item })} />
              ))}
            </div>
          )}

          {summary && summary.no_price > 0 && (
            <p className="label-mono mt-4">시세를 가져오지 못한 종목 {summary.no_price}개는 전체 보기에서만 표시됩니다.</p>
          )}
        </>
      ) : null}

      {editor && rules && (
        <SignalRuleEditor
          mode={editor.mode}
          assetId={editor.mode === 'asset' ? editor.item.asset_id : undefined}
          assetName={editor.mode === 'asset' ? `${editor.item.name} (${editor.item.ticker})` : undefined}
          defaultRule={rules.default}
          assetRule={editor.mode === 'asset' ? rules.overrides?.find((o) => o.asset_id === editor.item.asset_id) ?? null : null}
          onClose={() => setEditor(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
