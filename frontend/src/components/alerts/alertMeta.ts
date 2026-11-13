import type { SignalAction, SignalEvent } from '../../types/models';

export interface AlertTone {
  label: string;
  dot: string;
  text: string;
  badge: string;
}

const TONES: Record<string, AlertTone> = {
  SELL: { label: '매도 검토', dot: 'bg-rose-400', text: 'text-rose-300', badge: 'border border-rose-400/30 bg-rose-500/10 text-rose-200' },
  BUY: { label: '매수 검토', dot: 'bg-mint-400', text: 'text-mint-300', badge: 'border border-mint-400/30 bg-mint-400/10 text-mint-300' },
  CONFLICT: { label: '신호 충돌', dot: 'bg-amber-400', text: 'text-amber-300', badge: 'border border-amber-400/30 bg-amber-400/10 text-amber-200' },
  SUGGEST: { label: '제안', dot: 'bg-sky-400', text: 'text-sky-300', badge: 'border border-sky-400/30 bg-sky-400/10 text-sky-200' },
  HOLDING: { label: '보유 확인', dot: 'bg-orange-400', text: 'text-orange-300', badge: 'border border-orange-400/30 bg-orange-400/10 text-orange-200' },
  CLEARED: { label: '해제', dot: 'bg-zinc-500', text: 'text-zinc-400', badge: 'border border-white/10 bg-white/[0.04] text-zinc-400' },
};

/** 신호가 해제(관망·시세 없음 등 매도/매수/충돌이 아닌 상태)로 돌아간 이벤트인지 */
export function isSuggestion(e: Pick<SignalEvent, 'to_action' | 'kind'>): boolean {
  return e.kind === 'suggestion' || e.to_action === 'SUGGEST';
}

/** 배당 기록으로 본 보유 수량이 앱과 다르다는 알림인지 */
export function isHoldingCheck(e: Pick<SignalEvent, 'to_action' | 'kind'>): boolean {
  return e.kind === 'holding' || e.to_action === 'HOLDING';
}

export function isCleared(e: Pick<SignalEvent, 'to_action' | 'kind'>): boolean {
  if (isSuggestion(e) || isHoldingCheck(e)) return false;
  return e.to_action !== 'SELL' && e.to_action !== 'BUY' && e.to_action !== 'CONFLICT';
}

export function toneOf(action: SignalAction | 'SUGGEST' | 'HOLDING' | ''): AlertTone {
  return TONES[action as string] ?? TONES.CLEARED;
}

export function eventTone(e: SignalEvent): AlertTone {
  if (isSuggestion(e)) return TONES.SUGGEST;
  if (isHoldingCheck(e)) return TONES.HOLDING;
  return isCleared(e) ? TONES.CLEARED : TONES[e.to_action];
}

const SHORT: Record<string, string> = { SELL: '매도', BUY: '매수', CONFLICT: '충돌', HOLD: '관망', NO_PRICE: '시세 없음', '': '신규', SUGGEST: '제안', HOLDING: '보유 확인' };
export function shortLabel(a: SignalAction | 'SUGGEST' | 'HOLDING' | ''): string {
  return SHORT[a] ?? a;
}

function parse(iso: string): Date {
  return new Date(iso);
}

/** "방금 전", "3분 전", "2시간 전", "어제", "3일 전", 그 이후는 날짜 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const d = parse(iso);
  const diffMs = now.getTime() - d.getTime();
  if (Number.isNaN(diffMs)) return '';
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (dayDiff <= 0) return `${hr}시간 전`;
  if (dayDiff === 1) return '어제';
  if (dayDiff < 7) return `${dayDiff}일 전`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export function clockTime(iso: string): string {
  const d = parse(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 날짜 그룹 제목: 오늘 / 어제 / 10월 28일 (화) */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = parse(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '어제';
  const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${wd})`;
}

export function dayKey(iso: string): string {
  const d = parse(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
