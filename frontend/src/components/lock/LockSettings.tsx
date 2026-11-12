import { useEffect, useState, type ReactNode } from 'react';
import { Check, Copy, X } from 'lucide-react';
import Portal from '../ui/Portal';
import CardIcon from '../ui/CardIcon';
import { IconLock } from '../ui/appIcons';
import { appLock, desktop, type LockStatus } from '../../platform/desktop';
import { PIN_LENGTH, weakPin } from './pin';

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : '처리하지 못했습니다.');
const digits = (s: string) => s.replace(/\D/g, '').slice(0, PIN_LENGTH);

function PinInput({ label, value, onChange, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-zinc-300">{label}</span>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={PIN_LENGTH}
        value={value}
        onChange={(e) => onChange(digits(e.target.value))}
        className="input-field num tracking-[0.4em]"
        placeholder="••••••"
        autoFocus={autoFocus}
      />
    </label>
  );
}

function Section({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3 py-5 first:pt-0 last:pb-0">
      <div>
        <h4 className="text-sm font-medium text-white">{title}</h4>
        {desc && <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

function Note({ ok, text }: { ok: boolean; text: string | null }) {
  if (!text) return null;
  return <p className={`rounded-lg border px-3 py-2 text-xs ${ok ? 'border-mint-400/30 bg-mint-400/10 text-mint-200' : 'border-rose-400/30 bg-rose-500/10 text-rose-200'}`}>{text}</p>;
}

/** 잠금 설정: 이 PC 기억하기, PIN 바꾸기, 복구 코드 새로 만들기 (바깥을 눌러도 닫히지 않는다) */
export default function LockSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<LockStatus | null>(null);
  const [trustMsg, setTrustMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [pinMsg, setPinMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [codePin, setCodePin] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [codeMsg, setCodeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTrustMsg(null);
    setPinMsg(null);
    setCodeMsg(null);
    setCode(null);
    setCur('');
    setNext('');
    setAgain('');
    setCodePin('');
    appLock
      .status()
      .then(setStatus)
      .catch((e) => setTrustMsg({ ok: false, text: errText(e) }));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const toggleTrust = () =>
    run(async () => {
      if (!status) return;
      try {
        const s = await appLock.setTrusted(!status.trusted);
        setStatus(s);
        setTrustMsg({ ok: true, text: s.trusted ? '이 PC를 기억했습니다. 다음부터 PIN 없이 열립니다.' : '기억을 해제했습니다. 다음에 켤 때부터 PIN을 묻습니다.' });
      } catch (e) {
        setTrustMsg({ ok: false, text: errText(e) });
      }
    });

  const changePin = () =>
    run(async () => {
      setPinMsg(null);
      if (cur.length !== PIN_LENGTH) return setPinMsg({ ok: false, text: `지금 PIN ${PIN_LENGTH}자리를 입력하세요.` });
      const weak = weakPin(next);
      if (weak) return setPinMsg({ ok: false, text: weak });
      if (next !== again) return setPinMsg({ ok: false, text: '새 PIN 두 번이 서로 다릅니다.' });
      try {
        await appLock.changePin(cur, next);
        setCur('');
        setNext('');
        setAgain('');
        setPinMsg({ ok: true, text: 'PIN을 바꿨습니다.' });
      } catch (e) {
        setPinMsg({ ok: false, text: errText(e) });
      }
    });

  const newCode = () =>
    run(async () => {
      setCodeMsg(null);
      if (codePin.length !== PIN_LENGTH) return setCodeMsg({ ok: false, text: `PIN ${PIN_LENGTH}자리를 입력하세요.` });
      try {
        setCode(await appLock.newRecoveryCode(codePin));
        setCodePin('');
        setCodeMsg({ ok: true, text: '새 복구 코드입니다. 이전 코드는 이제 쓸 수 없어요. 지금 적어 두세요.' });
      } catch (e) {
        setCodeMsg({ ok: false, text: errText(e) });
      }
    });

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
        <div className="surface flex max-h-[92vh] w-full max-w-md flex-col" role="dialog" aria-modal="true" aria-label="잠금 설정">
          <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
            <div className="flex items-center gap-3">
              <CardIcon icon={IconLock} size="sm" />
              <div>
                <h3 className="section-title">잠금 설정</h3>
                <p className="mt-0.5 text-xs text-zinc-500">앱을 켤 때 묻는 PIN · 이 PC에만 적용</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white" aria-label="닫기">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="divide-y divide-white/[0.06] overflow-y-auto px-5 py-5">
            <Section
              title="이 PC 기억하기"
              desc={status ? (status.trusted ? `이 PC(${status.device})는 기억되어 있어 앱을 켤 때 PIN을 묻지 않습니다.` : `이 PC(${status.device})에서는 앱을 켤 때마다 PIN을 묻습니다.`) : ' '}
            >
              <button type="button" className={status?.trusted ? 'btn-ghost' : 'btn-primary'} onClick={toggleTrust} disabled={busy || !status}>
                {status?.trusted ? '기억 해제 (다음부터 PIN 묻기)' : '이 PC 기억하기'}
              </button>
              <Note ok={!!trustMsg?.ok} text={trustMsg?.text ?? null} />
            </Section>

            <Section title="PIN 바꾸기" desc="같은 숫자만이나 이어지는 숫자(123456 등)는 쓸 수 없습니다.">
              <PinInput label="지금 PIN" value={cur} onChange={setCur} />
              <div className="grid grid-cols-2 gap-3">
                <PinInput label="새 PIN" value={next} onChange={setNext} />
                <PinInput label="새 PIN 확인" value={again} onChange={setAgain} />
              </div>
              <button type="button" className="btn-ghost" onClick={changePin} disabled={busy}>
                PIN 바꾸기
              </button>
              <Note ok={!!pinMsg?.ok} text={pinMsg?.text ?? null} />
            </Section>

            <Section title="복구 코드 새로 만들기" desc="복구 코드를 잃어버렸을 때. PIN을 잊으면 이 코드로 새 PIN을 만듭니다.">
              {code ? (
                <div className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
                  <span className="num select-all font-mono text-lg tracking-[0.15em] text-white">{code}</span>
                  <button
                    type="button"
                    className="btn-ghost !px-3 !py-1.5 !text-xs"
                    onClick={async () => {
                      if (await desktop.copyText(code)) {
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 2000);
                      }
                    }}
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? '복사했어요' : '복사'}
                  </button>
                </div>
              ) : (
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <PinInput label="PIN 확인" value={codePin} onChange={setCodePin} />
                  </div>
                  <button type="button" className="btn-ghost" onClick={newCode} disabled={busy}>
                    새로 만들기
                  </button>
                </div>
              )}
              <Note ok={!!codeMsg?.ok} text={codeMsg?.text ?? null} />
            </Section>
          </div>
        </div>
      </div>
    </Portal>
  );
}
