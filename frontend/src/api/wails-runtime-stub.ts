// 웹 전용 빌드용 Wails 런타임 스텁 — 웹에는 Wails 이벤트가 없으므로 아무 동작도 하지 않는다.
export function EventsOn(_eventName: string, _callback: (...data: any[]) => void): () => void {
  return () => {};
}
export function EventsOff(_eventName: string, ..._additional: string[]): void {}
