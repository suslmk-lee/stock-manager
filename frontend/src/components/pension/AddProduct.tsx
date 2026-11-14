import { useState } from 'react';
import { apiClient } from '../../api/client';
import type { Asset } from '../../types/models';

/** 목록에 없는 펀드·국내 ETF 추가 — 부담금 배분 만들기·고치기와 추가 매수 기록에서 함께 쓴다 */

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : '추가하지 못했습니다.');

export default function AddProduct({ known, onAdded, onError, stacked }: { known: Asset[]; onAdded: (a: Asset) => void; onError: (msg: string | null) => void; stacked?: boolean }) {
  const [fundName, setFundName] = useState('');
  const [fundCode, setFundCode] = useState('');
  const [etfCode, setEtfCode] = useState('');
  const [adding, setAdding] = useState(false);

  const addFund = async () => {
    if (!fundName.trim()) return onError('펀드 이름을 넣어 주세요.');
    setAdding(true);
    onError(null);
    try {
      onAdded(await apiClient.CreateFund(fundName.trim(), fundCode.trim()));
      setFundName('');
      setFundCode('');
    } catch (e) {
      onError(errText(e));
    } finally {
      setAdding(false);
    }
  };

  const addEtf = async () => {
    const code = etfCode.trim().toUpperCase();
    if (!/^[0-9A-Z]{6}$/.test(code)) return onError('국내 ETF·주식 코드 6자리를 넣어 주세요 (예: 360750).');
    setAdding(true);
    onError(null);
    try {
      // 이미 있는 종목이면 그것을 (꼬리표 .KS·.KQ·없음과 상관없이 같은 코드면 같은 종목)
      const codeOf = (t: string) => t.trim().toUpperCase().replace(/\.(KS|KQ)$/, '');
      const existing = known.find((a) => codeOf(a.ticker) === code);
      if (existing) {
        // 꼬리표 없는 옛 기록이면 서버가 꼬리표를 붙여 돌려준다 (시세를 받을 수 있게)
        onAdded(/\.(KS|KQ)$/i.test(existing.ticker) ? existing : ((await apiClient.CreateAsset(`${code}.KS`, existing.name, existing.type, existing.sector ?? '', 0, 0, 0)) as Asset));
      } else {
        // 코스피(.KS)에서 먼저, 없으면 코스닥(.KQ)
        let found: { ticker: string; name: string } | null = null;
        for (const t of [`${code}.KS`, `${code}.KQ`]) {
          const info = (await apiClient.GetTickerInfo(t).catch(() => null)) as { name?: string } | null;
          if (info?.name) {
            found = { ticker: t, name: info.name };
            break;
          }
        }
        if (!found) throw new Error(`${code} 종목을 찾지 못했습니다.`);
        onAdded((await apiClient.CreateAsset(found.ticker, found.name, 'ETF', '', 0, 0, 0)) as Asset);
      }
      setEtfCode('');
    } catch (e) {
      onError(errText(e));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className={`grid grid-cols-1 gap-3 rounded-xl border border-dashed border-white/[0.1] p-3 ${stacked ? '' : 'sm:grid-cols-2'}`}>
      <div>
        <p className="label-mono mb-1.5">목록에 없는 펀드 추가</p>
        <div className="flex gap-2">
          <input className="input-field min-w-0 flex-1 !py-1.5 !text-xs" value={fundName} onChange={(e) => setFundName(e.target.value)} placeholder="펀드 이름" />
          <input className="input-field w-32 !py-1.5 !text-xs" value={fundCode} onChange={(e) => setFundCode(e.target.value)} placeholder="펀드코드 (선택)" />
          <button type="button" className="btn-ghost shrink-0 !px-2.5 !py-1 !text-xs" onClick={addFund} disabled={adding}>
            추가
          </button>
        </div>
      </div>
      <div>
        <p className="label-mono mb-1.5">목록에 없는 국내 ETF 추가</p>
        <div className="flex gap-2">
          <input className="input-field min-w-0 flex-1 !py-1.5 !text-xs" value={etfCode} onChange={(e) => setEtfCode(e.target.value)} placeholder="종목코드 6자리 (예: 360750)" />
          <button type="button" className="btn-ghost shrink-0 !px-2.5 !py-1 !text-xs" onClick={addEtf} disabled={adding}>
            찾아서 추가
          </button>
        </div>
      </div>
    </div>
  );
}
