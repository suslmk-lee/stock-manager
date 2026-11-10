import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Info } from 'lucide-react';
import { apiClient } from '../../api/client';
import { RECOMMENDED_STRATEGIES, RecommendedStrategy, applyRecommended } from './recommendedStrategies';
import { BelowMaMode, BuyQtyMode, FromHighMode, SignalMode, SignalProfile, SignalRule } from '../../types/models';

type NumKey =
  | 'take_profit_pct'
  | 'stop_loss_pct'
  | 'target_weight_pct'
  | 'weight_band_pct'
  | 'dividend_payback_pct'
  | 'dividend_payback_min_return_pct'
  | 'low_yield_pct'
  | 'buy_dip_pct'
  | 'high_yield_pct'
  | 'from_high_pct'
  | 'below_ma_pct'
  | 'above_ma_pct'
  | 'dividend_cut_pct'
  | 'crash_pct'
  | 'min_sell_qty'
  | 'trailing_activate_pct'
  | 'trailing_drop_pct'
  | 'annualized_pct'
  | 'annualized_min_days'
  | 'annualized_min_return_pct'
  | 'drift_pct'
  | 'partial_pct'
  | 'yield_compression_pct'
  | 'vol_overheat_sigma'
  | 'vol_oversold_sigma'
  | 'last_buy_dip_pct'
  | 'buy_cooldown_days'
  | 'buy_max_weight_pct'
  | 'buy_qty_amount_krw'
  | 'buy_qty_lower_avg_pct'
  | 'vol_stop_k'
  | 'rebound_from_low_pct'
  | 'rebound_lookback_days'
  | 'yield_expansion_pct'
  | 'time_stop_days'
  | 'time_stop_max_return_pct'
  | 'short_drop_days'
  | 'short_drop_pct'
  | 'below_ma_lookback_days'
  | 'below_ma_max_above_pct'
  | 'below_ma_reclaim_days'
  | 'from_high_lookback_days'
  | 'from_high_rebound_pct'
  | 'from_high_still_below_pct'
  | 'rsi_period'
  | 'mfi_period'
  | 'osc_lookback_days'
  | 'rsi_buy_level'
  | 'rsi_sell_level'
  | 'mfi_buy_level'
  | 'mfi_sell_level'
  | 'per_buy_max'
  | 'per_sell_min'
  | 'pbr_buy_max'
  | 'pbr_sell_min'
  | 'valuation_window_months'
  | 'per_avg_buy_pct'
  | 'per_avg_sell_pct'
  | 'pbr_avg_buy_pct'
  | 'pbr_avg_sell_pct';

type EnableKey =
  | 'from_high_enabled'
  | 'below_ma_enabled'
  | 'above_ma_enabled'
  | 'dividend_cut_enabled'
  | 'crash_enabled'
  | 'min_sell_qty_enabled'
  | 'trailing_enabled'
  | 'annualized_enabled'
  | 'drift_enabled'
  | 'partial_enabled'
  | 'tax_harvest_enabled'
  | 'fx_historical'
  | 'take_profit_enabled'
  | 'stop_loss_enabled'
  | 'weight_enabled'
  | 'dividend_payback_enabled'
  | 'low_yield_enabled'
  | 'buy_dip_enabled'
  | 'high_yield_enabled'
  | 'yield_compression_enabled'
  | 'vol_overheat_enabled'
  | 'vol_oversold_enabled'
  | 'last_buy_dip_enabled'
  | 'buy_cooldown_enabled'
  | 'buy_max_weight_enabled'
  | 'buy_qty_enabled'
  | 'vol_stop_enabled'
  | 'rebound_confirm_enabled'
  | 'rebound_ma_enabled'
  | 'yield_expansion_enabled'
  | 'time_stop_enabled'
  | 'short_drop_enabled'
  | 'rsi_buy_enabled'
  | 'rsi_sell_enabled'
  | 'mfi_buy_enabled'
  | 'mfi_sell_enabled'
  | 'per_buy_enabled'
  | 'per_sell_enabled'
  | 'pbr_buy_enabled'
  | 'pbr_sell_enabled'
  | 'per_avg_buy_enabled'
  | 'per_avg_sell_enabled'
  | 'pbr_avg_buy_enabled'
  | 'pbr_avg_sell_enabled';

interface FieldDef {
  key: NumKey;
  label: string;
  suffix: string;
}

interface RuleDef {
  enabled: EnableKey;
  label: string;
  desc: string;
  fields: FieldDef[];
  note?: string;
}

// 수익 실현 조건
const SELL_PROFIT_RULES: RuleDef[] = [
  { enabled: 'take_profit_enabled', label: '목표 수익률 도달', desc: '실질 수익률이 목표 이상이면 이익 실현을 검토합니다.', fields: [{ key: 'take_profit_pct', label: '목표', suffix: '%' }] },
  {
    enabled: 'trailing_enabled',
    label: '고점 대비 되돌림 (추적 익절)',
    desc: '수익률이 활성 기준을 넘은 뒤 매수 이후 최고가에서 기준만큼 떨어지면 매도를 검토합니다. 오르는 동안에는 신호를 내지 않습니다.',
    fields: [
      { key: 'trailing_activate_pct', label: '활성 수익률', suffix: '%' },
      { key: 'trailing_drop_pct', label: '고점 대비', suffix: '%' },
    ],
  },
  {
    enabled: 'annualized_enabled',
    label: '연환산 수익률',
    desc: '보유 기간으로 환산한 연 수익률이 기준 이상이면 매도를 검토합니다. 짧은 기간의 일시적 급등을 거르기 위해 최소 보유 일수와 최소 수익률을 함께 봅니다.',
    fields: [
      { key: 'annualized_pct', label: '연 수익률', suffix: '%' },
      { key: 'annualized_min_days', label: '최소 보유', suffix: '일' },
      { key: 'annualized_min_return_pct', label: '최소 수익률', suffix: '%' },
    ],
  },
  {
    enabled: 'drift_enabled',
    label: '비중 쏠림',
    desc: '시세 상승으로 현재 비중이 투자 원금 비중보다 기준 이상 커지면 일부 매도(리밸런싱)를 검토합니다.',
    fields: [{ key: 'drift_pct', label: '원금 비중 대비', suffix: '%p' }],
  },
  {
    enabled: 'yield_compression_enabled',
    label: '배당수익률 압축',
    desc: '현재 배당수익률이 이 종목의 최근 24개월 평균보다 기준 이상 낮으면, 배당보다 주가가 앞서 오른 것으로 보고 매도(일부 익절)를 검토합니다. 배당 이력이 6개월 이상 있어야 계산합니다.',
    fields: [{ key: 'yield_compression_pct', label: '평균 대비', suffix: '% 낮음' }],
  },
  {
    enabled: 'vol_overheat_enabled',
    label: '변동성 대비 과열',
    desc: '200일 이동평균선과의 괴리를 종목 자신의 연 변동성으로 나눠 판단합니다. 변동성이 큰 기술주와 잔잔한 ETF를 같은 잣대(σ)로 비교할 수 있어, 고정 %를 쓰는 장기 이평 과열 조건을 대신해 쓸 수 있습니다.',
    fields: [{ key: 'vol_overheat_sigma', label: '200일선 대비', suffix: 'σ 이상' }],
  },
  {
    enabled: 'rsi_sell_enabled',
    label: 'RSI 과열',
    desc: '최근 14일 상승·하락 폭으로 계산한 상대강도지수입니다. 70 이상이면 단기 과열로 보고 이익 실현을 검토합니다. 계산 기간은 기타 섹션의 지표 계산에서 바꿀 수 있습니다.',
    fields: [{ key: 'rsi_sell_level', label: 'RSI', suffix: '이상' }],
  },
  {
    enabled: 'mfi_sell_enabled',
    label: 'MFI 과열',
    desc: '가격과 거래량을 함께 반영한 자금흐름지수입니다. 80 이상이면 자금이 과도하게 몰린 것으로 보고 이익 실현을 검토합니다. 거래량이 없는 종목은 건너뜁니다.',
    fields: [{ key: 'mfi_sell_level', label: 'MFI', suffix: '이상' }],
  },
  {
    enabled: 'per_sell_enabled',
    label: 'PER 고평가',
    desc: '주가수익비율(PER)이 기준 이상이면 고평가로 보고 이익 실현을 검토합니다. ETF 등 PER 값이 없는 종목은 건너뜁니다. 업종마다 적정 PER이 달라, 종목 간 비교에는 \'평균 대비\' 조건이 보통 더 적합합니다. 데이터는 국내 종목은 네이버, 해외 종목은 Yahoo 기준입니다.',
    fields: [{ key: 'per_sell_min', label: 'PER', suffix: '배 이상' }],
  },
  {
    enabled: 'pbr_sell_enabled',
    label: 'PBR 고평가',
    desc: '주가순자산비율(PBR)이 기준 이상이면 고평가로 보고 이익 실현을 검토합니다. ETF 등 PBR 값이 없는 종목은 건너뜁니다. 업종마다 적정 PBR이 달라, 종목 간 비교에는 \'평균 대비\' 조건이 보통 더 적합합니다. 데이터는 국내 종목은 네이버, 해외 종목은 Yahoo 기준입니다.',
    fields: [{ key: 'pbr_sell_min', label: 'PBR', suffix: '배 이상' }],
  },
  {
    enabled: 'per_avg_sell_enabled',
    label: 'PER 평균 대비 고평가',
    desc: '현재 PER이 이 종목의 최근 {N}개월 평균보다 기준 이상 높으면 고평가로 보고 이익 실현을 검토합니다. 과거 실적(EPS·BPS)과 월말 주가로 계산하며, 적자 구간과 ETF는 제외됩니다.',
    fields: [{ key: 'per_avg_sell_pct', label: '평균보다', suffix: '% 이상 높음' }],
  },
  {
    enabled: 'pbr_avg_sell_enabled',
    label: 'PBR 평균 대비 고평가',
    desc: '현재 PBR이 이 종목의 최근 {N}개월 평균보다 기준 이상 높으면 고평가로 보고 이익 실현을 검토합니다. 과거 실적(EPS·BPS)과 월말 주가로 계산하며, 적자 구간과 ETF는 제외됩니다.',
    fields: [{ key: 'pbr_avg_sell_pct', label: '평균보다', suffix: '% 이상 높음' }],
  },
];

// 위험 관리 조건
const SELL_RISK_RULES: RuleDef[] = [
  { enabled: 'stop_loss_enabled', label: '손절 기준', desc: '실질 수익률이 기준 이하로 내려가면 손절을 검토합니다.', fields: [{ key: 'stop_loss_pct', label: '기준', suffix: '%' }] },
  {
    enabled: 'vol_stop_enabled',
    label: '변동성 기준 손절',
    desc: '실질 수익률이 종목 연 변동성의 k배만큼 손실이면 손절을 검토합니다. 변동성 연 40%인 종목은 1배일 때 −40%, 연 12%면 −12%가 기준이 됩니다. 고정 % 손절 대신 쓸 수 있습니다.',
    fields: [{ key: 'vol_stop_k', label: '변동성의', suffix: '배' }],
  },
  { enabled: 'crash_enabled', label: '큰 폭락 경고', desc: '실질 수익률이 기준 이하로 폭락하면 경고합니다. 손절 대신 쓰는 장기보유용 안전장치입니다.', fields: [{ key: 'crash_pct', label: '기준', suffix: '%' }] },
  {
    enabled: 'weight_enabled',
    label: '목표 비중 이탈',
    desc: '포트폴리오 내 비중이 목표 + 허용 범위를 넘으면 매도, 목표 - 허용 범위 아래면 매수 조건이 됩니다.',
    fields: [
      { key: 'target_weight_pct', label: '목표 비중', suffix: '%' },
      { key: 'weight_band_pct', label: '허용 범위', suffix: '%p' },
    ],
    note: '종목별 전략에서만 의미 있음',
  },
  {
    enabled: 'dividend_payback_enabled',
    label: '배당 회수율 달성',
    desc: '누적 배당이 투자 원금의 일정 비율을 회수하고, 최소 수익률도 넘으면 매도를 검토합니다.',
    fields: [
      { key: 'dividend_payback_pct', label: '회수율', suffix: '%' },
      { key: 'dividend_payback_min_return_pct', label: '최소 수익률', suffix: '%' },
    ],
  },
  { enabled: 'low_yield_enabled', label: '배당수익률 하락', desc: '현재가 기준 배당수익률이 기준 이하이면 매도를 검토합니다.', fields: [{ key: 'low_yield_pct', label: '기준', suffix: '%' }] },
  { enabled: 'above_ma_enabled', label: '장기 이평 과열', desc: '현재가가 200일 이동평균선보다 기준 이상 높으면 과열로 보고 매도를 검토합니다.', fields: [{ key: 'above_ma_pct', label: '괴리율', suffix: '%' }] },
  {
    enabled: 'time_stop_enabled',
    label: '시간 손절',
    desc: '평균 보유 기간이 기준 이상인데 배당 포함 실질 수익률이 기준 이하이면, 자금이 묶여 있다고 보고 정리를 검토합니다.',
    fields: [
      { key: 'time_stop_days', label: '보유', suffix: '일 이상' },
      { key: 'time_stop_max_return_pct', label: '수익률', suffix: '% 이하' },
    ],
  },
  {
    enabled: 'short_drop_enabled',
    label: '단기 급락',
    desc: '최근 N거래일 동안 기준 이상 급락하면 경고합니다. 평단 대비로 보는 큰 폭락 경고와 달리, 이미 많이 오른 종목의 급락도 바로 잡습니다.',
    fields: [
      { key: 'short_drop_days', label: '최근', suffix: '거래일' },
      { key: 'short_drop_pct', label: '변화율', suffix: '% 이하' },
    ],
  },
  { enabled: 'dividend_cut_enabled', label: '배당 삭감', desc: '주당배당금이 직전 12개월 대비 기준(%) 이상 줄면 매도를 검토합니다.', fields: [{ key: 'dividend_cut_pct', label: '감소율', suffix: '%' }] },
];

// 매도 제외 조건: 충족되면 위 매도 조건이 맞아도 매도 검토에서 뺀다
const SELL_EXCLUDE_RULES: RuleDef[] = [
  {
    enabled: 'min_sell_qty_enabled',
    label: '소량 보유 매도 제외',
    desc: '보유 수량(모든 계좌 합계)이 기준 이하이면 매도 조건을 충족해도 매도 검토에서 제외합니다. 소수점 수량도 포함됩니다.',
    fields: [{ key: 'min_sell_qty', label: '기준', suffix: '주 이하' }],
  },
];

// 매도 수량 제안
const SELL_QTY_RULES: RuleDef[] = [
  {
    enabled: 'partial_enabled',
    label: '분할 익절',
    desc: '수익 실현 신호일 때 전량 대신 일부 매도 수량을 제안합니다. 비중 쏠림이면 원금 비중으로 되돌리는 수량을 제안합니다. 손절·위험 신호는 전량 검토로 표시합니다.',
    fields: [{ key: 'partial_pct', label: '보유 수량의', suffix: '%' }],
  },
];

// 매수 제외 조건 (신호 개수에 세지 않는다): 해당하면 매수 신호를 버린다
const BUY_EXCLUDE_RULES: RuleDef[] = [
  {
    enabled: 'buy_cooldown_enabled',
    label: '매수 쿨다운',
    desc: '최근 매수한 지 기준 일수 이내이면 매수 조건을 충족해도 매수 검토에서 제외합니다. 개수 조건에는 포함되지 않습니다.',
    fields: [{ key: 'buy_cooldown_days', label: '최근 매수', suffix: '일 이내 매수 시' }],
  },
  {
    enabled: 'buy_max_weight_enabled',
    label: '비중 상한',
    desc: '종목 비중이 상한 이상이면 매수 조건을 충족해도 매수 검토에서 제외합니다. 개수 조건에는 포함되지 않습니다.',
    fields: [{ key: 'buy_max_weight_pct', label: '비중', suffix: '% 이상이면' }],
  },
];

const BUY_RULES: RuleDef[] = [
  {
    enabled: 'last_buy_dip_enabled',
    label: '마지막 매수가 대비 하락',
    desc: '가장 최근 매수가보다 기준 이상 떨어지면 다음 매수를 검토합니다. 한 번 사면 기준점이 그 가격으로 내려가 같은 신호가 반복되지 않고 자연스럽게 나눠 사게 됩니다.',
    fields: [{ key: 'last_buy_dip_pct', label: '마지막 매수가 대비', suffix: '%' }],
  },
  { enabled: 'buy_dip_enabled', label: '평단 대비 하락', desc: '현재가가 평단보다 기준 이상 낮으면 추가 매수를 검토합니다.', fields: [{ key: 'buy_dip_pct', label: '기준', suffix: '%' }] },
  { enabled: 'high_yield_enabled', label: '배당수익률 상승', desc: '현재가 기준 배당수익률이 기준 이상이면 매수를 검토합니다.', fields: [{ key: 'high_yield_pct', label: '기준', suffix: '%' }] },
  {
    enabled: 'yield_expansion_enabled',
    label: '배당수익률 확대',
    desc: '현재 배당수익률이 이 종목의 최근 24개월 평균보다 기준 이상 높으면, 배당 대비 주가가 싸진 것으로 보고 매수를 검토합니다. 배당 이력이 6개월 이상 있어야 계산합니다.',
    fields: [{ key: 'yield_expansion_pct', label: '평균 대비', suffix: '% 높음' }],
  },
  { enabled: 'from_high_enabled', label: '52주 고점 대비 하락', desc: '52주 최고가 대비 하락 후 반등을 확인하면 매수를 검토합니다.', fields: [{ key: 'from_high_pct', label: '기준', suffix: '%' }] },
  { enabled: 'below_ma_enabled', label: '장기 이평 하회', desc: '200일 이동평균선 아래로 크게 내려갔다가 되돌아오는 시점에 매수를 검토합니다.', fields: [{ key: 'below_ma_pct', label: '기준', suffix: '%' }] },
  {
    enabled: 'vol_oversold_enabled',
    label: '변동성 대비 과매도',
    desc: '200일 이동평균선과의 괴리를 종목 자신의 연 변동성으로 나눠 판단합니다. 양수로 입력하며 −σ 이하(예: 1.5 → −1.5σ)일 때 매수를 검토합니다. 고정 %를 쓰는 장기 이평 하회 조건을 대신해 쓸 수 있습니다.',
    fields: [{ key: 'vol_oversold_sigma', label: '200일선 대비', suffix: 'σ 이하' }],
  },
  {
    enabled: 'rsi_buy_enabled',
    label: 'RSI 과매도 반등',
    desc: '최근 확인 기간 안에 RSI가 기준 이하로 내려갔다가 지금은 기준 위로 되돌아오면 매수를 검토합니다. 확인 기간과 RSI 계산 기간은 기타 섹션에서 바꿀 수 있습니다.',
    fields: [{ key: 'rsi_buy_level', label: 'RSI', suffix: '이하에서 반등' }],
  },
  {
    enabled: 'mfi_buy_enabled',
    label: 'MFI 과매도 반등',
    desc: '최근 확인 기간 안에 MFI(가격·거래량 기반 자금흐름지수)가 기준 이하로 내려갔다가 지금은 기준 위로 되돌아오면 매수를 검토합니다. 거래량이 없는 종목은 건너뜁니다.',
    fields: [{ key: 'mfi_buy_level', label: 'MFI', suffix: '이하에서 반등' }],
  },
  {
    enabled: 'per_buy_enabled',
    label: 'PER 저평가',
    desc: '주가수익비율(PER)이 기준 이하이면 저평가로 보고 매수를 검토합니다. ETF 등 PER 값이 없는 종목은 건너뜁니다. 업종마다 적정 PER이 달라, 종목 간 비교에는 \'평균 대비\' 조건이 보통 더 적합합니다. 데이터는 국내 종목은 네이버, 해외 종목은 Yahoo 기준입니다.',
    fields: [{ key: 'per_buy_max', label: 'PER', suffix: '배 이하' }],
  },
  {
    enabled: 'pbr_buy_enabled',
    label: 'PBR 저평가',
    desc: '주가순자산비율(PBR)이 기준 이하이면 저평가로 보고 매수를 검토합니다. ETF 등 PBR 값이 없는 종목은 건너뜁니다. 업종마다 적정 PBR이 달라, 종목 간 비교에는 \'평균 대비\' 조건이 보통 더 적합합니다. 데이터는 국내 종목은 네이버, 해외 종목은 Yahoo 기준입니다.',
    fields: [{ key: 'pbr_buy_max', label: 'PBR', suffix: '배 이하' }],
  },
  {
    enabled: 'per_avg_buy_enabled',
    label: 'PER 평균 대비 저평가',
    desc: '현재 PER이 이 종목의 최근 {N}개월 평균보다 기준 이상 낮으면 저평가로 보고 매수를 검토합니다. 과거 실적(EPS·BPS)과 월말 주가로 계산하며, 적자 구간과 ETF는 제외됩니다.',
    fields: [{ key: 'per_avg_buy_pct', label: '평균보다', suffix: '% 이상 낮음' }],
  },
  {
    enabled: 'pbr_avg_buy_enabled',
    label: 'PBR 평균 대비 저평가',
    desc: '현재 PBR이 이 종목의 최근 {N}개월 평균보다 기준 이상 낮으면 저평가로 보고 매수를 검토합니다. 과거 실적(EPS·BPS)과 월말 주가로 계산하며, 적자 구간과 ETF는 제외됩니다.',
    fields: [{ key: 'pbr_avg_buy_pct', label: '평균보다', suffix: '% 이상 낮음' }],
  },
];

const NUM_KEYS: NumKey[] = [
  'take_profit_pct', 'stop_loss_pct', 'target_weight_pct', 'weight_band_pct', 'dividend_payback_pct',
  'dividend_payback_min_return_pct', 'low_yield_pct', 'buy_dip_pct', 'high_yield_pct',
  'from_high_pct', 'below_ma_pct', 'above_ma_pct', 'dividend_cut_pct', 'crash_pct', 'min_sell_qty',
  'trailing_activate_pct', 'trailing_drop_pct', 'annualized_pct', 'annualized_min_days', 'annualized_min_return_pct', 'drift_pct', 'partial_pct',
  'yield_compression_pct', 'vol_overheat_sigma', 'vol_oversold_sigma',
  'last_buy_dip_pct', 'buy_cooldown_days', 'buy_max_weight_pct', 'buy_qty_amount_krw', 'buy_qty_lower_avg_pct', 'vol_stop_k',
  'rebound_from_low_pct', 'rebound_lookback_days', 'yield_expansion_pct', 'time_stop_days', 'time_stop_max_return_pct', 'short_drop_days', 'short_drop_pct',
  'below_ma_lookback_days', 'below_ma_max_above_pct', 'below_ma_reclaim_days', 'from_high_lookback_days', 'from_high_rebound_pct', 'from_high_still_below_pct',
  'rsi_period', 'mfi_period', 'osc_lookback_days', 'rsi_buy_level', 'rsi_sell_level', 'mfi_buy_level', 'mfi_sell_level',
  'per_buy_max', 'per_sell_min', 'pbr_buy_max', 'pbr_sell_min',
  'valuation_window_months', 'per_avg_buy_pct', 'per_avg_sell_pct', 'pbr_avg_buy_pct', 'pbr_avg_sell_pct',
];
const ENABLE_KEYS: EnableKey[] = [
  'take_profit_enabled', 'stop_loss_enabled', 'weight_enabled', 'dividend_payback_enabled',
  'low_yield_enabled', 'buy_dip_enabled', 'high_yield_enabled',
  'from_high_enabled', 'below_ma_enabled', 'above_ma_enabled', 'dividend_cut_enabled', 'crash_enabled',
  'tax_harvest_enabled', 'fx_historical', 'min_sell_qty_enabled',
  'trailing_enabled', 'annualized_enabled', 'drift_enabled', 'partial_enabled',
  'yield_compression_enabled', 'vol_overheat_enabled', 'vol_oversold_enabled',
  'last_buy_dip_enabled', 'buy_cooldown_enabled', 'buy_max_weight_enabled', 'buy_qty_enabled', 'vol_stop_enabled',
  'rebound_confirm_enabled', 'rebound_ma_enabled', 'yield_expansion_enabled', 'time_stop_enabled', 'short_drop_enabled',
  'rsi_buy_enabled', 'rsi_sell_enabled', 'mfi_buy_enabled', 'mfi_sell_enabled', 'per_buy_enabled', 'per_sell_enabled', 'pbr_buy_enabled', 'pbr_sell_enabled',
  'per_avg_buy_enabled', 'per_avg_sell_enabled', 'pbr_avg_buy_enabled', 'pbr_avg_sell_enabled',
];

// 2단계 필드 기본값 (구 백엔드가 내려주지 않을 때 균형 값으로 채움)
const NEW_NUM_DEFAULTS: Partial<Record<NumKey, number>> = { from_high_pct: -20, below_ma_pct: -5, above_ma_pct: 25, dividend_cut_pct: 10, crash_pct: -40, min_sell_qty: 1,
  trailing_activate_pct: 20, trailing_drop_pct: -10, annualized_pct: 25, annualized_min_days: 90, annualized_min_return_pct: 15, drift_pct: 7, partial_pct: 33,
  yield_compression_pct: 20, vol_overheat_sigma: 1.5, vol_oversold_sigma: 1.5,
  last_buy_dip_pct: -10, buy_cooldown_days: 14, buy_max_weight_pct: 20, buy_qty_amount_krw: 1000000, buy_qty_lower_avg_pct: 5, vol_stop_k: 1,
  rebound_from_low_pct: 5, rebound_lookback_days: 20, yield_expansion_pct: 20, time_stop_days: 365, time_stop_max_return_pct: 0, short_drop_days: 20, short_drop_pct: -15,
  below_ma_lookback_days: 60, below_ma_max_above_pct: 3, below_ma_reclaim_days: 10, from_high_lookback_days: 60, from_high_rebound_pct: 5, from_high_still_below_pct: -10,
  rsi_period: 14, mfi_period: 14, osc_lookback_days: 10, rsi_buy_level: 30, rsi_sell_level: 70, mfi_buy_level: 20, mfi_sell_level: 80,
  per_buy_max: 10, per_sell_min: 40, pbr_buy_max: 1, pbr_sell_min: 5,
  valuation_window_months: 36, per_avg_buy_pct: 20, per_avg_sell_pct: 30, pbr_avg_buy_pct: 20, pbr_avg_sell_pct: 30,
};
const NEW_FLAG_DEFAULTS: Partial<Record<EnableKey, boolean>> = {
  from_high_enabled: false, below_ma_enabled: false, above_ma_enabled: false, dividend_cut_enabled: false, crash_enabled: false,
  tax_harvest_enabled: true, fx_historical: true, min_sell_qty_enabled: true,
  trailing_enabled: true, annualized_enabled: false, drift_enabled: false, partial_enabled: true,
  yield_compression_enabled: false, vol_overheat_enabled: false, vol_oversold_enabled: false,
  last_buy_dip_enabled: false, buy_cooldown_enabled: true, buy_max_weight_enabled: true, buy_qty_enabled: true, vol_stop_enabled: false,
  rebound_confirm_enabled: false, rebound_ma_enabled: true, yield_expansion_enabled: false, time_stop_enabled: false, short_drop_enabled: false,
  rsi_buy_enabled: false, rsi_sell_enabled: false, mfi_buy_enabled: false, mfi_sell_enabled: false,
  per_buy_enabled: false, per_sell_enabled: false, pbr_buy_enabled: false, pbr_sell_enabled: false,
  per_avg_buy_enabled: false, per_avg_sell_enabled: false, pbr_avg_buy_enabled: false, pbr_avg_sell_enabled: false,
};
const DEFAULT_HARVEST_MONTH = 11;

const PRESETS: { id: string; label: string; values: Partial<Record<NumKey, number>> }[] = [
  { id: 'conservative', label: '보수적', values: { take_profit_pct: 20, stop_loss_pct: -10, buy_dip_pct: -15, dividend_payback_pct: 30, dividend_payback_min_return_pct: 5, low_yield_pct: 3, high_yield_pct: 6, from_high_pct: -25, below_ma_pct: -8, above_ma_pct: 20, dividend_cut_pct: 5, crash_pct: -30, trailing_activate_pct: 15, trailing_drop_pct: -7, annualized_pct: 20, annualized_min_days: 60, annualized_min_return_pct: 10, drift_pct: 5, partial_pct: 50, yield_compression_pct: 15, vol_overheat_sigma: 1.2, vol_oversold_sigma: 1.2, last_buy_dip_pct: -15, buy_cooldown_days: 30, buy_max_weight_pct: 15, vol_stop_k: 0.8, rebound_from_low_pct: 7, rebound_lookback_days: 20, yield_expansion_pct: 15, time_stop_days: 270, time_stop_max_return_pct: 5, short_drop_days: 20, short_drop_pct: -10, below_ma_lookback_days: 90, below_ma_max_above_pct: 2, below_ma_reclaim_days: 5, from_high_lookback_days: 90, from_high_rebound_pct: 7, from_high_still_below_pct: -15, rsi_buy_level: 25, rsi_sell_level: 75, mfi_buy_level: 15, mfi_sell_level: 85, per_buy_max: 8, per_sell_min: 50, pbr_buy_max: 0.8, pbr_sell_min: 6, per_avg_buy_pct: 25, per_avg_sell_pct: 25, pbr_avg_buy_pct: 25, pbr_avg_sell_pct: 25 } },
  { id: 'balanced', label: '균형', values: { take_profit_pct: 30, stop_loss_pct: -20, buy_dip_pct: -10, dividend_payback_pct: 50, dividend_payback_min_return_pct: 10, low_yield_pct: 2, high_yield_pct: 5, from_high_pct: -20, below_ma_pct: -5, above_ma_pct: 25, dividend_cut_pct: 10, crash_pct: -40, trailing_activate_pct: 20, trailing_drop_pct: -10, annualized_pct: 25, annualized_min_days: 90, annualized_min_return_pct: 15, drift_pct: 7, partial_pct: 33, yield_compression_pct: 20, vol_overheat_sigma: 1.5, vol_oversold_sigma: 1.5, last_buy_dip_pct: -10, buy_cooldown_days: 14, buy_max_weight_pct: 20, vol_stop_k: 1, rebound_from_low_pct: 5, rebound_lookback_days: 20, yield_expansion_pct: 20, time_stop_days: 365, time_stop_max_return_pct: 0, short_drop_days: 20, short_drop_pct: -15, below_ma_lookback_days: 60, below_ma_max_above_pct: 3, below_ma_reclaim_days: 10, from_high_lookback_days: 60, from_high_rebound_pct: 5, from_high_still_below_pct: -10, rsi_buy_level: 30, rsi_sell_level: 70, mfi_buy_level: 20, mfi_sell_level: 80, per_buy_max: 10, per_sell_min: 40, pbr_buy_max: 1, pbr_sell_min: 5, per_avg_buy_pct: 20, per_avg_sell_pct: 30, pbr_avg_buy_pct: 20, pbr_avg_sell_pct: 30 } },
  { id: 'aggressive', label: '공격적', values: { take_profit_pct: 50, stop_loss_pct: -30, buy_dip_pct: -7, dividend_payback_pct: 80, dividend_payback_min_return_pct: 20, low_yield_pct: 1.5, high_yield_pct: 4, from_high_pct: -15, below_ma_pct: -3, above_ma_pct: 35, dividend_cut_pct: 20, crash_pct: -50, trailing_activate_pct: 30, trailing_drop_pct: -15, annualized_pct: 35, annualized_min_days: 120, annualized_min_return_pct: 25, drift_pct: 10, partial_pct: 25, yield_compression_pct: 30, vol_overheat_sigma: 2, vol_oversold_sigma: 2, last_buy_dip_pct: -7, buy_cooldown_days: 7, buy_max_weight_pct: 30, vol_stop_k: 1.5, rebound_from_low_pct: 3, rebound_lookback_days: 10, yield_expansion_pct: 30, time_stop_days: 540, time_stop_max_return_pct: -5, short_drop_days: 20, short_drop_pct: -20, below_ma_lookback_days: 40, below_ma_max_above_pct: 5, below_ma_reclaim_days: 15, from_high_lookback_days: 40, from_high_rebound_pct: 3, from_high_still_below_pct: -5, rsi_buy_level: 35, rsi_sell_level: 65, mfi_buy_level: 25, mfi_sell_level: 75, per_buy_max: 15, per_sell_min: 30, pbr_buy_max: 1.5, pbr_sell_min: 4, per_avg_buy_pct: 15, per_avg_sell_pct: 40, pbr_avg_buy_pct: 15, pbr_avg_sell_pct: 40 } },
];

interface Draft {
  nums: Record<NumKey, string>;
  flags: Record<EnableKey, boolean>;
  month: string;
  sell_mode: SignalMode;
  buy_mode: SignalMode;
  sell_min_count: number;
  buy_min_count: number;
  // 매도 묶음별 기준 개수 (99 = 모두). 저장할 때 켜진 개수로 맞춘다
  sell_profit_count: number;
  sell_risk_count: number;
  buy_qty_mode: BuyQtyMode;
  below_ma_mode: BelowMaMode;
  from_high_mode: FromHighMode;
}

const ALL_COUNT = 99;

// 저장된 규칙에서 매도 묶음 기준 개수를 복원한다 (구 any/count/all 방식은 묶음 기준으로 변환)
function groupCounts(rule: SignalRule): { profit: number; risk: number } {
  const mode = rule.sell_mode || 'any';
  if (mode === 'group') return { profit: Math.max(rule.sell_profit_min_count || 1, 1), risk: Math.max(rule.sell_risk_min_count || 1, 1) };
  if (mode === 'all') return { profit: ALL_COUNT, risk: ALL_COUNT };
  if (mode === 'count') return { profit: Math.max(rule.sell_min_count || 2, 1), risk: 1 };
  return { profit: 1, risk: 1 };
}

function toDraft(rule: SignalRule): Draft {
  const nums = {} as Record<NumKey, string>;
  NUM_KEYS.forEach((k) => (nums[k] = String(rule[k] ?? NEW_NUM_DEFAULTS[k] ?? 0)));
  const flags = {} as Record<EnableKey, boolean>;
  ENABLE_KEYS.forEach((k) => (flags[k] = rule[k] ?? NEW_FLAG_DEFAULTS[k] ?? false));
  return {
    nums,
    flags,
    month: String(rule.tax_harvest_from_month || DEFAULT_HARVEST_MONTH),
    sell_mode: 'group',
    buy_mode: rule.buy_mode || 'any',
    sell_min_count: rule.sell_min_count || 2,
    buy_min_count: rule.buy_min_count || 2,
    sell_profit_count: groupCounts(rule).profit,
    sell_risk_count: groupCounts(rule).risk,
    buy_qty_mode: rule.buy_qty_mode || 'amount',
    below_ma_mode: rule.below_ma_mode || 'rebound',
    from_high_mode: rule.from_high_mode || 'rebound',
  };
}

function validate(d: Draft): Partial<Record<NumKey, string>> {
  const errs: Partial<Record<NumKey, string>> = {};
  NUM_KEYS.forEach((k) => {
    const raw = d.nums[k].trim();
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n)) {
      errs[k] = '숫자를 입력하세요';
      return;
    }
    if ((k === 'stop_loss_pct' || k === 'buy_dip_pct' || k === 'from_high_pct' || k === 'below_ma_pct' || k === 'crash_pct') && n > 0) errs[k] = '0 이하로 입력하세요';
    else if (k === 'trailing_drop_pct' && n >= 0) errs[k] = '0보다 작게 입력하세요 (예: -10)';
    else if (k === 'drift_pct' && n <= 0) errs[k] = '0보다 크게 입력하세요';
    else if ((k === 'yield_compression_pct' || k === 'vol_overheat_sigma' || k === 'vol_oversold_sigma') && (n <= 0 || n > (k === 'yield_compression_pct' ? 100 : 10))) errs[k] = k === 'yield_compression_pct' ? '0보다 크고 100 이하로 입력하세요' : '0보다 크고 10 이하로 입력하세요';
    else if (k === 'partial_pct' && (n < 1 || n > 100)) errs[k] = '1~100 사이로 입력하세요';
    else if (k === 'annualized_min_days' && (!Number.isInteger(n) || n < 1 || n > 3650)) errs[k] = '1~3650 사이 정수로 입력하세요';
    else if ((k === 'above_ma_pct' || k === 'dividend_cut_pct' || k === 'weight_band_pct' || k === 'min_sell_qty' || k === 'trailing_activate_pct' || k === 'annualized_pct' || k === 'annualized_min_return_pct') && n < 0) errs[k] = '0 이상으로 입력하세요';
    else if (k === 'target_weight_pct' && (n < 0 || n > 100)) errs[k] = '0~100 사이로 입력하세요';
    else if (k === 'last_buy_dip_pct' && n >= 0) errs[k] = '0보다 작게 입력하세요 (예: -10)';
    else if (k === 'buy_cooldown_days' && (!Number.isInteger(n) || n < 1 || n > 365)) errs[k] = '1~365 사이 정수로 입력하세요';
    else if (k === 'buy_max_weight_pct' && (n <= 0 || n > 100)) errs[k] = '0보다 크고 100 이하로 입력하세요';
    else if (k === 'buy_qty_amount_krw' && n <= 0) errs[k] = '0보다 크게 입력하세요';
    else if (k === 'buy_qty_lower_avg_pct' && (n <= 0 || n > 50)) errs[k] = '0보다 크고 50 이하로 입력하세요';
    else if (k === 'vol_stop_k' && (n <= 0 || n > 5)) errs[k] = '0보다 크고 5 이하로 입력하세요';
    else if (k === 'rebound_from_low_pct' && (n <= 0 || n > 100)) errs[k] = '0보다 크고 100 이하로 입력하세요';
    else if ((k === 'rebound_lookback_days' || k === 'short_drop_days') && (!Number.isInteger(n) || n < 5 || n > 120)) errs[k] = '5~120 사이 정수로 입력하세요';
    else if (k === 'yield_expansion_pct' && n <= 0) errs[k] = '0보다 크게 입력하세요';
    else if (k === 'time_stop_days' && (!Number.isInteger(n) || n < 30 || n > 3650)) errs[k] = '30~3650 사이 정수로 입력하세요';
    else if (k === 'short_drop_pct' && n >= 0) errs[k] = '0보다 작게 입력하세요 (예: -15)';
    else if ((k === 'below_ma_lookback_days' || k === 'from_high_lookback_days') && (!Number.isInteger(n) || n < 10 || n > 250)) errs[k] = '10~250 사이 정수로 입력하세요';
    else if (k === 'below_ma_max_above_pct' && (n < 0 || n > 50)) errs[k] = '0~50 사이로 입력하세요';
    else if (k === 'below_ma_reclaim_days' && (!Number.isInteger(n) || n < 1 || n > 60)) errs[k] = '1~60 사이 정수로 입력하세요';
    else if (k === 'from_high_rebound_pct' && (n <= 0 || n > 100)) errs[k] = '0보다 크고 100 이하로 입력하세요';
    else if (k === 'from_high_still_below_pct' && n > 0) errs[k] = '0 이하로 입력하세요 (예: -10)';
    else if ((k === 'rsi_period' || k === 'mfi_period') && (!Number.isInteger(n) || n < 2 || n > 50)) errs[k] = '2~50 사이 정수로 입력하세요';
    else if (k === 'osc_lookback_days' && (!Number.isInteger(n) || n < 1 || n > 60)) errs[k] = '1~60 사이 정수로 입력하세요';
    else if ((k === 'rsi_buy_level' || k === 'rsi_sell_level' || k === 'mfi_buy_level' || k === 'mfi_sell_level') && (n < 1 || n > 99)) errs[k] = '1~99 사이로 입력하세요';
    else if ((k === 'per_buy_max' || k === 'per_sell_min' || k === 'pbr_buy_max' || k === 'pbr_sell_min') && n <= 0) errs[k] = '0보다 크게 입력하세요';
    else if (k === 'valuation_window_months' && (!Number.isInteger(n) || n < 12 || n > 60)) errs[k] = '12~60 사이 정수로 입력하세요';
    else if ((k === 'per_avg_buy_pct' || k === 'pbr_avg_buy_pct') && (n <= 0 || n > 90)) errs[k] = '0보다 크고 90 이하로 입력하세요';
    else if ((k === 'per_avg_sell_pct' || k === 'pbr_avg_sell_pct') && (n <= 0 || n > 500)) errs[k] = '0보다 크고 500 이하로 입력하세요';
  });
  // 과열 기준은 과매도 기준보다 커야 한다 (둘 다 켰을 때)
  const f = d.flags;
  if (!errs.rsi_sell_level && !errs.rsi_buy_level && f.rsi_buy_enabled && f.rsi_sell_enabled && Number(d.nums.rsi_sell_level) <= Number(d.nums.rsi_buy_level)) errs.rsi_sell_level = '매수 기준(RSI)보다 크게 입력하세요';
  if (!errs.mfi_sell_level && !errs.mfi_buy_level && f.mfi_buy_enabled && f.mfi_sell_enabled && Number(d.nums.mfi_sell_level) <= Number(d.nums.mfi_buy_level)) errs.mfi_sell_level = '매수 기준(MFI)보다 크게 입력하세요';
  return errs;
}

// 충족 방식(any/all/count) ↔ 필요한 개수. 켜진 조건 수(enabled)를 넘지 않게 맞춘다.
function requiredCount(mode: SignalMode, count: number, enabled: number): number {
  if (enabled <= 0) return 0;
  if (mode === 'all') return enabled;
  if (mode === 'count') return Math.min(Math.max(count, 1), enabled);
  return 1;
}
function modeForCount(k: number, enabled: number): { mode: SignalMode; count: number } {
  if (k <= 1) return { mode: 'any', count: 2 };
  if (k >= enabled) return { mode: 'all', count: 2 };
  return { mode: 'count', count: k };
}

// 몇 개 이상 충족해야 신호를 낼지 고른다. 선택지는 켜진 조건 수까지만 보여 준다.
export function CountSelect({ mode, count, enabled, onChange, label, disabled }: {
  mode: SignalMode;
  count: number;
  enabled: number;
  onChange: (mode: SignalMode, count: number) => void;
  label: string;
  disabled?: boolean;
}) {
  const current = requiredCount(mode, count, enabled);
  const options = Array.from({ length: Math.max(enabled, 0) }, (_, i) => i + 1);
  return (
    <div className="flex items-center gap-2">
      <span className="label-mono !text-zinc-500">켜진 {enabled}개 중</span>
      <select
        aria-label={label}
        value={current}
        disabled={disabled || enabled === 0}
        onChange={(e) => {
          const next = modeForCount(Number(e.target.value), enabled);
          onChange(next.mode, next.count);
        }}
        className="input-field !w-auto !py-1.5 !pr-8 !text-xs"
      >
        {enabled === 0 && <option value={0}>켜진 조건 없음</option>}
        {options.map((k) => (
          <option key={k} value={k}>
            {k === enabled && k > 1 ? `모두 충족 (${k}개)` : k === 1 ? '1개 이상 충족 (하나라도)' : `${k}개 이상 충족`}
          </option>
        ))}
      </select>
    </div>
  );
}

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${
        checked ? 'border-mint-400/60 bg-mint-400/30' : 'border-white/15 bg-white/[0.06]'
      }`}
    >
      <span
        className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-all ${
          checked ? 'left-[18px] bg-mint-300' : 'left-0.5 bg-zinc-400'
        }`}
      />
    </button>
  );
}


function useRuleDraft(initial: SignalRule) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const errors = useMemo(() => validate(draft), [draft]);
  const hasErrors = Object.keys(errors).length > 0;
  const setNum = (k: NumKey, v: string) => setDraft((d) => ({ ...d, nums: { ...d.nums, [k]: v } }));
  const setFlag = (k: EnableKey, v: boolean) => setDraft((d) => ({ ...d, flags: { ...d.flags, [k]: v } }));
  const applyPreset = (values: Partial<Record<NumKey, number>>) => {
    setDraft((d) => {
      const nums = { ...d.nums };
      (Object.keys(values) as NumKey[]).forEach((k) => (nums[k] = String(values[k])));
      return { ...d, nums };
    });
  };
  return { draft, setDraft, errors, hasErrors, setNum, setFlag, applyPreset };
}
type RuleDraft = ReturnType<typeof useRuleDraft>;

// 실제 신호 판정에 쓰이는 켜진 조건 수 (목표 비중은 목표가 0보다 클 때만 매도·매수 양쪽 조건이 된다)
function weightActive(d: Draft): boolean {
  return d.flags.weight_enabled && Number(d.nums.target_weight_pct) > 0;
}
function enabledOf(d: Draft, rules: RuleDef[]): number {
  return rules.filter((r) => (r.enabled === 'weight_enabled' ? weightActive(d) : d.flags[r.enabled])).length;
}
function enabledProfitCount(d: Draft): number {
  return enabledOf(d, SELL_PROFIT_RULES);
}
function enabledRiskCount(d: Draft): number {
  return enabledOf(d, SELL_RISK_RULES);
}
function enabledBuyCount(d: Draft): number {
  return BUY_RULES.filter((r) => d.flags[r.enabled]).length + (weightActive(d) ? 1 : 0);
}

function buildRule(base: SignalRule, d: Draft): SignalRule {
  const rule: SignalRule = { ...base, sell_mode: 'group', buy_mode: d.buy_mode };
  // 켜진 조건 수에 맞춰 충족 방식을 정리한다 (예: 3개 이상인데 켜진 게 3개 → 모두)
  const profitOn = enabledProfitCount(d);
  const riskOn = enabledRiskCount(d);
  const buyOn = enabledBuyCount(d);
  const buy = modeForCount(requiredCount(d.buy_mode, d.buy_min_count, buyOn), buyOn);
  // 매도는 항상 묶음 방식. 기준 개수는 1~켜진 개수로 맞춘다 (모두 = 켜진 개수)
  rule.sell_profit_min_count = Math.min(Math.max(d.sell_profit_count, 1), Math.max(profitOn, 1));
  rule.sell_risk_min_count = Math.min(Math.max(d.sell_risk_count, 1), Math.max(riskOn, 1));
  rule.sell_min_count = 0;
  rule.buy_mode = buyOn > 0 ? buy.mode : d.buy_mode === 'count' ? 'any' : d.buy_mode;
  rule.buy_min_count = buyOn > 0 && buy.mode === 'count' ? buy.count : 0;
  NUM_KEYS.forEach((k) => (rule[k] = Number(d.nums[k])));
  ENABLE_KEYS.forEach((k) => (rule[k] = d.flags[k]));
  rule.buy_qty_mode = d.buy_qty_mode;
  rule.below_ma_mode = d.below_ma_mode;
  rule.from_high_mode = d.from_high_mode;
  const month = Math.round(Number(d.month));
  rule.tax_harvest_from_month = month >= 1 && month <= 12 ? month : DEFAULT_HARVEST_MONTH;
  return rule;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : typeof err === 'string' && err ? err : fallback;
}

// CountSelect 의 (mode,count) 선택을 묶음 기준 개수로 바꾼다 (모두 = ALL_COUNT)
function groupValue(mode: SignalMode, count: number): number {
  return mode === 'all' ? ALL_COUNT : mode === 'count' ? count : 1;
}

// ===== 섹션 탐색형 편집기 =====

export type SectionId = 'profit' | 'risk' | 'exclude' | 'buy' | 'confirm' | 'buyqty' | 'misc';
export const DEFAULT_SECTION: SectionId = 'profit';

const BUY_QTY_MODES: { value: BuyQtyMode; label: string }[] = [
  { value: 'amount', label: '정액' },
  { value: 'target_weight', label: '목표 비중까지' },
  { value: 'lower_avg', label: '평단 낮추기' },
];

interface SectionMeta {
  id: SectionId;
  group: '매도' | '매수' | '공통';
  title: string;
  purpose: string;
  dot: string; // 상태 점 색
}

const SECTIONS: SectionMeta[] = [
  { id: 'profit', group: '매도', title: '수익 실현', purpose: '기준 개수만큼 충족하면 이익 실현을 검토하는 조건', dot: 'bg-mint-400' },
  { id: 'risk', group: '매도', title: '위험 관리', purpose: '기준 개수만큼 충족하면 바로 알려야 하는 조건', dot: 'bg-rose-400' },
  { id: 'exclude', group: '매도', title: '제외 · 수량', purpose: '조건을 충족해도 매도에서 빼는 예외와 제안할 매도 수량', dot: 'bg-amber-400' },
  { id: 'buy', group: '매수', title: '매수 신호', purpose: '기준 개수만큼 충족하면 추가 매수를 검토하는 신호', dot: 'bg-mint-400' },
  { id: 'confirm', group: '매수', title: '확인 · 제외', purpose: '개수에 세지 않고, 매수 신호가 났을 때 한 번 더 걸러내는 조건', dot: 'bg-amber-400' },
  { id: 'buyqty', group: '매수', title: '매수 수량', purpose: '매수 신호일 때 살 수량을 제안하는 방식', dot: 'bg-sky-400' },
  { id: 'misc', group: '공통', title: '기타', purpose: '수익률 계산 기준과 연말 절세 힌트', dot: 'bg-zinc-500' },
];

// 입력 항목이 속한 섹션 (검증 오류 표시용)
const SECTION_OF_NUM: Partial<Record<NumKey, SectionId>> = (() => {
  const m: Partial<Record<NumKey, SectionId>> = {};
  const add = (rules: RuleDef[], s: SectionId) => rules.forEach((r) => r.fields.forEach((f) => (m[f.key] = s)));
  add(SELL_PROFIT_RULES, 'profit');
  add(SELL_RISK_RULES, 'risk');
  add(SELL_EXCLUDE_RULES, 'exclude');
  add(SELL_QTY_RULES, 'exclude');
  add(BUY_RULES, 'buy');
  add(BUY_EXCLUDE_RULES, 'confirm');
  m.rebound_lookback_days = 'confirm';
  m.rebound_from_low_pct = 'confirm';
  (['below_ma_lookback_days', 'below_ma_max_above_pct', 'below_ma_reclaim_days', 'from_high_lookback_days', 'from_high_rebound_pct', 'from_high_still_below_pct'] as NumKey[]).forEach((k) => (m[k] = 'buy'));
  (['rsi_period', 'mfi_period', 'osc_lookback_days', 'valuation_window_months'] as NumKey[]).forEach((k) => (m[k] = 'misc'));
  m.buy_qty_amount_krw = 'buyqty';
  m.buy_qty_lower_avg_pct = 'buyqty';
  return m;
})();

function errorCountBySection(errors: Partial<Record<NumKey, string>>): Partial<Record<SectionId, number>> {
  const out: Partial<Record<SectionId, number>> = {};
  (Object.keys(errors) as NumKey[]).forEach((k) => {
    const s = SECTION_OF_NUM[k];
    if (s) out[s] = (out[s] ?? 0) + 1;
  });
  return out;
}

// 저장 시도 때 오류가 있는 첫 섹션 (없으면 null)
function firstErrorSection(errors: Partial<Record<NumKey, string>>): SectionId | null {
  const counts = errorCountBySection(errors);
  return SECTIONS.find((s) => counts[s.id])?.id ?? null;
}

function fmtNum(raw: string): string {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n) ? String(n) : '?';
}
function fmtMoney(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return '?원';
  if (n >= 10000 && n % 10000 === 0) return `${(n / 10000).toLocaleString('ko-KR')}만 원`;
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}
function countText(req: number, on: number): string {
  return on > 1 && req >= on ? '모두' : `${req}개 이상`;
}

/** 저장된 규칙을 "매도 검토 / 매수 검토" 두 문장으로 요약한다 (전략 추천 미리보기용) */
export function describeRule(rule: SignalRule): { sell: string; buy: string } {
  return summarize(toDraft(rule));
}

/** 켜진 조건을 그룹별로 "이름 (기준 값)" 목록으로 (전략 추천 미리보기용) */
export function listRuleConditions(rule: SignalRule): { profit: string[]; risk: string[]; buy: string[] } {
  const d = toDraft(rule);
  // 단위가 숫자에 바로 붙는 접미사 (% · σ · 일 · 배 · 주)
  const tight = /^[%σ일배주]/;
  const fmt = (def: RuleDef) => {
    // 방식이 있는 조건은 방식을 이름에 드러낸다 (하회 / 하회 후 반등 / 200일선 회복)
    if (def.enabled === 'below_ma_enabled') {
      if (d.below_ma_mode === 'reclaim') return `200일선 상향 돌파 (최근 ${fmtNum(d.nums.below_ma_reclaim_days)}거래일 안)`;
      if (d.below_ma_mode === 'rebound') return `장기 이평 하회 후 반등 (기준 ${fmtNum(d.nums.below_ma_pct)}%)`;
    }
    if (def.enabled === 'from_high_enabled' && d.from_high_mode === 'rebound') {
      return `52주 고점 대비 하락 후 반등 (기준 ${fmtNum(d.nums.from_high_pct)}%)`;
    }
    return `${def.label} (${def.fields.map((f) => `${f.label} ${fmtNum(d.nums[f.key])}${tight.test(f.suffix) ? '' : ' '}${f.suffix}`).join(', ')})`;
  };
  const pick = (defs: RuleDef[]) => defs.filter((def) => d.flags[def.enabled]).map(fmt);
  return { profit: pick(SELL_PROFIT_RULES), risk: pick(SELL_RISK_RULES), buy: pick(BUY_RULES) };
}

// 현재 편집 중인 값으로 전략을 두 문장으로 요약한다
function summarize(d: Draft): { sell: string; buy: string } {
  const profitOn = enabledProfitCount(d);
  const riskOn = enabledRiskCount(d);
  const sellParts: string[] = [];
  const groups: string[] = [];
  if (profitOn > 0) groups.push(`수익 실현 조건 ${countText(Math.min(Math.max(d.sell_profit_count, 1), profitOn), profitOn)}`);
  if (riskOn > 0) groups.push(`위험 조건 ${countText(Math.min(Math.max(d.sell_risk_count, 1), riskOn), riskOn)}`);
  sellParts.push(groups.length > 0 ? `${groups.join(' 또는 ')} 충족 시` : '켜진 수익 실현·위험 조건 없음');
  if (d.flags.min_sell_qty_enabled) sellParts.push(`${fmtNum(d.nums.min_sell_qty)}주 이하 보유는 제외`);
  if (d.flags.partial_enabled) sellParts.push(`분할 익절 ${fmtNum(d.nums.partial_pct)}%`);

  const buyOn = enabledBuyCount(d);
  const buyParts: string[] = [];
  buyParts.push(buyOn > 0 ? `매수 조건 ${countText(requiredCount(d.buy_mode, d.buy_min_count, buyOn), buyOn)} 충족 시` : '켜진 매수 조건 없음');
  if (d.flags.rebound_confirm_enabled) buyParts.push('반등 확인');
  const ex: string[] = [];
  if (d.flags.buy_cooldown_enabled) ex.push(`최근 ${fmtNum(d.nums.buy_cooldown_days)}일 매수`);
  if (d.flags.buy_max_weight_enabled) ex.push(`비중 ${fmtNum(d.nums.buy_max_weight_pct)}% 이상`);
  if (ex.length > 0) buyParts.push(`${ex.join('·')}은 제외`);
  if (d.flags.buy_qty_enabled) {
    buyParts.push(
      d.buy_qty_mode === 'amount'
        ? `정액 ${fmtMoney(d.nums.buy_qty_amount_krw)} 제안`
        : d.buy_qty_mode === 'lower_avg'
          ? `평단 ${fmtNum(d.nums.buy_qty_lower_avg_pct)}% 낮추기 제안`
          : '목표 비중까지 제안',
    );
  }
  return { sell: sellParts.join(' · '), buy: buyParts.join(' · ') };
}

// 섹션별 요약 상태 (nav 오른쪽 짧은 텍스트)
function sectionStatus(d: Draft, id: SectionId): string {
  const flagCount = (rules: RuleDef[]) => rules.filter((r) => d.flags[r.enabled]).length;
  switch (id) {
    case 'profit':
      return `${flagCount(SELL_PROFIT_RULES)}/${SELL_PROFIT_RULES.length}`;
    case 'risk':
      return `${flagCount(SELL_RISK_RULES)}/${SELL_RISK_RULES.length}`;
    case 'exclude':
      return String(flagCount(SELL_EXCLUDE_RULES) + flagCount(SELL_QTY_RULES));
    case 'buy':
      return `${flagCount(BUY_RULES)}/${BUY_RULES.length}`;
    case 'confirm':
      return `${flagCount(BUY_EXCLUDE_RULES) + (d.flags.rebound_confirm_enabled ? 1 : 0)}/${BUY_EXCLUDE_RULES.length + 1}`;
    case 'buyqty':
      return !d.flags.buy_qty_enabled ? '꺼짐' : d.buy_qty_mode === 'amount' ? '정액' : d.buy_qty_mode === 'target_weight' ? '목표 비중' : '평단';
    case 'misc':
      return `${Number(d.flags.fx_historical) + Number(d.flags.tax_harvest_enabled)}/2`;
  }
}

// 설명을 담은 ⓘ 아이콘 (hover/focus 때 말풍선, title 은 보조)
function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex shrink-0">
      <button type="button" title={text} aria-label={`설명: ${text}`} className="rounded-full text-zinc-500 transition-colors hover:text-zinc-200 focus:text-zinc-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-mint-400/60">
        <Info className="h-3.5 w-3.5" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute left-0 top-full z-30 mt-1.5 w-64 max-w-[70vw] rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-xs font-normal leading-relaxed text-zinc-200 opacity-0 shadow-xl transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

// 규칙 내용 영역 (규칙 행들)
function SectionBody({ rd, readOnly, touched, showNote, id }: { rd: RuleDraft; readOnly: boolean; touched: boolean; showNote: boolean; id: SectionId }) {
  const { draft, errors, setDraft, setNum, setFlag } = rd;

  // 입력 + 단위 (한 줄용)
  const numInput = (key: NumKey, label: string, suffix: string, wide?: boolean) => {
    const err = (touched || draft.nums[key] !== '') && errors[key];
    return (
      <div className="flex flex-col items-end">
        <div className="flex items-center gap-1.5">
          {label !== '기준' && (
            <label className="text-[11px] text-zinc-500" htmlFor={`rule-${key}`}>
              {label}
            </label>
          )}
          <input
            id={`rule-${key}`}
            type="number"
            step="any"
            inputMode="decimal"
            aria-label={label}
            value={draft.nums[key]}
            disabled={readOnly}
            onChange={(e) => setNum(key, e.target.value)}
            className={`input-field num ${wide ? '!w-32' : '!w-20'} !py-1 text-right !text-sm ${err ? '!border-rose-400/60' : ''}`}
          />
          <span className="label-mono !text-zinc-400">{suffix}</span>
        </div>
        {err && <p className="mt-1 text-[11px] text-rose-300">{err}</p>}
      </div>
    );
  };

  const rowShell = (key: string, on: boolean, sw: React.ReactNode, title: React.ReactNode, desc: string, body: React.ReactNode) => (
    <div key={key} className="surface-inset px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {sw}
        <div className={`flex min-w-[9rem] flex-1 items-center gap-1.5 ${on ? '' : 'opacity-60'}`}>
          <span className={`text-sm font-medium ${on ? 'text-white' : 'text-zinc-400'}`}>{title}</span>
          <InfoTip text={desc} />
        </div>
        <div className={`ml-auto flex flex-wrap items-start justify-end gap-x-3 gap-y-1.5 transition-opacity ${on ? '' : 'opacity-50'}`}>{body}</div>
      </div>
    </div>
  );

  const renderRule = (def: RuleDef) => {
    const on = draft.flags[def.enabled];
    return rowShell(
      def.enabled,
      on,
      <Switch checked={on} onChange={(v) => setFlag(def.enabled, v)} label={def.label} disabled={readOnly} />,
      <>
        {def.label}
        {def.note && showNote && <span className="badge ml-2 border border-amber-400/25 bg-amber-400/10 align-middle text-amber-200">{def.note}</span>}
      </>,
      def.desc.replace('{N}', String(Math.round(Number(draft.nums.valuation_window_months)) || 36)),
      def.fields.map((f) => <div key={f.key}>{numInput(f.key, f.label, f.suffix)}</div>),
    );
  };

  const renderRebound = () => {
    const on = draft.flags.rebound_confirm_enabled;
    return rowShell(
      'rebound',
      on,
      <Switch checked={on} onChange={(v) => setFlag('rebound_confirm_enabled', v)} label="반등 확인" disabled={readOnly} />,
      '반등 확인',
      '떨어지는 중에 사지 않도록, 매수 신호가 떠도 최근 저점에서 반등했거나 20일 이평선 위로 올라왔을 때만 매수 검토로 인정합니다.',
      <>
        {numInput('rebound_lookback_days', '최근', '거래일')}
        {numInput('rebound_from_low_pct', '저점 대비', '% 이상 반등')}
        <label className="flex items-center gap-2 py-1 text-xs text-zinc-400">
          <Switch checked={draft.flags.rebound_ma_enabled} onChange={(v) => setFlag('rebound_ma_enabled', v)} label="또는 20일 이평선 위" disabled={readOnly} />
          <span>또는 20일 이평선 위</span>
        </label>
      </>,
    );
  };

  const modePills = <T extends string>(label: string, options: { value: T; label: string }[], mode: T, onPick: (v: T) => void) => (
    <div className="glass-pill inline-flex p-0.5" role="group" aria-label={label}>
      {options.map((m) => (
        <button
          key={m.value}
          type="button"
          disabled={readOnly}
          aria-pressed={mode === m.value}
          onClick={() => onPick(m.value)}
          className={`pill-item !px-3 !py-1 !text-xs ${mode === m.value ? 'pill-item-active' : ''}`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );

  const renderBelowMa = () => {
    const on = draft.flags.below_ma_enabled;
    const mode = draft.below_ma_mode;
    const x = fmtNum(draft.nums.below_ma_pct).replace('-', '');
    const n = fmtNum(draft.nums.below_ma_lookback_days);
    const desc =
      mode === 'below'
        ? `현재가가 200일선보다 ${x}% 이상 아래에 있으면 매수를 검토합니다. 하락이 계속되는 중에도 신호가 날 수 있습니다.`
        : mode === 'reclaim'
          ? `최근 ${n}거래일 안에 200일선보다 ${x}% 이상 아래에 있었고, 최근 ${fmtNum(draft.nums.below_ma_reclaim_days)}거래일 안에 200일선을 다시 넘어 지금도 그 위에 있으면 매수를 검토합니다.`
          : `최근 ${n}거래일 안에 200일선보다 ${x}% 이상 아래에 있었고, 지금은 20일 이평선 위에서 20일선이 오르는 중일 때 매수를 검토합니다. 이미 200일선보다 ${fmtNum(draft.nums.below_ma_max_above_pct)}% 넘게 오른 뒤에는 신호를 내지 않습니다.`;
    return rowShell(
      'below_ma',
      on,
      <Switch checked={on} onChange={(v) => setFlag('below_ma_enabled', v)} label="장기 이평 하회" disabled={readOnly} />,
      '장기 이평 하회',
      desc,
      <>
        {modePills<BelowMaMode>(
          '장기 이평 방식',
          [
            { value: 'rebound', label: '하회 후 반등' },
            { value: 'reclaim', label: '200일선 회복' },
            { value: 'below', label: '단순 하회' },
          ],
          mode,
          (v) => setDraft((d) => ({ ...d, below_ma_mode: v })),
        )}
        {numInput('below_ma_pct', '200일선 대비', '% 이하까지 하락')}
        {mode !== 'below' && numInput('below_ma_lookback_days', '최근', '거래일 안')}
        {mode === 'rebound' && numInput('below_ma_max_above_pct', '200일선 위', '% 이내')}
        {mode === 'reclaim' && numInput('below_ma_reclaim_days', '회복', '거래일 이내')}
      </>,
    );
  };

  const renderFromHigh = () => {
    const on = draft.flags.from_high_enabled;
    const mode = draft.from_high_mode;
    const x = fmtNum(draft.nums.from_high_pct).replace('-', '');
    const desc =
      mode === 'below'
        ? `현재가가 52주 최고가보다 ${x}% 이상 낮으면 매수를 검토합니다. 하락이 계속되는 중에도 신호가 날 수 있습니다.`
        : `최근 ${fmtNum(draft.nums.from_high_lookback_days)}거래일 안에 52주 고점 대비 ${x}% 이상 떨어졌고, 그 기간 최저 종가에서 ${fmtNum(draft.nums.from_high_rebound_pct)}% 이상 반등했으며, 아직 고점보다 ${fmtNum(draft.nums.from_high_still_below_pct).replace('-', '')}% 이상 아래일 때 매수를 검토합니다.`;
    return rowShell(
      'from_high',
      on,
      <Switch checked={on} onChange={(v) => setFlag('from_high_enabled', v)} label="52주 고점 대비 하락" disabled={readOnly} />,
      '52주 고점 대비 하락',
      desc,
      <>
        {modePills<FromHighMode>(
          '52주 고점 방식',
          [
            { value: 'rebound', label: '하락 후 반등' },
            { value: 'below', label: '단순 하락' },
          ],
          mode,
          (v) => setDraft((d) => ({ ...d, from_high_mode: v })),
        )}
        {numInput('from_high_pct', '고점 대비', '%까지 하락')}
        {mode === 'rebound' && (
          <>
            {numInput('from_high_lookback_days', '최근', '거래일 안')}
            {numInput('from_high_rebound_pct', '저점에서', '% 이상 반등')}
            {numInput('from_high_still_below_pct', '고점보다', '% 이상 아래')}
          </>
        )}
      </>,
    );
  };

  const renderBuyQty = () => {
    const on = draft.flags.buy_qty_enabled;
    const mode = draft.buy_qty_mode;
    const amount = Number(draft.nums.buy_qty_amount_krw);
    return (
      <>
        {rowShell(
          'buyqty',
          on,
          <Switch checked={on} onChange={(v) => setFlag('buy_qty_enabled', v)} label="매수 수량 제안" disabled={readOnly} />,
          '매수 수량 제안',
          '매수 신호일 때 살 수량을 제안합니다. 비중 상한을 넘지 않는 범위에서 계산합니다.',
          <>
            <div className="glass-pill inline-flex p-0.5" role="group" aria-label="매수 수량 계산 방식">
              {BUY_QTY_MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  disabled={readOnly}
                  aria-pressed={mode === m.value}
                  onClick={() => setDraft((d) => ({ ...d, buy_qty_mode: m.value }))}
                  className={`pill-item !px-3 !py-1 !text-xs ${mode === m.value ? 'pill-item-active' : ''}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {mode === 'amount' && numInput('buy_qty_amount_krw', '1회', '원', true)}
            {mode === 'lower_avg' && numInput('buy_qty_lower_avg_pct', '평단을', '% 낮추기')}
          </>,
        )}
        {mode === 'amount' && Number.isFinite(amount) && amount > 0 && <p className="px-1 text-[11px] text-zinc-500">1회 ₩{Math.round(amount).toLocaleString('ko-KR')}</p>}
        {mode === 'target_weight' && (
          <p className="px-1 text-[11px] leading-relaxed text-zinc-500">'목표 비중 이탈'의 목표 비중 값까지 채우는 수량을 제안합니다. 목표 비중이 0이면 정액 방식으로 계산합니다.</p>
        )}
      </>
    );
  };

  const simpleRow = (key: string, on: boolean, label: string, desc: string, flag: EnableKey, extra?: React.ReactNode) =>
    rowShell(key, on, <Switch checked={on} onChange={(v) => setFlag(flag, v)} label={label} disabled={readOnly} />, label, desc, extra);

  const sub = (text: string) => <p className="label-mono !mt-3">{text}</p>;

  switch (id) {
    case 'profit':
      return <>{SELL_PROFIT_RULES.map(renderRule)}</>;
    case 'risk':
      return <>{SELL_RISK_RULES.map(renderRule)}</>;
    case 'exclude':
      return (
        <>
          {sub('매도 제외')}
          {SELL_EXCLUDE_RULES.map(renderRule)}
          {sub('매도 수량')}
          {SELL_QTY_RULES.map(renderRule)}
        </>
      );
    case 'buy':
      return (
        <>
          {BUY_RULES.map((def) =>
            def.enabled === 'below_ma_enabled' ? renderBelowMa() : def.enabled === 'from_high_enabled' ? renderFromHigh() : renderRule(def),
          )}
        </>
      );
    case 'confirm':
      return (
        <>
          {sub('확인 조건')}
          {renderRebound()}
          {sub('매수 제외')}
          {BUY_EXCLUDE_RULES.map(renderRule)}
        </>
      );
    case 'buyqty':
      return renderBuyQty();
    case 'misc':
      return (
        <>
          {sub('지표 계산')}
          {rowShell('rsi_period', true, null, 'RSI 기간', 'RSI(상대강도지수)를 계산할 거래일 수입니다. 기간이 짧을수록 민감하게 움직입니다. 항상 적용됩니다.', numInput('rsi_period', 'RSI 기간', '일'))}
          {rowShell('mfi_period', true, null, 'MFI 기간', 'MFI(자금흐름지수)를 계산할 거래일 수입니다. 항상 적용됩니다.', numInput('mfi_period', 'MFI 기간', '일'))}
          {rowShell('osc_lookback_days', true, null, '과매도 반등 확인 기간', 'RSI·MFI 과매도 반등 조건에서 기준 이하로 내려간 적이 있는지 되돌아볼 거래일 수입니다. 항상 적용됩니다.', numInput('osc_lookback_days', '확인 기간', '일'))}
          {rowShell('valuation_window_months', true, null, 'PER·PBR 평균 기간', 'PER·PBR 평균 대비 조건에서 평균을 구할 최근 개월 수입니다(12~60). 항상 적용됩니다.', numInput('valuation_window_months', 'PER·PBR 평균 기간', '개월'))}
          {sub('기타')}
          {simpleRow('fx', draft.flags.fx_historical, '매수 시점 환율로 수익률 계산', '해외 종목의 원화 수익률을 매수 당시 환율 기준으로 계산합니다. 거래 기록이 없는 수량은 현재 환율을 사용합니다.', 'fx_historical')}
          {simpleRow(
            'tax',
            draft.flags.tax_harvest_enabled,
            '연말 절세 힌트',
            '해외주식 양도세 기본공제 활용을 위한 이익 실현 / 손실 상계 힌트를 표시합니다.',
            'tax_harvest_enabled',
            <div className="flex items-center gap-1.5">
              <select
                aria-label="절세 힌트 시작 월"
                value={draft.month}
                disabled={readOnly}
                onChange={(e) => setDraft((d) => ({ ...d, month: e.target.value }))}
                className="input-field num !w-20 !py-1 !text-sm"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{m}월</option>
                ))}
              </select>
              <span className="label-mono !text-zinc-400">부터</span>
            </div>,
          )}
        </>
      );
  }
}

// 규칙 입력 폼 본문 (프로필 편집 / 종목 편집 공용)
// navLayout: 'side' 는 lg 이상에서 왼쪽 세로 목록, 'pills' 는 항상 위쪽 가로 스크롤 목록 (좁은 모달용)
function RuleFields({ rd, readOnly, touched, showNote, readOnlyHint, section, onSection, navLayout }: {
  rd: RuleDraft;
  readOnly: boolean;
  touched: boolean;
  showNote: boolean;
  readOnlyHint?: string;
  section: SectionId;
  onSection: (s: SectionId) => void;
  navLayout: 'side' | 'pills';
}) {
  const { draft, errors, setDraft, applyPreset } = rd;
  // 추천 전략: 확인 대기 중인 전략과 적용 직후 안내
  const [pendingRec, setPendingRec] = useState<RecommendedStrategy | null>(null);
  const [recApplied, setRecApplied] = useState(false);
  const confirmRecommended = () => {
    if (!pendingRec) return;
    const patch = pendingRec.patch;
    // 현재 초안을 규칙으로 되돌린 뒤 조건만 교체하고 다시 초안으로 (운용 설정은 보존)
    setDraft((d) => toDraft(applyRecommended(buildRule({} as SignalRule, d), patch)));
    setPendingRec(null);
    setRecApplied(true);
  };
  const errCounts = errorCountBySection(errors);
  const summary = summarize(draft);
  const side = navLayout === 'side';
  const meta = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  // 섹션 우측의 충족 개수 선택
  const headerAction = (() => {
    switch (section) {
      case 'profit':
        return (
          <CountSelect mode="count" count={draft.sell_profit_count} enabled={enabledProfitCount(draft)} disabled={readOnly}
            onChange={(m, c) => setDraft((d) => ({ ...d, sell_profit_count: groupValue(m, c) }))} label="수익 실현 충족 개수" />
        );
      case 'risk':
        return (
          <CountSelect mode="count" count={draft.sell_risk_count} enabled={enabledRiskCount(draft)} disabled={readOnly}
            onChange={(m, c) => setDraft((d) => ({ ...d, sell_risk_count: groupValue(m, c) }))} label="위험 관리 충족 개수" />
        );
      case 'buy':
        return (
          <CountSelect mode={draft.buy_mode} count={draft.buy_min_count} enabled={enabledBuyCount(draft)} disabled={readOnly}
            onChange={(m, c) => setDraft((d) => ({ ...d, buy_mode: m, buy_min_count: c }))} label="매수 조건 충족 개수" />
        );
      default:
        return null;
    }
  })();

  const navItem = (s: SectionMeta) => {
    const active = s.id === section;
    const ec = errCounts[s.id] ?? 0;
    return (
      <button
        key={s.id}
        type="button"
        aria-current={active ? 'page' : undefined}
        onClick={() => onSection(s.id)}
        className={`flex shrink-0 items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm transition-colors ${side ? 'lg:w-full' : ''} ${
          active ? 'bg-white/[0.09] text-white' : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200'
        }`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />
        <span className="whitespace-nowrap">{s.title}</span>
        {ec > 0 && (
          <span className="num rounded-full bg-rose-500/20 px-1.5 text-[10px] leading-4 text-rose-300" aria-label={`오류 ${ec}개`}>
            {ec}
          </span>
        )}
        {side && <span className="num ml-auto hidden whitespace-nowrap pl-1 text-[11px] text-zinc-500 lg:inline">{sectionStatus(draft, s.id)}</span>}
      </button>
    );
  };

  return (
    <div className="space-y-3.5">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="label-mono">프리셋</span>
          <div className="glass-pill flex p-0.5" role="group" aria-label="프리셋">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => applyPreset(p.values)} className="pill-item !px-3 !py-1 !text-xs">
                {p.label}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-zinc-600">기준 값만 채우며 켜짐 상태는 유지됩니다</span>
        </div>
      )}

      {!readOnly && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="label-mono">추천 전략</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="추천 전략">
              {RECOMMENDED_STRATEGIES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  title={r.summary}
                  aria-pressed={pendingRec?.id === r.id}
                  onClick={() => {
                    setRecApplied(false);
                    setPendingRec(r);
                  }}
                  className={`pill-item !px-3 !py-1 !text-xs whitespace-nowrap ${pendingRec?.id === r.id ? 'pill-item-active' : ''}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {recApplied && !pendingRec && <span className="text-[11px] text-mint-300">추천 설정을 채웠습니다 · 저장해야 적용됩니다</span>}
          </div>
          {pendingRec && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-2.5">
              <p className="min-w-0 flex-1 text-xs leading-relaxed text-amber-100">
                현재 편집 중인 조건을 '{pendingRec.label}' 추천 설정으로 바꿉니다. 저장해야 적용됩니다.
                <span className="mt-0.5 block text-zinc-400">{pendingRec.summary}</span>
              </p>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost !px-3 !py-1 !text-xs" onClick={() => setPendingRec(null)}>취소</button>
                <button type="button" className="btn-primary !px-3 !py-1 !text-xs" onClick={confirmRecommended}>적용</button>
              </div>
            </div>
          )}
        </div>
      )}

      {readOnly && readOnlyHint && <p className="text-xs text-zinc-500">{readOnlyHint}</p>}

      {/* 전략 요약 */}
      <div className="space-y-1 rounded-2xl border border-mint-400/20 bg-mint-400/[0.06] px-4 py-3 text-xs leading-relaxed text-zinc-300" aria-label="전략 요약">
        <p><span className="mr-1.5 font-semibold text-rose-300">매도 검토</span>— {summary.sell}</p>
        <p><span className="mr-1.5 font-semibold text-mint-300">매수 검토</span>— {summary.buy}</p>
      </div>

      {/* 섹션 목록 + 내용 (높이 고정: 섹션을 바꿔도 흔들리지 않는다) */}
      <div className={`flex h-[34rem] max-h-[70vh] flex-col gap-3 ${side ? 'lg:flex-row lg:gap-4' : ''}`}>
        <nav aria-label="전략 섹션" className={`shrink-0 ${side ? 'lg:w-48 lg:overflow-y-auto' : ''}`}>
          <div className={`flex gap-1 overflow-x-auto pb-1 ${side ? 'lg:flex-col lg:gap-0.5 lg:overflow-x-visible lg:pb-0' : ''}`}>
            {SECTIONS.map((s, i) => (
              <div key={s.id} className={`flex shrink-0 items-center gap-1 ${side ? 'lg:flex-col lg:items-stretch lg:gap-0.5' : ''}`}>
                {SECTIONS[i - 1]?.group !== s.group && (
                  <span className={`label-mono ${side ? 'lg:px-2.5 lg:pb-0.5 lg:pt-2' : 'pl-1.5'} !text-[10px]`}>{s.group}</span>
                )}
                {navItem(s)}
              </div>
            ))}
          </div>
        </nav>

        <section aria-label={meta.title} className={`flex min-h-0 min-w-0 flex-1 flex-col ${side ? 'lg:border-l lg:border-white/[0.07] lg:pl-4' : ''}`}>
          <div className="mb-2.5 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white">{meta.title}</h3>
              <p className="text-xs text-zinc-500">{meta.purpose}</p>
            </div>
            {headerAction}
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-16 pr-1">
            <SectionBody rd={rd} readOnly={readOnly} touched={touched} showNote={showNote} id={section} />
          </div>
        </section>
      </div>
    </div>
  );
}

interface ProfileRuleEditorProps {
  profile: SignalProfile;
  onSaved: (p: SignalProfile) => void;
  // 선택한 섹션을 부모가 들고 있으면 프로필을 바꿔도 유지된다
  section?: SectionId;
  onSectionChange?: (s: SectionId) => void;
}

// 프로필의 규칙을 편집하는 인라인 편집기 (ProfileManager 오른쪽 패널에 들어간다). profile 이 바뀌면 key 로 다시 마운트할 것.
export function ProfileRuleEditor({ profile, onSaved, section: sectionProp, onSectionChange }: ProfileRuleEditorProps) {
  const rd = useRuleDraft(profile.rule);
  const [localSection, setLocalSection] = useState<SectionId>(DEFAULT_SECTION);
  const section = sectionProp ?? localSection;
  const setSection = (s: SectionId) => {
    setLocalSection(s);
    onSectionChange?.(s);
  };
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [savedAt, setSavedAt] = useState(0);

  useEffect(() => {
    if (!savedAt) return;
    const t = window.setTimeout(() => setSavedAt(0), 2200);
    return () => window.clearTimeout(t);
  }, [savedAt]);

  const handleSave = async () => {
    setTouched(true);
    setSubmitError(null);
    if (rd.hasErrors) {
      const first = firstErrorSection(rd.errors);
      if (first) setSection(first);
      return;
    }
    try {
      setSaving(true);
      const saved = await apiClient.UpdateSignalProfile(profile.id, { rule: buildRule(profile.rule, rd.draft) });
      setSavedAt(Date.now());
      onSaved(saved);
    } catch (err) {
      setSubmitError(errorMessage(err, '전략 저장에 실패했습니다.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <RuleFields rd={rd} readOnly={false} touched={touched} showNote section={section} onSection={setSection} navLayout="side" />
      {submitError && <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{submitError}</div>}
      <div className="mt-5 flex items-center justify-end gap-3">
        {touched && rd.hasErrors && <span className="mr-auto text-xs text-rose-300">입력값을 확인하세요</span>}
        {savedAt > 0 && <span className="text-xs text-mint-300">저장했습니다</span>}
        <button type="button" onClick={handleSave} disabled={saving || (touched && rd.hasErrors)} className="btn-primary">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          전략 저장
        </button>
      </div>
    </div>
  );
}

interface SignalRuleEditorProps {
  assetId: number;
  assetName: string;
  profiles: SignalProfile[];
  currentProfileId?: number; // 현재 이 종목이 속한 프로필
  assetRule?: SignalRule | null; // 이미 개별 전략이 있으면 전달
  onClose: () => void;
  onSaved: () => void;
  /** true 면 팝업 대신 상세 패널 안에 그대로 그린다 (섹션 목록은 왼쪽 세로 배치) */
  inline?: boolean;
}

// 종목별 전략 설정: 프로필 따르기 / 이 종목만 개별 전략
export default function SignalRuleEditor({ assetId, assetName, profiles, currentProfileId, assetRule, onClose, onSaved, inline = false }: SignalRuleEditorProps) {
  const fallbackProfile = profiles.find((p) => p.key === 'default') ?? profiles[0];
  const [choice, setChoice] = useState<'profile' | 'own'>(assetRule ? 'own' : 'profile');
  const [profileId, setProfileId] = useState<number>(currentProfileId ?? fallbackProfile?.id ?? 0);
  const selected = profiles.find((p) => p.id === profileId) ?? fallbackProfile;
  const emptyRule = {} as SignalRule;
  const rd = useRuleDraft(assetRule ?? selected?.rule ?? emptyRule);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [section, setSection] = useState<SectionId>(DEFAULT_SECTION);

  useEffect(() => {
    if (inline) return; // 패널 안에서는 Esc 로 닫지 않는다
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, inline]);

  const readOnly = choice === 'profile';

  const pickChoice = (c: 'profile' | 'own') => {
    setChoice(c);
    // 개별 전략으로 전환하면 기존 개별 전략, 없으면 선택된 프로필 값에서 시작
    rd.setDraft(toDraft(c === 'own' ? assetRule ?? selected?.rule ?? emptyRule : selected?.rule ?? emptyRule));
  };

  const pickProfile = (id: number) => {
    setProfileId(id);
    const p = profiles.find((x) => x.id === id);
    if (p) rd.setDraft(toDraft(p.rule));
  };

  const handleSave = async () => {
    setTouched(true);
    setSubmitError(null);
    if (!readOnly && rd.hasErrors) {
      const first = firstErrorSection(rd.errors);
      if (first) setSection(first);
      return;
    }
    try {
      setSaving(true);
      if (choice === 'profile') {
        if (assetRule) await apiClient.DeleteAssetSignalRule(assetId);
        if (profileId && profileId !== currentProfileId) await apiClient.AssignSignalProfile(profileId, [assetId]);
      } else {
        const base: SignalRule = { ...(assetRule ?? selected?.rule ?? emptyRule), asset_id: assetId };
        if (!assetRule) delete base.id;
        await apiClient.SaveAssetSignalRule(assetId, buildRule(base, rd.draft));
      }
      onSaved();
    } catch (err) {
      setSubmitError(errorMessage(err, '전략 저장에 실패했습니다.'));
    } finally {
      setSaving(false);
    }
  };

  const choices: { value: 'profile' | 'own'; title: string; desc: string }[] = [
    { value: 'profile', title: '프로필 따르기', desc: '선택한 전략 프로필의 규칙을 그대로 사용합니다.' },
    { value: 'own', title: '이 종목만 개별 전략', desc: '이 종목에만 적용되는 규칙을 만듭니다. 시작 값은 프로필 값입니다.' },
  ];

  const body = (
    <>
          <div role="radiogroup" aria-label="전략 적용 방식" className="grid gap-2.5 sm:grid-cols-2">
            {choices.map((c) => {
              const active = choice === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => pickChoice(c.value)}
                  className={`surface-inset p-3.5 text-left transition-colors ${active ? '!border-mint-400/50 !bg-mint-400/[0.08]' : 'hover:!border-white/20'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${active ? 'border-mint-400' : 'border-white/25'}`}>
                      {active && <span className="h-2 w-2 rounded-full bg-mint-400" />}
                    </span>
                    <span className={`text-sm font-medium ${active ? 'text-white' : 'text-zinc-300'}`}>{c.title}</span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{c.desc}</p>
                </button>
              );
            })}
          </div>

          {choice === 'profile' && (
            <div>
              <label className="field-label" htmlFor="asset-profile-select">전략 프로필</label>
              <select id="asset-profile-select" className="input-field" value={profileId} onChange={(e) => pickProfile(Number(e.target.value))}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.built_in ? ' (기본 제공)' : ''}
                    {p.kind === 'dividend' ? ' · 배당형' : ''}
                  </option>
                ))}
              </select>
              {selected?.description && <p className="mt-1.5 text-xs text-zinc-500">{selected.description}</p>}
              {assetRule && <p className="mt-1.5 text-xs text-amber-200">저장하면 이 종목의 기존 개별 전략은 삭제됩니다.</p>}
            </div>
          )}

          <RuleFields
            rd={rd}
            readOnly={readOnly}
            touched={touched}
            showNote={false}
            section={section}
            onSection={setSection}
            navLayout={inline ? 'side' : 'pills'}
            readOnlyHint={`선택한 프로필(${selected?.name ?? ''})의 규칙입니다. 값을 바꾸려면 프로필 관리에서 수정하거나 '이 종목만 개별 전략'을 선택하세요.`}
          />

          {submitError && (
            <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{submitError}</div>
          )}
    </>
  );

  const footer = (
    <>
      {touched && rd.hasErrors && !readOnly && <span className="mr-auto text-xs text-rose-300">입력값을 확인하세요</span>}
      <button type="button" onClick={onClose} className="btn-ghost">취소</button>
      <button type="button" onClick={handleSave} disabled={saving || (!readOnly && touched && rd.hasErrors)} className="btn-primary">
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        저장
      </button>
    </>
  );

  if (inline) {
    return (
      <div className="space-y-5" aria-label="종목별 전략 설정">
        {body}
        <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] pt-4">{footer}</div>
      </div>
    );
  }

  return createPortal(
    // 입력 중인 값을 잃지 않도록 바깥을 눌러도 닫지 않는다
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="종목별 전략 설정"
        className="surface flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="section-title !text-lg">종목별 전략 설정</h2>
            <p className="label-mono mt-0.5 truncate">{assetName}</p>
          </div>
          <button type="button" onClick={onClose} className="btn-icon" aria-label="닫기">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">{body}</div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] px-5 py-4 sm:px-6">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}
