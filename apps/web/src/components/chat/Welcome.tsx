import { ArrowUpRight, Code2, FilePenLine, Lightbulb, Sprout } from 'lucide-react';

const suggestions = [
  { icon: Code2, title: '编程与开发', description: '理清思路，让复杂的问题简单一点', prompt: '帮我分析一个编程问题：', tone: 'blue' },
  { icon: FilePenLine, title: '分析与写作', description: '整理信息，找到清晰有力的表达', prompt: '帮我梳理下面的内容，提炼重点：', tone: 'sky' },
  { icon: Lightbulb, title: '学习与探索', description: '从一个好问题，开启新的发现', prompt: '我想学习一个新知识，请循序渐进地为我讲解：', tone: 'indigo' },
  { icon: Sprout, title: '灵感与日常', description: '留一点空间，给生活里的新想法', prompt: '和我一起头脑风暴，探索一些新的想法：', tone: 'cyan' },
];
const interactiveSuggestions = [
  { label: '聚餐分账', prompt: '请用智能 UI 做一个聚餐分账器：账单 240 元、4 个人，可以调整人数和小费比例，实时显示人均金额。' },
  { label: '探索波形', prompt: '请用智能 UI 讲解正弦波，用滑块调整振幅、频率和相位，同时显示曲线，解释各参数的作用。' },
  { label: '比较方案', prompt: '请用智能 UI 比较 SQLite 和 PostgreSQL，展示并排卡片，按个人项目和团队服务切换适用场景，并支持继续提问。' },
];

export function Welcome() {
  return <div className="welcome-heading fade-in">
    <div className="welcome-eyebrow"><span /> A LITTLE SPACE FOR BIG IDEAS</div>
    <h1>你好，<span>今天想聊点什么？</span></h1>
    <p>一个问题、一闪灵感，都可以从这里开始。</p>
  </div>;
}

export function StarterCards({ onPick }: { onPick: (text: string) => void }) {
  return <div className="welcome-bottom fade-in">
    <div className="mb-5 flex flex-wrap items-center justify-center gap-2 text-xs">
      <span className="mr-1 text-zinc-500">试试智能 UI</span>
      {interactiveSuggestions.map(item => <button type="button" key={item.label} onClick={() => onPick(item.prompt)}
        className="rounded-full border border-zinc-200 bg-white/70 px-3 py-2 text-zinc-600 transition-colors hover:border-accent-400 hover:text-accent-600 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300">{item.label}<span className="ml-1.5" aria-hidden>↗</span></button>)}
    </div>
    <div className="starter-grid">
      {suggestions.map(({ icon: Icon, title, description, prompt, tone }) => <button type="button" key={title}
        className="starter-card" onClick={() => onPick(prompt)}>
        <div className="flex items-center justify-between"><span className={`starter-icon ${tone}`}><Icon size={20} /></span><ArrowUpRight size={16} className="starter-arrow" /></div>
        <h2>{title}</h2><p>{description}</p>
      </button>)}
    </div>
    <p className="welcome-footer">保持好奇，慢慢把想法变成可能。</p>
  </div>;
}
