import type { Asset, SignalItem, SignalRule } from '../../types/models';
import { RECOMMENDED_STRATEGIES, RecommendedStrategy } from './recommendedStrategies';

// 종목별 전략 추천 (프론트 전용, 순수 계산).
// 1) 종목의 성격(이름·티커·유형·섹터)과 지금 지표(배당수익률·변동성·추세·밸류에이션 이력)로 추천 전략마다 적합도를 매긴다.
// 2) 고른 전략의 기준값을 이 종목의 변동성에 맞추고, 이 종목에서 계산할 수 없는 조건은 끈다.

export interface FitReason {
  label: string;
  /** 지금 값 등 보충 설명 */
  detail?: string;
  met: boolean;
  /** 충족 시 더하는 점수 (음수 = 감점 요인) */
  points: number;
}

export interface StrategyFit {
  strategy: RecommendedStrategy;
  /** 적합도 0~100 */
  score: number;
  reasons: FitReason[];
}

export interface Tuning {
  label: string;
  detail: string;
}

export interface MarketFact {
  label: string;
  value: string;
  hint?: string;
}

export interface StrategyAdvice {
  /** 적합도 높은 순 (첫 번째가 추천) */
  fits: StrategyFit[];
  facts: MarketFact[];
  /** 판단에 필요한 자료가 빠져 정확도가 떨어지는 부분 */
  warnings: string[];
}

export interface TunedStrategy {
  patch: Partial<SignalRule>;
  tunings: Tuning[];
}

type AssetInfo = Pick<Asset, 'type' | 'sector'> | null | undefined;

// ---- 종목 성격 판별 ----

const COVERED_CALL_RE = /커버드\s?콜|covered\s?call|premium\s?income|프리미엄|buy-?write|타겟\s?위클리|option\s?income|옵션\s?인컴/i;
const COVERED_CALL_TICKERS = new Set([
  'JEPI', 'JEPQ', 'QYLD', 'XYLD', 'RYLD', 'DIVO', 'SPYI', 'QQQI', 'GPIX', 'GPIQ', 'SVOL', 'JEPY', 'ISPY', 'QDTE', 'XDTE', 'RDTE',
  'TSLY', 'NVDY', 'CONY', 'MSTY', 'YMAX', 'ULTY',
]);
// 한 종목을 기초로 하는 옵션 인컴 상품 (YieldMax 등). ULTY·YMAX 같은 여러 종목 묶음은 뺀다.
const SINGLE_OPTION_TICKERS = new Set([
  'TSLY', 'NVDY', 'CONY', 'MSTY', 'AMZY', 'APLY', 'GOOY', 'FBY', 'OARK', 'NFLY', 'MRNY', 'PLTY', 'AMDY', 'AIYY', 'YBIT',
  'DISO', 'SQY', 'PYPY', 'XOMO', 'JPMO', 'SMCY', 'MARO', 'BABO', 'CVNY', 'HOOY', 'ABNY', 'SNOY', 'TSMY', 'CRSH', 'GDXY', 'MSFO',
]);
const SINGLE_NAME_RE = /팔란티어|테슬라|엔비디아|애플|아마존|마이크로소프트|메타|알파벳|구글|코인베이스|스트래티지|브로드컴|넷플릭스|삼성전자|하이닉스|palantir|tesla|nvidia|apple|amazon|microsoft|alphabet|google|coinbase|microstrategy|broadcom|netflix|\b(COIN|TSLA|NVDA|PLTR|MSTR|AAPL|AMZN|MSFT|META|GOOGL|AMD|AVGO|NFLX)\b/i;
const DIVIDEND_RE = /배당|dividend|인컴|income|리츠|reit|고배당|high\s?yield|분배/i;
const DIVIDEND_TICKERS = new Set(['SCHD', 'VYM', 'DGRO', 'HDV', 'SPYD', 'NOBL', 'SDY', 'VIG', 'DVY', 'SCHY', 'VYMI', 'IDV', 'FDVV', 'DGRW', 'O', 'VNQ']);
const INCOME_SECTOR_RE = /real\s?estate|부동산|reit|리츠|utilit|유틸리티/i;
const INDEX_RE = /S&P\s?500|나스닥\s?100|nasdaq[\s-]?100|total\s?(stock\s?)?market|코스피\s?200|kospi\s?200|코스닥\s?150|kosdaq\s?150|msci|ftse|russell|러셀|다우\s?존스|dow\s?jones|nikkei|니케이|전세계|all[\s-]?world|선진국|이머징|emerging/i;
const INDEX_TICKERS = new Set([
  'VOO', 'SPY', 'IVV', 'SPLG', 'VTI', 'ITOT', 'SCHB', 'SCHX', 'QQQ', 'QQQM', 'VT', 'VEA', 'VWO', 'IWM', 'DIA', 'VUG', 'VTV', 'SCHG', 'RSP', 'IEFA', 'IEMG', 'ACWI',
]);
const ETF_NAME_RE = /\bETF\b|\bETN\b|^(KODEX|TIGER|ACE|SOL|RISE|KBSTAR|PLUS|HANARO|ARIRANG|KOSEF|TIMEFOLIO|KIWOOM|1Q|WON)\b|ishares|vanguard|spdr|invesco|proshares|direxion/i;
const GROWTH_SECTOR_RE = /tech|communication|consumer\s?(cyclical|discretionary)|기술|반도체|소프트웨어|인터넷|바이오|2차\s?전지|semiconductor|software/i;
// 국내 대표 지수 ETF: "KODEX 200", "TIGER 200" 등
const KR_INDEX_RE = /^(KODEX|TIGER|ACE|SOL|RISE|KBSTAR|PLUS|HANARO|ARIRANG|KOSEF)\s?200(\s|$)/i;

const bareTicker = (t: string) => t.toUpperCase().replace(/\.(KS|KQ)$/, '');
const isKoreanTicker = (t: string) => /\.(KS|KQ)$/i.test(t);

export interface AssetTraits {
  isEtf: boolean;
  coveredCall: boolean;
  /** 한 종목에 기대는 커버드콜·옵션 인컴 (CONY, 팔란티어커버드콜 등) */
  singleStockOption: boolean;
  dividendLike: boolean;
  index: boolean;
  growthSector: boolean;
}

export function traitsOf(item: Pick<SignalItem, 'ticker' | 'name'>, asset: AssetInfo): AssetTraits {
  const t = bareTicker(item.ticker);
  const text = `${item.name} ${item.ticker}`;
  const sector = asset?.sector ?? '';
  const coveredCall = COVERED_CALL_TICKERS.has(t) || SINGLE_OPTION_TICKERS.has(t) || COVERED_CALL_RE.test(text);
  const dividendLike = DIVIDEND_TICKERS.has(t) || DIVIDEND_RE.test(text) || INCOME_SECTOR_RE.test(sector);
  return {
    isEtf: asset?.type === 'ETF' || ETF_NAME_RE.test(item.name) || INDEX_TICKERS.has(t) || COVERED_CALL_TICKERS.has(t) || SINGLE_OPTION_TICKERS.has(t),
    coveredCall,
    singleStockOption: SINGLE_OPTION_TICKERS.has(t) || (coveredCall && SINGLE_NAME_RE.test(item.name)),
    dividendLike,
    // 배당·커버드콜 지수(예: 미국배당다우존스)는 지수 적립이 아니라 배당 전략으로 본다
    index: (INDEX_TICKERS.has(t) || INDEX_RE.test(item.name) || KR_INDEX_RE.test(item.name)) && !coveredCall && !dividendLike,
    growthSector: GROWTH_SECTOR_RE.test(sector),
  };
}

// ---- 지표 ----

const n = (v: number | undefined | null) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** 배당수익률 추정: 최근 12개월 받은 배당 기준과 24개월 평균 중 큰 값 (보유 기간이 짧으면 앞의 값이 작게 나온다) */
export function yieldOf(item: SignalItem): { pct: number; basis: string } {
  const cur = n(item.current_yield_pct);
  const avg = n(item.dividend_yield_avg_pct);
  if (avg > cur) return { pct: avg, basis: '최근 24개월 평균' };
  return { pct: cur, basis: '최근 12개월 받은 배당 기준' };
}

const pct = (v: number, digits = 1) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
const plain = (v: number, digits = 1) => `${v.toFixed(digits)}%`;

function holdingText(days: number): string {
  if (days <= 0) return '-';
  if (days < 60) return `${days}일`;
  const months = Math.round(days / 30.4);
  if (months < 12) return `${months}개월`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m ? `${y}년 ${m}개월` : `${y}년`;
}

function factsOf(item: SignalItem): MarketFact[] {
  const y = yieldOf(item);
  const vol = n(item.volatility_pct);
  const facts: MarketFact[] = [
    { label: '배당수익률', value: y.pct > 0 ? plain(y.pct, 2) : '없음', hint: y.pct > 0 ? y.basis : '받은 배당 기록이 없음' },
    { label: '연 변동성', value: vol > 0 ? plain(vol, 0) : '-', hint: vol > 0 ? (vol < 20 ? '낮음' : vol < 35 ? '보통' : '높음') : '시세 이력 부족' },
    { label: '52주 고점 대비', value: n(item.high_52w) > 0 ? pct(n(item.from_high_pct)) : '-' },
    { label: '200일선 대비', value: n(item.ma200) > 0 ? pct(n(item.vs_ma200_pct)) : '-' },
    { label: 'RSI', value: n(item.rsi) > 0 ? n(item.rsi).toFixed(0) : '-', hint: n(item.rsi) >= 70 ? '과열권' : n(item.rsi) > 0 && n(item.rsi) <= 30 ? '과매도권' : undefined },
  ];
  if (n(item.per) > 0) {
    facts.push({ label: 'PER', value: `${n(item.per).toFixed(1)}배`, hint: n(item.per_avg) > 0 ? `과거 평균 대비 ${pct(n(item.per_vs_avg_pct), 0)}` : '과거 평균 없음' });
  }
  if (item.dividend_trend_ok) {
    facts.push({ label: '주당 배당 변화', value: pct(n(item.dividend_change_pct)), hint: '최근 12개월 vs 직전 12개월' });
  }
  facts.push({ label: '보유 기간', value: holdingText(n(item.holding_days)), hint: `총수익률 ${pct(n(item.total_return_pct))}` });
  return facts;
}

// ---- 적합도 ----

function fit(strategyId: string, reasons: FitReason[]): StrategyFit {
  const strategy = RECOMMENDED_STRATEGIES.find((s) => s.id === strategyId)!;
  const raw = reasons.reduce((s, r) => s + (r.met ? r.points : 0), 0);
  return { strategy, score: Math.max(0, Math.min(100, raw)), reasons };
}

// 같은 점수면 더 구체적인 전략을 앞에 둔다
const SPECIFICITY = ['single-stock-option-income', 'covered-call-income', 'index-accumulate', 'dividend-hold', 'growth-short', 'general'];

export function adviseStrategy(item: SignalItem, asset?: AssetInfo): StrategyAdvice {
  const tr = traitsOf(item, asset);
  const y = yieldOf(item).pct;
  const vol = n(item.volatility_pct);
  const volKnown = vol > 0;
  const hasValuation = n(item.per_avg) > 0 || n(item.pbr_avg) > 0;
  const divChange = n(item.dividend_change_pct);
  const yText = y > 0 ? `현재 ${plain(y, 2)}` : '배당 없음';
  const volText = volKnown ? `현재 ${plain(vol, 0)}` : '시세 이력 부족으로 판단 못 함';
  // 이름으로 못 알아봐도 분배율이 30% 이상인 커버드콜은 한 종목 기초 상품으로 본다
  const singleOption = tr.singleStockOption || (tr.coveredCall && y >= 30);

  const fits: StrategyFit[] = [
    fit('single-stock-option-income', [
      {
        label: '한 종목에 기대는 커버드콜·옵션 인컴',
        detail: tr.singleStockOption ? 'YieldMax·개별 종목 커버드콜 (이름·티커 기준)' : `커버드콜인데 분배율이 ${plain(y, 0)}`,
        met: singleOption,
        points: 50,
      },
      { label: '분배율 15% 이상 (상당 부분이 원금 반환일 수 있음)', detail: yText, met: y >= 15, points: 25 },
      {
        label: '기초 종목 변동성 30% 이상 또는 분배율 50% 이상',
        detail: volKnown ? `변동성 ${plain(vol, 0)} · 분배율 ${plain(y, 0)}` : yText,
        met: vol >= 30 || y >= 50,
        points: 15,
      },
      { label: 'ETF', met: tr.isEtf, points: 10 },
    ]),
    fit('covered-call-income', [
      { label: '커버드콜·옵션 프리미엄 상품', detail: '이름·티커 기준', met: tr.coveredCall, points: 55 },
      { label: '분배율 7% 이상', detail: yText, met: y >= 7, points: 30 },
      { label: 'ETF', met: tr.isEtf, points: 15 },
      { label: '한 종목 기초 상품 (고분배 옵션 인컴 전략이 더 맞음)', met: singleOption, points: -30 },
    ]),
    fit('index-accumulate', [
      { label: '시장 지수를 따르는 ETF', detail: 'S&P 500·나스닥 100·코스피 200 등', met: tr.index, points: 60 },
      { label: 'ETF', met: tr.isEtf, points: 15 },
      { label: '변동성 30% 이하', detail: volText, met: volKnown && vol <= 30, points: 15 },
      { label: '배당보다 시세 성장 중심 (배당 3% 미만)', detail: yText, met: y < 3, points: 10 },
    ]),
    fit('dividend-hold', [
      y >= 3
        ? { label: '배당수익률 3% 이상', detail: yText, met: true, points: 30 }
        : { label: '배당수익률 2% 이상', detail: yText, met: y >= 2, points: 15 },
      { label: '배당·리츠 성격', detail: '이름·티커·섹터 기준', met: tr.dividendLike, points: 25 },
      { label: '주당 배당 유지·증가', detail: item.dividend_trend_ok ? `직전 12개월 대비 ${pct(divChange)}` : '비교할 배당 이력 부족', met: !!item.dividend_trend_ok && divChange >= -5, points: 20 },
      { label: '변동성 25% 이하', detail: volText, met: volKnown && vol <= 25, points: 15 },
      { label: '최근 12개월 배당 기록', met: n(item.dps_12m) > 0 || n(item.dividends_12m_krw) > 0, points: 10 },
      { label: '커버드콜 상품 (인컴 전략이 더 맞음)', met: tr.coveredCall, points: -30 },
      { label: '주당 배당 10% 이상 감소', detail: item.dividend_trend_ok ? pct(divChange) : undefined, met: !!item.dividend_trend_ok && divChange <= -10, points: -20 },
      { label: '변동성 40% 이상', detail: volText, met: vol >= 40, points: -15 },
    ]),
    fit('growth-short', [
      vol >= 35
        ? { label: '변동성 35% 이상', detail: volText, met: true, points: 35 }
        : { label: '변동성 25% 이상', detail: volText, met: vol >= 25, points: 15 },
      { label: '배당이 거의 없음 (1% 미만)', detail: yText, met: y < 1, points: 20 },
      { label: '개별 주식', met: !tr.isEtf, points: 15 },
      { label: '성장 업종', detail: asset?.sector || '섹터 정보 없음', met: tr.growthSector, points: 15 },
      { label: '200일선 위 상승 추세', detail: n(item.ma200) > 0 ? `200일선 대비 ${pct(n(item.vs_ma200_pct))}` : '시세 이력 부족', met: n(item.ma200) > 0 && n(item.vs_ma200_pct) > 0, points: 15 },
      { label: '배당·커버드콜 성격', met: tr.dividendLike || tr.coveredCall, points: -20 },
    ]),
    fit('general', [
      { label: '개별 주식', met: !tr.isEtf, points: 25 },
      { label: 'PER·PBR 과거 평균 있음 (저평가·고평가 조건 사용 가능)', met: hasValuation, points: 25 },
      { label: '변동성 보통 (15~40%)', detail: volText, met: volKnown && vol >= 15 && vol <= 40, points: 20 },
      { label: '배당수익률 3% 미만', detail: yText, met: y < 3, points: 15 },
      { label: '뚜렷한 성격이 없을 때 쓰는 기본 전략', met: true, points: 15 },
    ]),
  ];

  fits.sort((a, b) => b.score - a.score || SPECIFICITY.indexOf(a.strategy.id) - SPECIFICITY.indexOf(b.strategy.id));

  const warnings: string[] = [];
  if (!item.price_history_ok || !volKnown) warnings.push('시세 이력이 부족해 변동성·추세 기준은 판단하지 못했습니다.');
  if (y <= 0 && n(item.holding_days) < 365) warnings.push('보유 기간이 1년이 안 돼 배당수익률이 실제보다 낮게 잡혔을 수 있습니다.');
  if (!asset) warnings.push('종목 유형·섹터 정보를 불러오지 못해 이름과 티커로만 판단했습니다.');

  return { fits, facts: factsOf(item), warnings };
}

// ---- 이 종목에 맞춘 기준값 ----

const BUY_KEYS = [
  'buy_dip_enabled', 'last_buy_dip_enabled', 'high_yield_enabled', 'yield_expansion_enabled', 'vol_oversold_enabled',
  'below_ma_enabled', 'from_high_enabled', 'rsi_buy_enabled', 'mfi_buy_enabled', 'per_buy_enabled', 'pbr_buy_enabled',
  'per_avg_buy_enabled', 'pbr_avg_buy_enabled',
] as const satisfies readonly (keyof SignalRule)[];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 전략 기준값을 이 종목에 맞춘다.
 *  - 변동성이 있으면 하락·되돌림 폭을 변동성에 비례하게 (변동성이 큰 종목은 더 넓게)
 *  - 이 종목에서 계산할 수 없는 조건(PER 이력이 없는 ETF의 PER 조건 등)은 끈다
 * base 는 전략을 덮어쓸 원래 규칙 (전략에 없는 기준값은 여기서 온다)
 */
export function tuneStrategy(strategy: RecommendedStrategy, item: SignalItem, base?: SignalRule): TunedStrategy {
  const patch: Partial<SignalRule> = { ...strategy.patch };
  const p = patch as Record<string, unknown>;
  const b = (base ?? {}) as unknown as Record<string, unknown>;
  const tunings: Tuning[] = [];
  const vol = n(item.volatility_pct);
  const volNote = `연 변동성 ${plain(vol, 0)} 기준`;

  const scale = (enabledKey: keyof SignalRule, key: keyof SignalRule, label: string, value: number, unit = '%') => {
    if (!p[enabledKey]) return;
    const before = Number(p[key] ?? b[key] ?? 0);
    if (before === value) return;
    p[key] = value;
    tunings.push({ label, detail: `${before}${unit} → ${value}${unit} (${volNote})` });
  };

  if (vol > 0) {
    scale('trailing_enabled', 'trailing_drop_pct', '고점 대비 되돌림 (익절)', -clamp(Math.round(vol * 0.4), 6, 20));
    scale('trailing_enabled', 'trailing_activate_pct', '되돌림 감시 시작 수익률', clamp(Math.round(vol * 0.6), 10, 40));
    scale('short_drop_enabled', 'short_drop_pct', '단기 급락 기준', -clamp(Math.round(vol * 0.45), 8, 30));
    scale('from_high_enabled', 'from_high_pct', '52주 고점 대비 하락 (매수)', -clamp(Math.round(vol * 0.6), 8, 35));
    scale('last_buy_dip_enabled', 'last_buy_dip_pct', '마지막 매수가 대비 하락 (매수)', -clamp(Math.round(vol * 0.35), 5, 20));
    scale('crash_enabled', 'crash_pct', '큰 폭락 경고', -clamp(Math.round(vol * 2), 30, 50));
    scale('stop_loss_enabled', 'stop_loss_pct', '손절 (분배금 포함 총수익률)', -clamp(Math.round(vol * 0.4), 15, 30));
  }

  const off = (keys: (keyof SignalRule)[], label: string, why: string) => {
    const on = keys.filter((k) => p[k]);
    if (on.length === 0) return;
    on.forEach((k) => (p[k] = false));
    tunings.push({ label: `${label} 끔`, detail: why });
  };
  if (!(n(item.per_avg) > 0)) off(['per_avg_buy_enabled', 'per_avg_sell_enabled'], 'PER 평균 대비 조건', 'PER 과거 평균이 없어 계산할 수 없음');
  if (!(n(item.pbr_avg) > 0)) off(['pbr_avg_buy_enabled', 'pbr_avg_sell_enabled'], 'PBR 평균 대비 조건', 'PBR 과거 평균이 없어 계산할 수 없음');
  if (!(n(item.mfi) > 0)) off(['mfi_buy_enabled', 'mfi_sell_enabled'], 'MFI 조건', '거래량 자료가 없어 MFI를 계산할 수 없음');
  if (!(n(item.dividend_yield_avg_pct) > 0)) {
    off(['yield_expansion_enabled', 'yield_compression_enabled'], '배당수익률 확대·압축 조건', '배당수익률 평균 이력이 없음');
  }
  if (!(n(item.dps_12m) > 0) && !(n(item.dividends_12m_krw) > 0)) off(['dividend_cut_enabled'], '배당 삭감 조건', '최근 12개월 배당이 없음');

  // 매수를 "N개 이상 충족" 으로 두는데 켜진 조건이 그보다 적으면 맞춰 준다 (엔진도 같은 방식으로 줄여 판단한다)
  if (patch.buy_mode === 'count') {
    const on = BUY_KEYS.filter((k) => p[k]).length;
    const need = Number(patch.buy_min_count ?? 1);
    if (on > 0 && need > on) {
      patch.buy_min_count = on;
      tunings.push({ label: '매수 충족 개수', detail: `${need}개 이상 → ${on}개 이상 (켜진 매수 조건이 ${on}개)` });
    }
  }

  return { patch, tunings };
}

// ---- 저장용 이름 ----

/** 프로필 이름 제안: "SCHD 맞춤 · 배당 장기보유" (국내 종목은 종목명, 30자 이내) */
export function suggestProfileName(item: Pick<SignalItem, 'ticker' | 'name'>, strategy: RecommendedStrategy, taken: string[] = []): string {
  const who = isKoreanTicker(item.ticker) ? item.name.slice(0, 12).trim() : bareTicker(item.ticker);
  const base = `${who} 맞춤 · ${strategy.short}`.slice(0, 28);
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 100; i++) {
    const cand = `${base} ${i}`;
    if (!taken.includes(cand)) return cand;
  }
  return base;
}

export function suggestProfileDescription(item: SignalItem, now = new Date()): string {
  const y = yieldOf(item).pct;
  const vol = n(item.volatility_pct);
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const parts = [`${bareTicker(item.ticker)} 지표로 추천 (${date})`];
  if (vol > 0) parts.push(`변동성 ${plain(vol, 0)}`);
  if (y > 0) parts.push(`배당 ${plain(y, 1)}`);
  return parts.join(' · ');
}
