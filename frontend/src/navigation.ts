import { useCallback, useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeftRight, BarChart3, Calendar, Camera, Coins, DollarSign, Radar, SlidersHorizontal, TrendingUp, Wallet } from 'lucide-react';

export type RouteId = 'accounts' | 'assets' | 'trades' | 'portfolio' | 'dividends' | 'stats' | 'yearly' | 'signals' | 'profiles' | 'candidates';

export interface NavItem {
  id: RouteId;
  /** 사이드바에 보이는 짧은 이름 */
  label: string;
  /** 상단 바 페이지 제목 */
  title: string;
  icon: LucideIcon;
  isNew?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// 사이드바 묶음. 통계 분리(자산 추이 / 배당 분석)는 이후 단계에서 한다.
export const NAV_GROUPS: NavGroup[] = [
  {
    label: '자산',
    items: [
      { id: 'accounts', label: '계좌', title: '계좌 관리', icon: Wallet },
      { id: 'assets', label: '주식/ETF', title: '주식/ETF 관리', icon: TrendingUp },
      { id: 'trades', label: '매매 기록', title: '매매 관리', icon: ArrowLeftRight },
      { id: 'portfolio', label: '포트폴리오', title: '포트폴리오 스냅샷', icon: Camera },
    ],
  },
  {
    label: '배당',
    items: [
      { id: 'dividends', label: '배당 기록', title: '배당금 관리', icon: DollarSign },
      { id: 'stats', label: '통계', title: '배당금 대시보드', icon: BarChart3 },
      { id: 'yearly', label: '연간 현황', title: '연간 배당금 현황', icon: Calendar },
    ],
  },
  {
    label: '신호',
    items: [
      { id: 'signals', label: '매매 신호', title: '매매 신호', icon: Radar, isNew: true },
      { id: 'profiles', label: '전략 프로필', title: '전략 프로필', icon: SlidersHorizontal },
      { id: 'candidates', label: '배당 후보', title: '배당 종목 정리', icon: Coins },
    ],
  },
];

export const NAV_ITEMS_BY_ID = Object.fromEntries(NAV_GROUPS.flatMap((g) => g.items).map((i) => [i.id, i])) as Record<RouteId, NavItem>;

export const DEFAULT_ROUTE: RouteId = 'accounts';

export function parseRoute(hash: string): RouteId {
  const id = hash.replace(/^#\/?/, '');
  return id in NAV_ITEMS_BY_ID ? (id as RouteId) : DEFAULT_ROUTE;
}

/** 현재 페이지를 URL 해시(#signals 등)에 두어 새로고침·뒤로 가기에도 유지한다. */
export function useHashRoute(): [RouteId, (id: RouteId) => void] {
  const [route, setRoute] = useState<RouteId>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((id: RouteId) => {
    if (window.location.hash === `#${id}`) setRoute(id);
    else window.location.hash = id;
  }, []);

  return [route, navigate];
}
