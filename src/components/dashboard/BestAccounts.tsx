import { useState, useMemo } from 'react';
import { TrendingUp, ArrowRightLeft, Zap, Laptop, Code2, Terminal } from 'lucide-react';
import { Account, QuotaGroup, ActiveClientsStatus } from '../../types/account';
import { findQuotaModel } from '../../config/modelConfig';
import { useTranslation } from 'react-i18next';

interface BestAccountsProps {
    accounts: Account[];
    currentAccountId?: string;
    activeClients?: ActiveClientsStatus;
    onSwitch?: (accountId: string, targetIde?: string) => void;
}

type TargetIdeType = 'classic' | 'ide' | 'agy';

/** 从 quota_groups 中提取 5h 或 Weekly 桶百分比 (0-100) */
function getBucketPercentage(
    quotaGroups: QuotaGroup[] | undefined,
    category: 'gemini' | 'claude',
    targetWindow: '5h' | 'weekly'
): number | null {
    if (!quotaGroups || quotaGroups.length === 0) return null;

    for (const group of quotaGroups) {
        const name = (group.display_name || '').toLowerCase();
        if (name.includes('argon')) continue;
        const isTarget = category === 'claude'
            ? (name.includes('claude') || name.includes('gpt'))
            : (name.includes('gemini') || !name.includes('claude'));

        if (isTarget) {
            const bucket = group.buckets?.find(b => {
                const win = (b.window || '').toLowerCase();
                const id = (b.bucket_id || '').toLowerCase();
                if (targetWindow === 'weekly') {
                    return win.includes('week') || id.includes('week');
                } else {
                    return win.includes('5h') || id.includes('5h') || win.includes('hour') || id.includes('hour');
                }
            });

            if (bucket && typeof bucket.remaining_fraction === 'number') {
                return Math.round(bucket.remaining_fraction * 100);
            }
        }
    }
    return null;
}

/** 
 * 计算模型综合有效配额
 * 自动识别：双桶 (取 min 短板) / 免费账号仅周桶 (取周) / 仅 5h 桶 (取 5h)
 */
function calculateEffectiveQuota(
    fiveHourFromModel: number | null,
    weeklyFromGroup: number | null,
    fiveHourFromGroup: number | null
): number {
    const fiveHour = fiveHourFromGroup !== null ? fiveHourFromGroup : fiveHourFromModel;
    const weekly = weeklyFromGroup;

    // 情况 1: 双桶都存在 (Pro/Ultra 账号) -> 木桶短板 min(5h, weekly)
    if (fiveHour !== null && weekly !== null) {
        return Math.min(fiveHour, weekly);
    }

    // 情况 2: 仅有周额度 (免费账号 / Free Tier) -> 直接以周额度为准
    if (weekly !== null) {
        return weekly;
    }

    // 情况 3: 仅有 5h 额度 (单桶回退) -> 以 5h 额度为准
    if (fiveHour !== null) {
        return fiveHour;
    }

    return 0;
}

function BestAccounts({ accounts, currentAccountId, activeClients, onSwitch }: BestAccountsProps) {
    const { t } = useTranslation();
    const [targetIde, setTargetIde] = useState<TargetIdeType>('classic');

    const clientTargets = [
        {
            key: 'classic' as TargetIdeType,
            label: t('accounts.client_classic', '经典款'),
            icon: Laptop,
            activeBg: 'bg-blue-600 text-white shadow-xs',
        },
        {
            key: 'ide' as TargetIdeType,
            label: t('accounts.client_ide', 'IDE'),
            icon: Code2,
            activeBg: 'bg-sky-600 text-white shadow-xs',
        },
        {
            key: 'agy' as TargetIdeType,
            label: t('accounts.client_cli', 'CLI'),
            icon: Terminal,
            activeBg: 'bg-emerald-600 text-white shadow-xs',
        },
    ];

    // 获取当前所选目标客户端当前已生效的账号 ID，推荐时智能排除
    const currentTargetAccountId = useMemo(() => {
        switch (targetIde) {
            case 'classic':
                return activeClients?.classic_account_id || currentAccountId;
            case 'ide':
                return activeClients?.ide_account_id;
            case 'agy':
                return activeClients?.agy_account_id;
        }
    }, [targetIde, activeClients, currentAccountId]);

    // 1. 获取按综合有效配额排序的列表 (排除当前客户端正在使用的账号及已禁用账号)
    const geminiSorted = useMemo(() => {
        return accounts
            .filter(a => a.id !== currentTargetAccountId && !a.disabled && !a.proxy_disabled)
            .map(a => {
                const pro5hModel = findQuotaModel(a.quota?.models, 'gemini-pro')?.percentage ?? null;
                const flash5hModel = findQuotaModel(a.quota?.models, 'gemini-flash')?.percentage ?? null;
                const weeklyGroup = getBucketPercentage(a.quota?.quota_groups, 'gemini', 'weekly');
                const fiveHourGroup = getBucketPercentage(a.quota?.quota_groups, 'gemini', '5h');

                const effectivePro = calculateEffectiveQuota(pro5hModel, weeklyGroup, fiveHourGroup);
                const effectiveFlash = calculateEffectiveQuota(flash5hModel, weeklyGroup, fiveHourGroup);

                let score = Math.round(effectivePro * 0.7 + effectiveFlash * 0.3);
                if (weeklyGroup !== null && weeklyGroup <= 5) {
                    score = 0;
                }

                return {
                    ...a,
                    quotaVal: score,
                };
            })
            .filter(a => a.quotaVal > 0)
            .sort((a, b) => b.quotaVal - a.quotaVal);
    }, [accounts, currentTargetAccountId]);

    const claudeSorted = useMemo(() => {
        return accounts
            .filter(a => a.id !== currentTargetAccountId && !a.disabled && !a.proxy_disabled)
            .map(a => {
                const claude5hModel = findQuotaModel(a.quota?.models, 'claude')?.percentage ?? null;
                const weeklyGroup = getBucketPercentage(a.quota?.quota_groups, 'claude', 'weekly');
                const fiveHourGroup = getBucketPercentage(a.quota?.quota_groups, 'claude', '5h');

                let score = calculateEffectiveQuota(claude5hModel, weeklyGroup, fiveHourGroup);
                if (weeklyGroup !== null && weeklyGroup <= 5) {
                    score = 0;
                }

                return {
                    ...a,
                    quotaVal: score,
                };
            })
            .filter(a => a.quotaVal > 0)
            .sort((a, b) => b.quotaVal - a.quotaVal);
    }, [accounts, currentTargetAccountId]);

    let bestGemini = geminiSorted[0];
    let bestClaude = claudeSorted[0];

    // 2. 如果推荐是同一个账号，且有其他选择，寻找最优的"不同账号"组合
    if (bestGemini && bestClaude && bestGemini.id === bestClaude.id) {
        const nextGemini = geminiSorted[1];
        const nextClaude = claudeSorted[1];

        const scoreA = bestGemini.quotaVal + (nextClaude?.quotaVal || 0);
        const scoreB = (nextGemini?.quotaVal || 0) + bestClaude.quotaVal;

        if (nextClaude && (!nextGemini || scoreA >= scoreB)) {
            bestClaude = nextClaude;
        } else if (nextGemini) {
            bestGemini = nextGemini;
        }
    }

    const bestGeminiRender = bestGemini ? { ...bestGemini, geminiQuota: bestGemini.quotaVal } : undefined;
    const bestClaudeRender = bestClaude ? { ...bestClaude, claudeQuota: bestClaude.quotaVal } : undefined;

    const currentTargetName = clientTargets.find(t => t.key === targetIde)?.label || t('accounts.client_classic', '经典款');

    return (
        <div className="bg-white dark:bg-[#15161b] rounded-2xl p-5 shadow-sm dark:shadow-xl dark:shadow-black/40 border border-gray-100 dark:border-white/[0.10] h-full flex flex-col hover:shadow-md transition-shadow">
            {/* 标题栏与目标应用选择器 */}
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <h2 className="text-base font-semibold text-gray-900 dark:text-base-content flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                    {t('dashboard.best_accounts', '最佳账号推荐')}
                </h2>

                {/* 目标客户端药丸选择器 */}
                <div className="flex items-center bg-gray-100 dark:bg-base-200/90 p-1 rounded-xl border border-gray-200/70 dark:border-white/10 gap-1">
                    {clientTargets.map(target => {
                        const Icon = target.icon;
                        const isSelected = targetIde === target.key;
                        return (
                            <button
                                key={target.key}
                                onClick={() => setTargetIde(target.key)}
                                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                    isSelected
                                        ? target.activeBg
                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200/60 dark:hover:bg-white/5'
                                }`}
                            >
                                <Icon className="w-3.5 h-3.5" />
                                <span>{target.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="space-y-2 flex-1">
                {/* Gemini 最佳 */}
                {bestGeminiRender && (
                    <div className="flex items-center justify-between p-2.5 bg-green-50 dark:bg-emerald-500/[0.08] rounded-xl border border-green-100 dark:border-emerald-500/30">
                        <div className="flex-1 min-w-0">
                            <div className="text-[10px] text-green-600 dark:text-emerald-400 font-semibold mb-0.5">{t('dashboard.for_gemini')}</div>
                            <div className="font-medium text-sm text-gray-900 dark:text-zinc-100 truncate" title={bestGeminiRender.email}>
                                {bestGeminiRender.email}
                            </div>
                        </div>
                        <div className="ml-2 flex items-center gap-2">
                            <div className="px-2.5 py-0.5 bg-green-500 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border dark:border-emerald-500/40 text-white text-xs font-bold font-mono rounded-full shadow-xs">
                                {bestGeminiRender.geminiQuota}%
                            </div>
                            {onSwitch && (
                                <button
                                    onClick={() => onSwitch(bestGeminiRender.id, targetIde)}
                                    className="p-1 rounded-lg text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-white/80 dark:hover:bg-white/10 transition-colors cursor-pointer"
                                    title={`一键将此账号切换到 ${currentTargetName}`}
                                >
                                    <ArrowRightLeft className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Claude 最佳 */}
                {bestClaudeRender && (
                    <div className="flex items-center justify-between p-2.5 bg-cyan-50 dark:bg-cyan-500/[0.08] rounded-xl border border-cyan-100 dark:border-cyan-500/30">
                        <div className="flex-1 min-w-0">
                            <div className="text-[10px] text-cyan-600 dark:text-cyan-400 font-semibold mb-0.5">{t('dashboard.for_claude')}</div>
                            <div className="font-medium text-sm text-gray-900 dark:text-zinc-100 truncate" title={bestClaudeRender.email}>
                                {bestClaudeRender.email}
                            </div>
                        </div>
                        <div className="ml-2 flex items-center gap-2">
                            <div className="px-2.5 py-0.5 bg-cyan-500 dark:bg-cyan-500/20 dark:text-cyan-300 dark:border dark:border-cyan-500/40 text-white text-xs font-bold font-mono rounded-full shadow-xs">
                                {bestClaudeRender.claudeQuota}%
                            </div>
                            {onSwitch && (
                                <button
                                    onClick={() => onSwitch(bestClaudeRender.id, targetIde)}
                                    className="p-1 rounded-lg text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-white/80 dark:hover:bg-white/10 transition-colors cursor-pointer"
                                    title={`一键将此账号切换到 ${currentTargetName}`}
                                >
                                    <ArrowRightLeft className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {(!bestGeminiRender && !bestClaudeRender) && (
                    <div className="text-center py-4 text-gray-400 text-sm">
                        {t('accounts.no_data')}
                    </div>
                )}
            </div>

            {(bestGeminiRender || bestClaudeRender) && onSwitch && (
                <div className="mt-auto pt-3">
                    <button
                        className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white text-xs font-semibold rounded-xl transition-all cursor-pointer shadow-md shadow-blue-900/30 dark:shadow-blue-950/50 flex items-center justify-center gap-1.5"
                        onClick={() => {
                            let targetId = bestGeminiRender?.id;
                            if (bestClaudeRender && (!bestGeminiRender || bestClaudeRender.claudeQuota > bestGeminiRender.geminiQuota)) {
                                targetId = bestClaudeRender.id;
                            }

                            if (onSwitch && targetId) {
                                onSwitch(targetId, targetIde);
                            }
                        }}
                    >
                        <Zap className="w-3.5 h-3.5" />
                        <span>一键切换最佳账号到 {currentTargetName}</span>
                    </button>
                </div>
            )}
        </div>
    );
}

export default BestAccounts;

