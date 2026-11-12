import type { ReactNode } from 'react';
import type { AppIcon } from './appIcons';
import CardIcon from './CardIcon';

interface SettingsGroupProps {
  icon: AppIcon;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

// 두 색 아이콘 + 제목 헤더를 가진 설정 섹션 카드
export function SettingsGroup({ icon, title, children, action }: SettingsGroupProps) {
  return (
    <section className="surface-inset p-4">
      <div className="mb-3 flex items-center gap-3">
        <CardIcon icon={icon} size="sm" />
        <h3 className="section-title flex-1 min-w-0 truncate">{title}</h3>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

interface SettingRowProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

// 왼쪽 라벨 / 오른쪽 컨트롤 한 줄
export function SettingRow({ label, hint, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      {/* 라벨 폭을 고정해 여러 줄의 슬라이더 시작점을 맞춘다 */}
      <div className="w-28 min-w-0 shrink-0 sm:w-32">
        <div className="text-sm text-white">{label}</div>
        {hint && <div className="label-mono mt-0.5">{hint}</div>}
      </div>
      <div className="flex min-w-0 flex-1 justify-end">{children}</div>
    </div>
  );
}
