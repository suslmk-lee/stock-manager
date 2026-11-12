import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Check, Copy, KeyRound, Loader2, RefreshCw } from 'lucide-react';
import Brand from '../ui/Brand';
import PinPad from './PinPad';
import { PIN_LENGTH, weakPin } from './pin';
import { appLock, desktop, type LockStatus } from '../../platform/desktop';

/**
 * 앱 잠금 — 데스크톱 앱을 켜면 이 PC의 6자리 PIN을 먼저 묻는다 (PC마다 따로).
 * 처음 실행이면 PIN을 만들고, 이 PC를 기억해 두었으면 바로 연다.
 * 잠금이 풀리기 전에는 앱(데이터를 부르는 화면)을 그리지 않는다. 웹·모바일에서는 그냥 통과한다.
 */

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : '처리하지 못했습니다.');

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="app-bg flex min-h-screen flex-col">
      {/* 맥: 제목 표시줄 자리 — 잡고 끌어 창을 옮긴다 */}
      <div className="drag-region h-14 shrink-0" aria-hidden />
      <main className="flex flex-1 items-center justify-center px-4 pb-14">
        <div className="w-full max-w-[380px] text-center">
          <div className="mb-8 flex justify-center">
            <Brand wordmark="show" tagline={false} />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

function Remember({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="mx-auto mt-7 flex w-fit cursor-pointer select-none items-center gap-2 text-[13px] text-zinc-300">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--c-mint-400))]" />
      이 PC 기억하기
      <span className="text-zinc-500">· 다음부터 PIN 없이 열기</span>
    </label>
  );
}

function Message({ text, tone = 'error' }: { text: string | null; tone?: 'error' | 'muted' }) {
  return <p className={`mt-5 min-h-[2.5rem] text-[13px] leading-relaxed ${tone === 'error' ? 'text-rose-300' : 'text-zinc-500'}`}>{text ?? ''}</p>;
}

// ───────────────────────── 처음 실행: PIN 만들기 ─────────────────────────

function SetupScreen({ device, onDone }: { device: string; onDone: (status: LockStatus, recoveryCode: string) => void }) {
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [first, setFirst] = useState('');
  const [value, setValue] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);

  const fail = (msg: string) => {
    setError(msg);
    setShake((n) => n + 1);
    setValue('');
  };

  const complete = async (pin: string) => {
    if (step === 'enter') {
      const weak = weakPin(pin);
      if (weak) return fail(weak);
      setFirst(pin);
      setValue('');
      setError(null);
      setStep('confirm');
      return;
    }
    if (pin !== first) {
      setStep('enter');
      setFirst('');
      return fail('두 번 입력한 PIN이 다릅니다. 처음부터 다시 입력해 주세요.');
    }
    setBusy(true);
    try {
      const r = await appLock.setup(pin, remember);
      onDone(r.status, r.recovery_code);
    } catch (e) {
      setStep('enter');
      setFirst('');
      fail(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <h1 className="text-xl font-semibold text-white">{step === 'enter' ? '이 PC의 PIN을 만들어 주세요' : '한 번 더 입력해 주세요'}</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
        {step === 'enter' ? (
          <>
            앱을 켤 때 묻는 숫자 {PIN_LENGTH}자리입니다.
            <br />
            PC마다 따로 정합니다 · <span className="text-zinc-300">{device}</span>
          </>
        ) : (
          '확인을 위해 같은 PIN을 다시 입력합니다.'
        )}
      </p>
      <div className="mt-9">
        <PinPad label={step === 'enter' ? '새 PIN' : 'PIN 확인'} value={value} onChange={setValue} onComplete={complete} disabled={busy} shake={shake} />
      </div>
      {step === 'confirm' && <Remember checked={remember} onChange={setRemember} />}
      <Message text={busy ? '저장하는 중…' : error} tone={busy ? 'muted' : 'error'} />
    </Shell>
  );
}

// ───────────────────────── 복구 코드 보여 주기 (한 번만) ─────────────────────────

function RecoveryCodeScreen({ code, onContinue }: { code: string; onContinue: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Shell>
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-mint-400/15 text-mint-300">
        <KeyRound className="h-6 w-6" />
      </div>
      <h1 className="text-xl font-semibold text-white">복구 코드를 적어 두세요</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
        PIN을 잊었을 때 이 코드로 새 PIN을 만듭니다.
        <br />
        지금 한 번만 보여 드려요. 안전한 곳에 적어 두세요.
      </p>
      <div className="surface-inset mt-7 px-4 py-5">
        <p className="num select-all font-mono text-[22px] font-medium tracking-[0.18em] text-white">{code}</p>
        <button
          type="button"
          className="btn-ghost mt-4 !px-3 !py-1.5 !text-xs"
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
      <button type="button" className="btn-primary mt-7 w-full" onClick={onContinue} autoFocus>
        적어 두었어요 · 시작하기
      </button>
      <p className="mt-3 text-[11px] text-zinc-500">잃어버렸으면 나중에 '잠금 설정'에서 PIN으로 새로 만들 수 있습니다.</p>
    </Shell>
  );
}

// ───────────────────────── 잠금 풀기 · PIN 잊음 ─────────────────────────

function useCountdown(seconds: number | undefined, stamp: number) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!seconds || seconds <= 0) {
      setLeft(0);
      return;
    }
    const until = Date.now() + seconds * 1000;
    const tick = () => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    tick();
    const t = window.setInterval(tick, 250);
    return () => window.clearInterval(t);
  }, [seconds, stamp]);
  return left;
}

const waitText = (sec: number) => (sec >= 3600 ? `${Math.ceil(sec / 3600)}시간` : sec >= 60 ? `${Math.floor(sec / 60)}분 ${String(sec % 60).padStart(2, '0')}초` : `${sec}초`);

function UnlockScreen({ initial, onUnlocked }: { initial: LockStatus; onUnlocked: (s: LockStatus) => void }) {
  const [status, setStatus] = useState(initial);
  const [stamp, setStamp] = useState(0); // 같은 대기 시간이 다시 와도 카운트다운을 새로 시작
  const [mode, setMode] = useState<'pin' | 'code' | 'new' | 'confirm'>('pin');
  const [value, setValue] = useState('');
  const [code, setCode] = useState('');
  const [first, setFirst] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const wait = useCountdown(status.retry_after, stamp);

  const apply = (s: LockStatus) => {
    if (s.state === 'unlocked') return onUnlocked(s);
    setStatus(s);
    setStamp((n) => n + 1);
    setError(s.error ?? null);
    setShake((n) => n + 1);
    setValue('');
  };

  const unlock = async (pin: string) => {
    setBusy(true);
    try {
      apply(await appLock.unlock(pin, remember));
    } catch (e) {
      setError(errText(e));
      setValue('');
    } finally {
      setBusy(false);
    }
  };

  const recover = async (pin: string) => {
    if (mode === 'new') {
      const weak = weakPin(pin);
      if (weak) {
        setError(weak);
        setShake((n) => n + 1);
        setValue('');
        return;
      }
      setFirst(pin);
      setValue('');
      setError(null);
      setMode('confirm');
      return;
    }
    if (pin !== first) {
      setMode('new');
      setFirst('');
      setError('두 번 입력한 PIN이 다릅니다. 새 PIN을 다시 입력해 주세요.');
      setShake((n) => n + 1);
      setValue('');
      return;
    }
    setBusy(true);
    try {
      const s = await appLock.recover(code, pin, remember);
      if (s.state === 'unlocked') return onUnlocked(s);
      // 복구 코드가 틀렸으면 코드부터 다시
      setMode('code');
      setFirst('');
      apply(s);
    } catch (e) {
      setError(errText(e));
      setValue('');
    } finally {
      setBusy(false);
    }
  };

  const toCode = () => {
    setMode('code');
    setValue('');
    setError(null);
  };
  const toPin = () => {
    setMode('pin');
    setValue('');
    setCode('');
    setFirst('');
    setError(null);
  };

  const waiting = wait > 0;
  const message = waiting ? `너무 많이 틀렸습니다. ${waitText(wait)} 뒤에 다시 입력할 수 있어요.` : error;

  if (mode === 'code') {
    const ok = code.replace(/[^0-9a-z]/gi, '').length === 12;
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-white">복구 코드를 입력하세요</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">PIN을 만들 때 받은 12자리 코드입니다 (예: ABCD-EFGH-JKLM).</p>
        <form
          className="mt-8"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ok || waiting) return;
            setError(null);
            setMode('new');
          }}
        >
          <input
            className="input-field num text-center font-mono !text-lg uppercase tracking-[0.15em]"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX"
            maxLength={16}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            aria-label="복구 코드"
          />
          <button type="submit" className="btn-primary mt-4 w-full" disabled={!ok || waiting}>
            다음 · 새 PIN 정하기
          </button>
        </form>
        <Message text={message} />
        <button type="button" onClick={toPin} className="text-[13px] text-zinc-400 hover:text-white">
          PIN으로 열기
        </button>
      </Shell>
    );
  }

  const recovering = mode === 'new' || mode === 'confirm';
  return (
    <Shell>
      <h1 className="text-xl font-semibold text-white">{mode === 'pin' ? 'PIN을 입력하세요' : mode === 'new' ? '새 PIN을 정해 주세요' : '새 PIN을 한 번 더'}</h1>
      <p className="mt-2 text-[13px] text-zinc-400">
        {recovering ? '복구 코드가 맞으면 이 PIN으로 바뀝니다.' : <span className="text-zinc-300">{status.device}</span>}
      </p>
      <div className="mt-9">
        <PinPad
          label={mode === 'pin' ? 'PIN' : '새 PIN'}
          value={value}
          onChange={(v) => {
            setValue(v);
            if (v.length === 1 && !waiting) setError(null);
          }}
          onComplete={mode === 'pin' ? unlock : recover}
          disabled={busy || waiting}
          shake={shake}
        />
      </div>
      {(mode === 'pin' || mode === 'confirm') && <Remember checked={remember} onChange={setRemember} />}
      <Message text={busy ? '확인하는 중…' : message} tone={busy ? 'muted' : 'error'} />
      {mode === 'pin' ? (
        <button type="button" onClick={toCode} className="text-[13px] text-zinc-400 hover:text-white">
          PIN을 잊었어요
        </button>
      ) : (
        <button type="button" onClick={toPin} className="text-[13px] text-zinc-400 hover:text-white">
          취소하고 PIN으로 열기
        </button>
      )}
    </Shell>
  );
}

// ───────────────────────── 문지기 ─────────────────────────

export default function LockGate({ children }: { children: ReactNode }) {
  const supported = appLock.supported();
  const [status, setStatus] = useState<LockStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setStatus(await appLock.status());
    } catch (e) {
      setLoadError(errText(e));
    }
  }, []);

  useEffect(() => {
    if (supported) load();
  }, [supported, load]);

  if (!supported) return <>{children}</>;

  if (loadError) {
    return (
      <Shell>
        <p className="text-sm text-rose-300">잠금 상태를 읽지 못했습니다: {loadError}</p>
        <button type="button" className="btn-ghost mt-5" onClick={load}>
          <RefreshCw className="h-4 w-4" />
          다시 시도
        </button>
      </Shell>
    );
  }
  if (!status) {
    return (
      <div className="flex min-h-screen items-center justify-center text-zinc-500" aria-label="불러오는 중">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (recoveryCode) return <RecoveryCodeScreen code={recoveryCode} onContinue={() => setRecoveryCode(null)} />;
  if (status.state === 'setup') {
    return (
      <SetupScreen
        device={status.device}
        onDone={(s, code) => {
          setRecoveryCode(code);
          setStatus(s);
        }}
      />
    );
  }
  if (status.state === 'locked') return <UnlockScreen initial={status} onUnlocked={setStatus} />;
  return <>{children}</>;
}
