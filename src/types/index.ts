export interface Agent {
  id: string;
  name: string;
  shortName: string;
  icon: string;
  role: string;
  color: string;
  badgeColor: string;
  desc: string;
}

export interface Step {
  agent: string;
  action: string;
  icon: string;
  status: 'pending' | 'running' | 'done';
}

export interface RichData {
  type: 'products' | 'priceCompare' | 'recipe' | 'logistics';
  items?: any[];
  date?: string;
  title?: string;
  prepTime?: string;
  difficulty?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agentId?: string;
  steps?: Step[];
  richData?: RichData | null;
  expandedSteps?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  date: string;
}
