import type { HoldingCheck } from '../../types/models';
import BrokerLogo from '../ui/BrokerLogo';
import { accountDisplayName } from '../../utils/accountLabel';
import { dps } from './scoreText';

/** 계좌마다 최근 배당 기록으로 본 보유 수량 — 앱과 다르면 '확인'으로 고친다 (withTicker: 여러 종목을 함께 보일 때) */

const qty = (q: number) => q.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

const STATUS: Record<HoldingCheck['status'], { text: (c: HoldingCheck) => string; cls: string }> = {
  ok: { text: () => '맞음', cls: 'text-mint-300' },
  short: { text: (c) => `매수 ${qty(c.implied - c.app_qty)}주 빠진 듯`, cls: 'text-orange-300' },
  over: { text: (c) => `앱이 ${qty(c.app_qty - c.implied)}주 많음`, cls: 'text-orange-300' },
  gross: { text: () => '세전으로 기록한 듯', cls: 'text-orange-300' },
};

export default function HoldingCheckList({ items, withTicker, onFix }: { items: HoldingCheck[]; withTicker?: boolean; onFix: (c: HoldingCheck) => void }) {
  return (
    <div className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06]">
      {items.map((c) => {
        const st = STATUS[c.status];
        return (
          <div key={`${c.account_id}-${c.dividend_id}`} className="flex items-center gap-3 px-3 py-2">
            <BrokerLogo broker={c.account_broker} className="h-7 w-16 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2 text-[13px] text-zinc-100">
                {withTicker && <span className="shrink-0 font-medium">{/\.(KS|KQ)$/i.test(c.ticker) ? c.asset_name : c.ticker}</span>}
                <span className={`truncate ${withTicker ? 'text-[11.5px] text-zinc-400' : ''}`}>{accountDisplayName({ name: c.account_name, broker: c.account_broker })}</span>
              </span>
              <span className="num block truncate text-[11px] text-zinc-500">
                {c.status === 'gross'
                  ? `${shortDate(c.paid_on)} 배당 ${dps(c.amount, c.currency)} → 세후 ≈ ${dps(c.fixed_amount ?? 0, c.currency)}`
                  : `${shortDate(c.paid_on)} 배당으로 약 ${qty(c.implied)}주 · 앱 ${qty(c.app_qty)}주`}
              </span>
            </span>
            <span className={`shrink-0 text-right text-[11.5px] ${st.cls}`}>
              {st.text(c)}
              {c.recurring && <span className="block text-[10.5px] text-zinc-500">매달 늘고 있음</span>}
            </span>
            {c.status !== 'ok' && (
              <button type="button" className="btn-ghost shrink-0 !px-2.5 !py-1 !text-xs" onClick={() => onFix(c)}>
                확인
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
