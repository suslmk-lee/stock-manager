import { useCallback, useEffect, useState } from 'react';
import { IconAccumulate, IconBars, IconCandidates, IconChart, IconCoin, IconLayers, IconPodium, IconRadar, IconSliders, IconTrades, IconTrend, IconWallet, type AppIcon } from './components/ui/appIcons';

export type RouteId = 'accounts' | 'assets' | 'trades' | 'accumulate' | 'pension' | 'trend' | 'dividends' | 'dividend-analysis' | 'dividend-score' | 'signals' | 'profiles' | 'candidates';
export type GroupId = 'assets' | 'dividends' | 'signals';

export interface NavItem {
  id: RouteId;
  /** 사이드바에 보이는 짧은 이름 */
  label: string;
  /** 상단 바 페이지 제목 */
  title: string;
  icon: AppIcon;
  isNew?: boolean;
}

export interface NavGroup {
  id: GroupId;
  label: string;
  /** 모바일 하단 탭 아이콘 */
  icon: AppIcon;
  items: NavItem[];
}

// 사이드바 묶음 = 모바일 하단 탭
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'assets',
    label: '자산',
    icon: IconWallet,
    items: [
      { id: 'accounts', label: '계좌', title: '계좌 관리', icon: IconWallet },
      { id: 'assets', label: '주식/ETF', title: '주식/ETF 관리', icon: IconTrend },
      { id: 'trades', label: '매매 기록', title: '매매 관리', icon: IconTrades },
      { id: 'accumulate', label: '모으기', title: '주식 모으기', icon: IconAccumulate, isNew: true },
      { id: 'pension', label: '퇴직연금', title: '퇴직연금 · 부담금 배분', icon: IconLayers, isNew: true },
      { id: 'trend', label: '자산 추이', title: '자산 추이', icon: IconChart },
    ],
  },
  {
    id: 'dividends',
    label: '배당',
    icon: IconCoin,
    items: [
      { id: 'dividends', label: '배당 기록', title: '배당금 관리', icon: IconCoin },
      { id: 'dividend-analysis', label: '배당 분석', title: '배당 분석', icon: IconBars },
      { id: 'dividend-score', label: '배당 점수', title: '배당 점수 · 월별 순위', icon: IconPodium, isNew: true },
    ],
  },
  {
    id: 'signals',
    label: '신호',
    icon: IconRadar,
    items: [
      { id: 'signals', label: '매매 신호', title: '매매 신호', icon: IconRadar, isNew: true },
      { id: 'profiles', label: '전략 프로필', title: '전략 프로필', icon: IconSliders },
      { id: 'candidates', label: '배당 후보', title: '배당 종목 정리', icon: IconCandidates },
    ],
  },
];

export const NAV_ITEMS_BY_ID = Object.fromEntries(NAV_GROUPS.flatMap((g) => g.items).map((i) => [i.id, i])) as Record<RouteId, NavItem>;
export const GROUP_OF = Object.fromEntries(NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.id, g.id]))) as Record<RouteId, GroupId>;

export const DEFAULT_ROUTE: RouteId = 'accounts';

// 예전 탭 주소 → 새 페이지 (하위 탭은 각 페이지가 해시를 보고 고른다)
const ROUTE_ALIASES: Record<string, RouteId> = {
  stats: 'trend',
  portfolio: 'trend',
  yearly: 'dividend-analysis',
};

const hashId = (hash: string) => hash.replace(/^#\/?/, '');

export function parseRoute(hash: string): RouteId {
  const id = hashId(hash);
  if (id in NAV_ITEMS_BY_ID) return id as RouteId;
  return ROUTE_ALIASES[id] ?? DEFAULT_ROUTE;
}

/** 지금 주소가 예전 탭 주소(예: #portfolio)인지 — 새 페이지가 처음 고를 하위 탭을 정할 때 쓴다 */
export function currentHashId(): string {
  return hashId(window.location.hash);
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
