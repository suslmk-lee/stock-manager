import { useState, useEffect } from 'react';
import { PageActions } from './components/shell/PageSlots';
import SplitView from './components/shell/SplitView';
import { apiClient } from './api/client';
import { Account, AccountType } from './types/models';
import { Plus, Trash2, Wallet, Pencil, Lock } from 'lucide-react';
import AccountDashboard from './components/AccountDashboard';
import CardIcon from './components/ui/CardIcon';
import { ACCOUNT_TYPES, getAccountType, getAccountTypeMeta, isRestrictedAccount } from './utils/accountType';
import { IconWallet } from './components/ui/appIcons';
import BrokerLogo from './components/ui/BrokerLogo';

const DOMESTIC_BROKERS = [
  '삼성증권',
  '미래에셋증권',
  '한국투자증권',
  'NH투자증권',
  '키움증권',
  'KB증권',
  '신한투자증권',
  '하나증권',
  '메리츠증권',
  '대신증권',
  '토스증권',
  '카카오증권',
  '유안타증권',
  '현대차증권',
  '교보증권',
  '유진투자증권',
  'IBK투자증권',
  '부국증권',
  '케이프투자증권',
  '하이투자증권',
  '기타',
];


const EMPTY_FORM = {
  name: '',
  broker: '',
  accountNumber: '',
  marketType: 'Domestic' as 'Domestic' | 'International',
  currency: 'KRW',
  description: '',
  accountType: 'General' as AccountType,
};


// 계좌 관리: 왼쪽 계좌 목록(인출 가능 / 인출 제한) + 오른쪽 계좌 상세 또는 추가·수정 폼
function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [split, setSplit] = useState<boolean | null>(null);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.GetAllAccounts();
      setAccounts(data as Account[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '계좌 목록을 불러오는데 실패했습니다.');
      console.error('Failed to load accounts:', err);
    } finally {
      setLoading(false);
    }
  };

  // 넓은 화면은 항상 계좌 하나를 보여 준다 (폼을 열었을 때는 제외)
  useEffect(() => {
    if (split !== true || showForm || accounts.length === 0) return;
    if (selectedId == null || !accounts.some((a) => a.id === selectedId)) setSelectedId(accounts[0].id);
  }, [split, showForm, accounts, selectedId]);

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData({ ...EMPTY_FORM });
  };

  const handleToggleCreateForm = () => {
    if (showForm && editingId === null) {
      closeForm();
      return;
    }
    setEditingId(null);
    setFormData({ ...EMPTY_FORM });
    setShowForm(true);
  };

  const handleEditAccount = (account: Account) => {
    setEditingId(account.id);
    setFormData({
      name: account.name,
      broker: account.broker || '',
      accountNumber: account.account_number || '',
      marketType: account.market_type as 'Domestic' | 'International',
      currency: account.currency,
      description: account.description || '',
      accountType: getAccountType(account),
    });
    setShowForm(true);
  };

  const handleSubmitAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId !== null) {
        await apiClient.UpdateAccount(
          editingId,
          formData.name,
          formData.broker,
          formData.accountNumber,
          formData.marketType,
          formData.currency,
          formData.description,
          formData.accountType
        );
      } else {
        const created = (await apiClient.CreateAccount(
          formData.name,
          formData.broker,
          formData.accountNumber,
          formData.marketType,
          formData.currency,
          formData.description,
          formData.accountType
        )) as Account | null;
        if (created?.id) setSelectedId(created.id);
      }
      closeForm();
      await loadAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : editingId !== null ? '계좌 수정에 실패했습니다.' : '계좌 생성에 실패했습니다.');
      console.error('Failed to save account:', err);
    }
  };

  const handleDeleteAccount = async (id: number) => {
    if (!confirm('정말로 이 계좌를 삭제하시겠습니까?')) return;

    try {
      await apiClient.DeleteAccount(id);
      if (selectedId === id) setSelectedId(null);
      await loadAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : '계좌 삭제에 실패했습니다.');
      console.error('Failed to delete account:', err);
    }
  };

  const pageActions = (
    <PageActions lead={<span className="label-mono">{accounts.length}개 계좌</span>}>
      <button onClick={handleToggleCreateForm} className="btn-primary shrink-0">
        <Plus className="w-4 h-4" />
        계좌 추가
      </button>
    </PageActions>
  );

  if (loading) {
    return (
      <>
        {pageActions}
        <div className="min-h-[50vh] flex items-center justify-center">
          <div className="label-mono text-sm">로딩 중...</div>
        </div>
      </>
    );
  }

  const liquidAccounts = accounts.filter((a) => !isRestrictedAccount(a));
  const restrictedAccounts = accounts.filter((a) => isRestrictedAccount(a));
  const selectedTypeMeta = ACCOUNT_TYPES.find((t) => t.value === formData.accountType);
  const selected = accounts.find((a) => a.id === selectedId) ?? null;

  const renderAccountRow = (account: Account) => {
    const typeMeta = getAccountTypeMeta(account);
    const active = !showForm && account.id === selectedId;
    return (
      <button
        key={account.id}
        type="button"
        onClick={() => {
          closeForm();
          setSelectedId(account.id);
        }}
        aria-current={active ? 'true' : undefined}
        className={`flex w-full items-center gap-3 border-b border-white/[0.04] px-4 py-3 text-left transition-colors ${
          active ? 'bg-mint-400/[0.08] shadow-[inset_3px_0_0_rgb(var(--c-mint-400))]' : 'hover:bg-white/[0.03]'
        }`}
      >
        <BrokerLogo broker={account.broker} className="h-8 w-20" />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${active ? 'font-medium text-white' : 'text-zinc-100'}`}>{account.name}</span>
          <span className="label-mono mt-0.5 block truncate">
            {account.broker} · {account.market_type === 'Domestic' ? '국내' : '해외'} · {account.currency}
          </span>
        </span>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs ${typeMeta.badgeClass}`}>
          {typeMeta.restricted && <Lock className="h-3 w-3" />}
          {typeMeta.short}
        </span>
      </button>
    );
  };

  const groupLabel = (label: string, count: number, restricted = false) => (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/[0.06] bg-ink-900/95 px-4 py-2 backdrop-blur">
      {restricted ? <Lock className="h-3.5 w-3.5 text-amber-300" /> : <Wallet className="h-3.5 w-3.5 text-mint-300" />}
      <span className="text-xs font-medium text-zinc-300">{label}</span>
      <span className={`label-mono ${restricted ? '!text-amber-300' : ''}`}>{count}개</span>
    </div>
  );

  const list = (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {liquidAccounts.length > 0 && (
        <section>
          {groupLabel('인출 가능 계좌', liquidAccounts.length)}
          {liquidAccounts.map(renderAccountRow)}
        </section>
      )}
      {restrictedAccounts.length > 0 && (
        <section>
          {groupLabel('인출 제한 계좌 · 연금/IRP', restrictedAccounts.length, true)}
          {restrictedAccounts.map(renderAccountRow)}
        </section>
      )}
    </div>
  );

  const form = (
    <div>
      <h2 className="section-title text-lg mb-4">{editingId !== null ? '계좌 수정' : '새 계좌 추가'}</h2>
      <form onSubmit={handleSubmitAccount} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="field-label">증권사 *</label>
            <select value={formData.broker} onChange={(e) => setFormData({ ...formData, broker: e.target.value })} className="input-field" required>
              <option value="">증권사를 선택하세요</option>
              {DOMESTIC_BROKERS.map((broker) => (
                <option key={broker} value={broker}>
                  {broker}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">시장 구분 *</label>
            <select
              value={formData.marketType}
              onChange={(e) => {
                const market = e.target.value as 'Domestic' | 'International';
                setFormData({ ...formData, marketType: market, currency: market === 'Domestic' ? 'KRW' : 'USD' });
              }}
              className="input-field"
            >
              <option value="Domestic">국내</option>
              <option value="International">해외</option>
            </select>
          </div>
        </div>
        <div>
          <label className="field-label">계좌 유형 *</label>
          <select value={formData.accountType} onChange={(e) => setFormData({ ...formData, accountType: e.target.value as AccountType })} className="input-field" required>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {selectedTypeMeta?.restricted && (
            <p className="flex items-center gap-1 text-xs text-amber-300 mt-1.5">
              <Lock className="w-3 h-3" />
              중도 인출이 제한되는 계좌로 분류됩니다
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="field-label">계좌명 *</label>
            <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="input-field" placeholder="예: 미국 주식 계좌" required />
          </div>
          <div>
            <label className="field-label">계좌번호</label>
            <input type="text" value={formData.accountNumber} onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })} className="input-field" placeholder="예: 123-45-678901" />
          </div>
        </div>
        <div>
          <label className="field-label">통화</label>
          <select value={formData.currency} onChange={(e) => setFormData({ ...formData, currency: e.target.value })} className="input-field">
            <option value="KRW">KRW (원)</option>
            <option value="USD">USD (달러)</option>
            <option value="EUR">EUR (유로)</option>
            <option value="JPY">JPY (엔)</option>
          </select>
        </div>
        <div>
          <label className="field-label">설명</label>
          <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="input-field" placeholder="계좌에 대한 설명을 입력하세요" rows={3} />
        </div>
        <div className="flex gap-3">
          <button type="submit" className="btn-primary flex-1">
            {editingId !== null ? '저장' : '생성'}
          </button>
          <button type="button" onClick={closeForm} className="btn-ghost flex-1">
            취소
          </button>
        </div>
      </form>
    </div>
  );

  const detail = showForm ? (
    form
  ) : selected ? (
    <AccountDashboard
      key={selected.id}
      account={selected}
      actions={
        <>
          <button onClick={() => handleEditAccount(selected)} className="btn-icon" title="계좌 수정" aria-label="계좌 수정">
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleDeleteAccount(selected.id)}
            className="btn-icon hover:!border-rose-400/40 hover:!text-rose-300"
            title="계좌 삭제"
            aria-label="계좌 삭제"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </>
      }
    />
  ) : (
    <p className="py-16 text-center text-sm text-zinc-400">왼쪽 목록에서 계좌를 고르세요.</p>
  );

  return (
    <div>
      {pageActions}

      {error && <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 text-rose-200 text-sm px-4 py-3 mb-6">{error}</div>}

      {accounts.length === 0 && !showForm ? (
        <div className="surface text-center py-14 px-4 text-zinc-400">
          <CardIcon icon={IconWallet} size="lg" className="mx-auto mb-4 block" />
          <p className="text-base sm:text-lg text-zinc-200">등록된 계좌가 없습니다.</p>
          <p className="label-mono mt-2">위의 "계좌 추가" 버튼을 눌러 새 계좌를 생성하세요.</p>
        </div>
      ) : (
        <SplitView
          listWidth={400}
          onSplitChange={setSplit}
          showDetail={showForm || selected != null}
          onBack={() => {
            closeForm();
            setSelectedId(null);
          }}
          backLabel="계좌 목록"
          list={list}
          detail={detail}
        />
      )}
    </div>
  );
}

export default App;
