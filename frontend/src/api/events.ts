import { EventsOn } from '../../wailsjs/runtime/runtime';
import type { SignalEvent } from '../types/models';

const isWeb = !(window as any).go;

/** 데스크톱 앱의 백그라운드 점검이 새 신호 이벤트를 찾았을 때 호출된다. 웹에서는 아무 일도 하지 않는다. */
export function onSignalsNew(cb: (events: SignalEvent[]) => void): () => void {
  if (isWeb) return () => {};
  const off = EventsOn('signals:new', (payload: unknown) => {
    const list = Array.isArray(payload) ? (payload as SignalEvent[]) : payload ? [payload as SignalEvent] : [];
    if (list.length > 0) cb(list);
  });
  return typeof off === 'function' ? off : () => {};
}
