export const PIN_LENGTH = 6;

/** 서버(services/lock_service.go checkPIN)와 같은 규칙: 숫자 6자리, 같은 숫자만·이어지는 숫자는 안 된다 */
export function weakPin(pin: string): string | null {
  if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) return `PIN은 숫자 ${PIN_LENGTH}자리입니다.`;
  let same = true;
  let up = true;
  let down = true;
  for (let i = 1; i < pin.length; i++) {
    const d = pin.charCodeAt(i) - pin.charCodeAt(i - 1);
    same &&= d === 0;
    up &&= d === 1 || d === -9;
    down &&= d === -1 || d === 9;
  }
  return same || up || down ? '같은 숫자만이나 이어지는 숫자(123456 등)는 쓸 수 없어요.' : null;
}
