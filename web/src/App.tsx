import React, { useState, useEffect, useRef } from 'react';

interface Pet {
  id: string;
  name: string;
  species: string;
  breed: string;
  age: number;
  weight: number;
}

interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: string;
  payload: unknown;
  round: number;
  timestamp: number;
}

interface Gene {
  id: string;
  category: string;
  signals_match: string[];
  strategy: string[];
  version: number;
  pet_experience?: {
    condition: string;
    species: string;
    treatments: Array<{ method: string; effectiveness: number }>;
    confidence: number;
    sampleSize: number;
  };
}

const AGENT_ICONS: Record<string, string> = {
  'health-agent': '🏥',
  'diet-agent': '🍖',
  'medical-agent': '👨‍⚕️',
  'boarding-agent': '🏨',
  'orchestrator': '🎯',
};

const AGENT_COLORS: Record<string, string> = {
  'health-agent': 'bg-green-100 border-green-300 text-green-800',
  'diet-agent': 'bg-orange-100 border-orange-300 text-orange-800',
  'medical-agent': 'bg-blue-100 border-blue-300 text-blue-800',
  'boarding-agent': 'bg-purple-100 border-purple-300 text-purple-800',
  'orchestrator': 'bg-gray-100 border-gray-300 text-gray-800',
};

type Tab = 'consult' | 'genes' | 'demo';

export default function App() {
  const [tab, setTab] = useState<Tab>('consult');
  const [pets, setPets] = useState<Pet[]>([]);
  const [selectedPet, setSelectedPet] = useState<string>('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [genes, setGenes] = useState<Gene[]>([]);
  const [connected, setConnected] = useState(false);
  const msgEndRef = useRef<HTMLDivElement>(null);

  // Check health + load genes
  useEffect(() => {
    fetch('/api/health').then(r => { setConnected(r.ok); }).catch(() => setConnected(false));
    fetch('/api/genes').then(r => r.json()).then(d => setGenes(d.genes || [])).catch(() => {});
    fetch('/api/pets').then(r => r.json()).then(d => {
      setPets(d.pets || []);
      if (d.pets?.length > 0) setSelectedPet(d.pets[0].id);
    }).catch(() => {});
  }, []);

  // SSE for real-time agent messages
  useEffect(() => {
    const es = new EventSource('/api/messages/stream');
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data) as AgentMessage;
      setMessages(prev => [...prev, msg]);
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const createDemoPet = async (petData: Record<string, unknown>) => {
    const res = await fetch('/api/pets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(petData),
    });
    const data = await res.json();
    if (data.pet) {
      setPets(prev => [...prev, data.pet]);
      setSelectedPet(data.pet.id);
    }
  };

  const handleConsult = async () => {
    if (!selectedPet || !input.trim()) return;
    setLoading(true);
    setMessages([]);
    setResult(null);

    try {
      const res = await fetch('/api/consult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ petId: selectedPet, text: input, type: 'general' }),
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({ status: 'error', message: (err as Error).message });
    }
    setLoading(false);
  };

  const handleFeedback = async (score: number) => {
    if (!result?.result?.id) return;
    const pet = pets.find(p => p.id === selectedPet);
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        consultId: result.result.id,
        petId: selectedPet,
        overallScore: score,
        comments: score >= 4 ? '治疗方案有效，宠物已恢复' : '效果不理想',
        outcome: score >= 4 ? 'resolved' : 'not_resolved',
        condition: input,
        consultSummary: result.result.recommendations?.map((r: any) => r.title).join('; ') || input,
      }),
    });
    // Reload genes
    const gRes = await fetch('/api/genes');
    const gData = await gRes.json();
    setGenes(gData.genes || []);
    alert(score >= 4 ? '感谢反馈！经验已封装为Gene并发布到EvoMap网络 🧬' : '感谢反馈，我们会改进！');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50">
      {/* Header */}
      <nav className="bg-white/80 backdrop-blur-sm border-b border-amber-200 px-6 py-3 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🐾</span>
          <span className="text-xl font-bold text-amber-700">养宠联盟</span>
          <span className="text-xs text-gray-500 hidden sm:inline">PetAlliance — Multi-Agent Pet Care Network</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-1">
            {(['consult', 'genes', 'demo'] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-1.5 rounded-full text-sm transition-all ${
                  tab === t ? 'bg-amber-500 text-white' : 'text-gray-600 hover:bg-amber-100'
                }`}>
                {t === 'consult' ? '🩺 咨询' : t === 'genes' ? '🧬 Gene' : '🎮 演示'}
              </button>
            ))}
          </div>
          <span className={`flex items-center gap-1 text-xs ${connected ? 'text-green-600' : 'text-red-500'}`}>
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
            {connected ? 'Online' : 'Offline'}
          </span>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto p-4">
        {tab === 'consult' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Left: Input */}
            <div className="lg:col-span-1 space-y-4">
              {/* Pet Selection */}
              <div className="bg-white rounded-xl p-4 shadow-sm border border-amber-100">
                <h3 className="font-semibold text-amber-700 mb-3">🐱 宠物档案</h3>
                {pets.length === 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm text-gray-500">暂无宠物，点击创建演示宠物</p>
                    <button onClick={() => createDemoPet({ name: '小橘', species: 'cat', breed: '英短蓝猫', age: 3, weight: 5.5, gender: 'neutered_male', indoor: true, vaccinations: [{ name: '猫三联', date: '2025-06-15', nextDue: '2026-06-15' }, { name: '狂犬疫苗', date: '2025-06-15', nextDue: '2026-06-15' }], medicalHistory: [], allergies: [], currentMedications: [], ownerId: 'demo-owner' })} className="w-full px-3 py-2 bg-amber-500 text-white rounded-lg text-sm hover:bg-amber-600">
                      + 创建小橘（英短蓝猫）
                    </button>
                    <button onClick={() => createDemoPet({ name: '团子', species: 'cat', breed: '橘猫', age: 2, weight: 4.2, gender: 'spayed_female', indoor: true, vaccinations: [{ name: '猫三联', date: '2025-09-01', nextDue: '2026-09-01' }], medicalHistory: [], allergies: [], currentMedications: [], ownerId: 'demo-owner-2' })} className="w-full px-3 py-2 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600">
                      + 创建团子（橘猫）
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pets.map(pet => (
                      <button key={pet.id} onClick={() => setSelectedPet(pet.id)}
                        className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-all ${
                          selectedPet === pet.id
                            ? 'border-amber-400 bg-amber-50 text-amber-700'
                            : 'border-gray-200 hover:border-amber-200'
                        }`}>
                        <span className="font-medium">{pet.name}</span>
                        <span className="text-xs text-gray-500 ml-2">{pet.breed} · {pet.age}岁 · {pet.weight}kg</span>
                      </button>
                    ))}
                    <div className="flex gap-2">
                      <button onClick={() => createDemoPet({ name: '小橘', species: 'cat', breed: '英短蓝猫', age: 3, weight: 5.5, gender: 'neutered_male', indoor: true, vaccinations: [{ name: '猫三联', date: '2025-06-15', nextDue: '2026-06-15' }, { name: '狂犬疫苗', date: '2025-06-15', nextDue: '2026-06-15' }], medicalHistory: [], allergies: [], currentMedications: [], ownerId: 'demo-owner' })} className="flex-1 px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs hover:bg-amber-200">+ 小橘</button>
                      <button onClick={() => createDemoPet({ name: '团子', species: 'cat', breed: '橘猫', age: 2, weight: 4.2, gender: 'spayed_female', indoor: true, vaccinations: [{ name: '猫三联', date: '2025-09-01', nextDue: '2026-09-01' }], medicalHistory: [], allergies: [], currentMedications: [], ownerId: 'demo-owner-2' })} className="flex-1 px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs hover:bg-orange-200">+ 团子</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="bg-white rounded-xl p-4 shadow-sm border border-amber-100">
                <h3 className="font-semibold text-amber-700 mb-3">💬 咨询问题</h3>
                <textarea value={input} onChange={e => setInput(e.target.value)}
                  placeholder="例如：我家猫最近掉毛严重，皮肤有圆形红斑..."
                  className="w-full h-24 px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:border-amber-400"
                />
                <button onClick={handleConsult} disabled={loading || !selectedPet || !input.trim()}
                  className="w-full mt-2 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium">
                  {loading ? '🔄 4个Agent协作分析中...' : '🚀 开始咨询（4Agent协作）'}
                </button>
              </div>

              {/* Quick Scenarios */}
              <div className="bg-white rounded-xl p-4 shadow-sm border border-amber-100">
                <h3 className="font-semibold text-amber-700 mb-2">⚡ 快捷场景</h3>
                {[
                  '我家猫最近掉毛严重，皮肤有圆形红斑，有点痒',
                  '我下周出差5天，猫正在吃药治猫藓，谁来帮忙照顾？',
                  '我家3岁英短需要做什么疫苗和驱虫？',
                  '猫咪最近食欲下降，偶尔呕吐，精神还好',
                ].map((s, i) => (
                  <button key={i} onClick={() => setInput(s)}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-600 hover:bg-amber-50 rounded mb-1 truncate">
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Middle: Agent Messages */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-xl p-4 shadow-sm border border-amber-100 h-[calc(100vh-140px)] overflow-y-auto">
                <h3 className="font-semibold text-amber-700 mb-3">🔗 Agent 协作过程</h3>
                {messages.length === 0 && !loading && (
                  <p className="text-sm text-gray-400 text-center mt-10">发起咨询后，这里会实时展示Agent之间的消息流</p>
                )}
                <div className="space-y-2">
                  {messages.map((msg, i) => {
                    const payload = msg.payload as Record<string, unknown>;
                    return (
                      <div key={i} className={`agent-msg p-2 rounded-lg border text-xs ${AGENT_COLORS[msg.from] || 'bg-gray-50 border-gray-200'}`}>
                        <div className="flex items-center gap-1 font-medium">
                          <span>{AGENT_ICONS[msg.from] || '💬'}</span>
                          <span>{msg.from}</span>
                          <span className="text-gray-400">→</span>
                          <span>{msg.to}</span>
                          <span className="ml-auto text-gray-400">[R{msg.round}]</span>
                        </div>
                        <div className="mt-1 text-gray-700">
                          <span className="bg-white/50 px-1 rounded text-xs">{msg.type}</span>
                          {payload?.message && <span className="ml-1">{String(payload.message)}</span>}
                          {payload?.phase && <span className="ml-1 text-gray-500">[{String(payload.phase)}]</span>}
                          {payload?.itemCount !== undefined && <span className="ml-1">({String(payload.itemCount)}条建议)</span>}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={msgEndRef} />
                </div>
              </div>
            </div>

            {/* Right: Results */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-xl p-4 shadow-sm border border-amber-100 h-[calc(100vh-140px)] overflow-y-auto">
                <h3 className="font-semibold text-amber-700 mb-3">📋 综合建议</h3>
                {!result && <p className="text-sm text-gray-400 text-center mt-10">等待咨询结果...</p>}

                {result?.status === 'error' && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{result.message}</div>
                )}

                {result?.result && (
                  <div className="space-y-3">
                    {/* Stats */}
                    <div className="flex gap-2 text-xs">
                      <span className="bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
                        {result.result.recommendations?.length || 0} 条建议
                      </span>
                      <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                        {result.result.negotiationRounds || 0} 轮协商
                      </span>
                      <span className="bg-green-100 text-green-700 px-2 py-1 rounded-full">
                        {result.result.processingTimeMs}ms
                      </span>
                      {result.result.genesApplied?.length > 0 && (
                        <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded-full">
                          🧬 Gene已继承
                        </span>
                      )}
                    </div>

                    {/* Conflicts */}
                    {result.conflicts?.length > 0 && (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2">
                        <p className="text-xs font-medium text-yellow-700 mb-1">⚡ 冲突协商</p>
                        {result.conflicts.map((c: any, i: number) => (
                          <div key={i} className="text-xs text-yellow-600">
                            {c.description} → <span className="text-green-600">{c.resolution}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Recommendations */}
                    {result.result.recommendations?.map((rec: any, i: number) => (
                      <div key={i} className={`p-3 rounded-lg border ${
                        rec.priority === 'urgent' ? 'border-red-300 bg-red-50' :
                        rec.priority === 'high' ? 'border-orange-300 bg-orange-50' :
                        'border-gray-200 bg-gray-50'
                      }`}>
                        <div className="flex items-center gap-2">
                          <span>{AGENT_ICONS[rec.metadata?.source] || '📌'}</span>
                          <span className="font-medium text-sm">{rec.title}</span>
                          <span className={`ml-auto text-xs px-1.5 py-0.5 rounded ${
                            rec.priority === 'urgent' ? 'bg-red-200 text-red-700' :
                            rec.priority === 'high' ? 'bg-orange-200 text-orange-700' :
                            'bg-gray-200 text-gray-600'
                          }`}>{rec.priority}</span>
                        </div>
                        <p className="text-xs text-gray-600 mt-1 whitespace-pre-line">{rec.description}</p>
                      </div>
                    ))}

                    {/* Feedback */}
                    <div className="border-t pt-3">
                      <p className="text-xs text-gray-500 mb-2">反馈效果（触发Gene进化）</p>
                      <div className="flex gap-2">
                        {[1, 2, 3, 4, 5].map(score => (
                          <button key={score} onClick={() => handleFeedback(score)}
                            className="flex-1 py-2 rounded-lg border text-sm hover:bg-amber-50 transition-all">
                            {'⭐'.repeat(score)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Agent proposals breakdown */}
                {result?.agentProposals && (
                  <div className="mt-4 border-t pt-3">
                    <h4 className="text-xs font-medium text-gray-500 mb-2">各Agent提案概览</h4>
                    {result.agentProposals.map((ap: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-xs py-1">
                        <span>{AGENT_ICONS[ap.agentId] || '🤖'}</span>
                        <span className="font-medium">{ap.domain}</span>
                        <span className="text-gray-400">{ap.items?.length || 0}条</span>
                        <span className="text-gray-400">{ap.durationMs}ms</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                          <div className="bg-amber-400 h-1.5 rounded-full" style={{ width: `${(ap.confidence || 0) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'genes' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl p-6 shadow-sm border border-amber-100">
              <h2 className="text-lg font-bold text-amber-700 mb-4">🧬 Gene Recipes — 养宠经验基因库</h2>
              <p className="text-sm text-gray-500 mb-4">
                每个Gene代表一段被验证的养宠经验，通过GEP协议在EvoMap网络中共享。当新用户的宠物遇到类似问题时，Agent可以继承这些经验。
              </p>

              {genes.length === 0 ? (
                <p className="text-gray-400 text-center py-10">暂无Gene。提交正面反馈后会自动提取经验Gene。</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {genes.map((gene, i) => (
                    <div key={i} className="gene-card p-4 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          gene.category === 'optimize' ? 'bg-green-100 text-green-700' :
                          gene.category === 'innovate' ? 'bg-blue-100 text-blue-700' :
                          'bg-red-100 text-red-700'
                        }`}>{gene.category}</span>
                        <span className="text-xs text-gray-400">v{gene.version}</span>
                      </div>
                      <h3 className="font-medium text-sm mb-2">{gene.id}</h3>
                      <div className="space-y-1">
                        {gene.strategy?.slice(0, 3).map((s, j) => (
                          <p key={j} className="text-xs text-gray-600">• {s}</p>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {gene.signals_match?.map((sig, j) => (
                          <span key={j} className="px-1.5 py-0.5 bg-amber-100 text-amber-600 rounded text-xs">{sig}</span>
                        ))}
                      </div>
                      {gene.pet_experience && (
                        <div className="mt-2 p-2 bg-white/60 rounded-lg text-xs">
                          <p className="font-medium text-amber-700">{gene.pet_experience.condition} ({gene.pet_experience.species})</p>
                          <p className="text-gray-500">置信度: {gene.pet_experience.confidence} | 样本: {gene.pet_experience.sampleSize}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'demo' && (
          <div className="bg-white rounded-xl p-6 shadow-sm border border-amber-100">
            <h2 className="text-lg font-bold text-amber-700 mb-4">🎮 演示场景</h2>

            <div className="space-y-6">
              <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-200">
                <h3 className="font-bold text-amber-800">场景1: 新宠建档 + 健康管理</h3>
                <p className="text-sm text-gray-600 mt-1">创建宠物 → 输入"我家3岁英短需要做什么疫苗和驱虫？" → 4个Agent并行分析</p>
                <p className="text-xs text-gray-500 mt-1">演示重点：多Agent并行协作、约束传递</p>
              </div>

              <div className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl border border-green-200">
                <h3 className="font-bold text-green-800">场景2: Gene经验共享（核心Wow Moment）</h3>
                <ol className="text-sm text-gray-600 mt-2 space-y-1 list-decimal list-inside">
                  <li>用小橘咨询"猫最近掉毛严重，皮肤有圆形红斑" → 问诊Agent诊断</li>
                  <li>给出5星反馈 → 治疗经验封装为Gene → 发布到EvoMap</li>
                  <li>切换到团子 → 咨询类似症状 → Agent继承小橘的治疗Gene → 对比回答质量</li>
                </ol>
                <p className="text-xs text-gray-500 mt-1">演示重点：Gene封装 → A2A发布 → 经验继承 → 回答质量提升</p>
              </div>

              <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl border border-blue-200">
                <h3 className="font-bold text-blue-800">场景3: 多Agent协作处理复杂场景</h3>
                <p className="text-sm text-gray-600 mt-1">输入"我下周出差5天，猫正在吃药治猫藓，谁来帮忙照顾？"</p>
                <p className="text-xs text-gray-500 mt-1">演示重点：健康Agent提供用药表 → 饮食Agent生成特殊食谱 → 寄养Agent匹配方案 → 展示约束传递</p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
