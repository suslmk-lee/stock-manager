import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Account, Asset, Transaction } from '../types/models';
import { Plus, ArrowUpCircle, ArrowDownCircle, TrendingUp } from 'lucide-react';

interface TransactionManagerProps {
  selectedAccountId?: number;
  onAccountChange?: (accountId: number) => void;
}

export default function TransactionManager({ selectedAccountId = 0, onAccountChange }: TransactionManagerProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<number>(selectedAccountId);
  const [formData, setFormData] = useState({
    accountId: 0,
    assetId: 0,
    type: 'Buy' as 'Buy' | 'Sell',
    date: new Date().toISOString().split('T')[0],
    price: '',
    quantity: '',
    fee: '',
    notes: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedAccountId > 0 && selectedAccountId !== selectedAccount) {
      setSelectedAccount(selectedAccountId);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    if (selectedAccount > 0) {
      loadTransactions(selectedAccount);
    }
  }, [selectedAccount]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [accountsData, assetsData] = await Promise.all([
        apiClient.GetAllAccounts(),
        apiClient.GetAllAssets()
      ]);
      setAccounts(accountsData as Account[]);
      setAssets(assetsData as Asset[]);
      
      if ((accountsData as Account[]).length > 0) {
        const firstAccount = (accountsData as Account[])[0];
        const accountToSelect = selectedAccountId > 0 ? selectedAccountId : firstAccount.id;
        setSelectedAccount(accountToSelect);
        setFormData(prev => ({ ...prev, accountId: accountToSelect }));
        if (onAccountChange) {
          onAccountChange(accountToSelect);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '데이터를 불러오는데 실패했습니다.');
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadTransactions = async (accountId: number) => {
    try {
      const transactionsData = await apiClient.GetTransactionsByAccount(accountId);
      setTransactions(transactionsData as Transaction[]);
    } catch (err) {
      console.error('Failed to load transactions:', err);
    }
  };

  const handleCreateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.CreateTransaction(
        formData.accountId,
        formData.assetId,
        formData.type,
        formData.date,
        parseFloat(formData.price),
        parseFloat(formData.quantity),
        parseFloat(formData.fee || '0'),
        formData.notes
      );
      setFormData({
        accountId: selectedAccount,
        assetId: 0,
        type: 'Buy',
        date: new Date().toISOString().split('T')[0],
        price: '',
        quantity: '',
        fee: '',
        notes: '',
      });
      setShowForm(false);
      if (selectedAccount > 0) {
        await loadTransactions(selectedAccount);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '거래 기록에 실패했습니다.');
      console.error('Failed to create transaction:', err);
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-slate-400">로딩 중...</div>;
  }

  if (accounts.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <TrendingUp className="w-16 h-16 mx-auto mb-4 opacity-50" />
        <p className="text-lg">먼저 계좌를 등록해주세요.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold text-white">거래 내역</h2>
          <select
            value={selectedAccount}
            onChange={(e) => {
              const accountId = Number(e.target.value);
              setSelectedAccount(accountId);
              if (onAccountChange) {
                onAccountChange(accountId);
              }
            }}
            className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.broker} ({account.name})
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-5 h-5" />
          거래 기록
        </button>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {showForm && (
        <div className="bg-slate-800 rounded-xl p-6 mb-6 border border-slate-700">
          <h3 className="text-xl font-semibold mb-4">거래 기록</h3>
          <form onSubmit={handleCreateTransaction} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">계좌 *</label>
                <select
                  value={formData.accountId}
                  onChange={(e) => setFormData({ ...formData, accountId: Number(e.target.value) })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value={0}>계좌를 선택하세요</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">자산 *</label>
                <select
                  value={formData.assetId}
                  onChange={(e) => setFormData({ ...formData, assetId: Number(e.target.value) })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value={0}>자산을 선택하세요</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.ticker} - {asset.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">거래 유형 *</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as 'Buy' | 'Sell' })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Buy">매수 (Buy)</option>
                  <option value="Sell">매도 (Sell)</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">거래일 *</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">가격 *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">수량 *</label>
                <input
                  type="number"
                  step="0.0001"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">수수료</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.fee}
                  onChange={(e) => setFormData({ ...formData, fee: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">메모</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="추가 메모"
                rows={2}
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                className="flex-1 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors"
              >
                기록
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg transition-colors"
              >
                취소
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {transactions.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <TrendingUp className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg">거래 내역이 없습니다.</p>
            <p className="text-sm mt-2">위의 "거래 기록" 버튼을 눌러 매수/매도를 기록하세요.</p>
          </div>
        ) : (
          transactions.map((transaction) => (
            <div
              key={transaction.id}
              className="bg-slate-800 rounded-lg p-4 border border-slate-700 hover:border-blue-500 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                    transaction.type === 'Buy' 
                      ? 'bg-gradient-to-br from-blue-500 to-cyan-500' 
                      : 'bg-gradient-to-br from-red-500 to-orange-500'
                  }`}>
                    {transaction.type === 'Buy' ? (
                      <ArrowDownCircle className="w-6 h-6" />
                    ) : (
                      <ArrowUpCircle className="w-6 h-6" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-white">
                        {transaction.asset?.name || 'N/A'}
                      </h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        transaction.type === 'Buy' 
                          ? 'bg-blue-500/20 text-blue-300' 
                          : 'bg-red-500/20 text-red-300'
                      }`}>
                        {transaction.type === 'Buy' ? '매수' : '매도'}
                      </span>
                    </div>
                    <p className="text-sm text-slate-400 mt-1">
                      {transaction.asset?.ticker || 'N/A'} • {new Date(transaction.date).toLocaleDateString('ko-KR')} • 
                      수량: {transaction.quantity} • 
                      가격: ${transaction.price.toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-xl font-bold ${
                    transaction.type === 'Buy' ? 'text-blue-400' : 'text-red-400'
                  }`}>
                    ${(transaction.price * transaction.quantity).toLocaleString()}
                  </p>
                  {transaction.fee > 0 && (
                    <p className="text-xs text-slate-500">
                      수수료: ${transaction.fee.toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
              {transaction.notes && (
                <p className="text-sm text-slate-400 mt-3 pl-16">{transaction.notes}</p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
