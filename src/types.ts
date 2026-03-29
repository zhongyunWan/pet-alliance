export interface PetProfile {
  id: string;
  name: string;
  species: 'cat' | 'dog' | 'rabbit' | 'bird' | 'other';
  breed: string;
  age: number; // in years
  weight: number; // in kg
  gender: 'male' | 'female' | 'neutered_male' | 'spayed_female';
  indoor: boolean;
  vaccinations: Vaccination[];
  medicalHistory: MedicalRecord[];
  allergies: string[];
  currentMedications: Medication[];
  createdAt: number;
  ownerId: string;
}

export interface Vaccination {
  name: string;
  date: string;
  nextDue: string;
  provider?: string;
}

export interface MedicalRecord {
  id: string;
  date: string;
  condition: string;
  symptoms: string[];
  diagnosis: string;
  treatment: string;
  outcome: 'resolved' | 'ongoing' | 'chronic';
  notes?: string;
}

export interface Medication {
  name: string;
  dosage: string;
  frequency: string;
  startDate: string;
  endDate?: string;
  purpose: string;
}

export interface ConsultRequest {
  id: string;
  petId: string;
  text: string; // Natural language input
  type: 'health_check' | 'symptom' | 'diet' | 'boarding' | 'general';
  parsedContext?: ParsedPetContext;
  timestamp: number;
  skipGenes?: boolean; // For A/B testing
}

export interface ParsedPetContext {
  symptoms?: string[];
  urgency: 'low' | 'medium' | 'high' | 'emergency';
  concerns: string[];
  dietaryNeeds?: string[];
  boardingDates?: { start: string; end: string };
  specialRequirements?: string[];
  relevantDomains?: string[]; // Which agent domains are relevant: health, diet, medical, boarding
}

export interface AgentCapability {
  domain: string;
  actions: string[];
}

export type MessageType = 'constraint' | 'proposal' | 'counter_proposal' | 'accept' | 'reject' | 'info';

export interface AgentMessage {
  id: string;
  from: string;
  to: string | 'broadcast';
  type: MessageType;
  payload: unknown;
  round: number;
  timestamp: number;
}

export interface Proposal {
  agentId: string;
  domain: string;
  items: ProposalItem[];
  constraints: Constraint[];
  confidence: number;
}

export interface ProposalItem {
  id: string;
  type: 'health_advice' | 'diet_plan' | 'boarding_plan' | 'medical_advice' | 'reminder';
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  metadata: Record<string, unknown>;
}

export interface Constraint {
  id: string;
  type: ConstraintType;
  source: string;
  description: string;
  priority: 'hard' | 'soft';
  value: unknown;
}

export type ConstraintType = 'health' | 'diet' | 'medication' | 'allergy' | 'budget' | 'schedule';

export interface Conflict {
  id: string;
  type: string;
  description: string;
  agentA: string;
  agentB: string;
  itemA: ProposalItem;
  itemB: ProposalItem;
  severity: 'low' | 'medium' | 'high';
}

export interface CounterProposal {
  agentId: string;
  conflictId: string;
  adjustedItems: ProposalItem[];
  concessions: string[];
  explanation: string;
}

export interface ConsultResult {
  id: string;
  petId: string;
  request: ConsultRequest;
  recommendations: ProposalItem[];
  agentMessages: AgentMessage[];
  negotiationRounds: number;
  genesApplied: string[];
  metadata: {
    createdAt: number;
    processingTimeMs: number;
  };
}

export interface UserFeedback {
  consultId: string;
  petId: string;
  overallScore: number; // 1-5
  categoryScores: Record<string, number>;
  comments: string;
  outcome?: 'resolved' | 'partially_resolved' | 'not_resolved';
  timestamp: number;
}

export interface GeneRecipe {
  id: string;
  category: 'optimize' | 'innovate' | 'repair';
  signalsMatch: string[];
  preconditions: string[];
  strategy: string[];
  constraints: Record<string, unknown>;
  validation: string[];
  version: number;
  petExperience?: PetExperience;
}

export interface PetExperience {
  condition: string;
  species: string;
  breed?: string;
  treatments: Array<{ method: string; effectiveness: number; notes: string }>;
  dietAdjustments: string[];
  preventionTips: string[];
  confidence: number;
  sampleSize: number;
}

