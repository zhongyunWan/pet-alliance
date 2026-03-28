import { v4 as uuid } from 'uuid';
import { callClaudeStructured } from '../utils/llm.js';
import type { GeneRecipe, PetExperience } from '../types.js';
import { log } from '../utils/logger.js';

interface PetFeedbackGeneInput {
  condition: string;
  species: string;
  breed?: string;
  consultSummary: string;
  feedback: {
    rating: number; // 1-5
    comment: string;
    recovered: boolean;
  };
}

interface ExtractedPetRules {
  treatments: Array<{
    method: string;
    effectiveness: number;
    notes: string;
  }>;
  dietAdjustments: string[];
  preventionTips: string[];
  summary: string;
}

/**
 * Extract reusable Gene rules from pet care feedback.
 * - Good feedback (>=4): extract success patterns (category: optimize)
 * - Bad feedback (<=2): extract improvement rules (category: repair)
 * - Neutral (3): skip extraction
 */
export async function extractGeneFromFeedback(
  input: PetFeedbackGeneInput,
): Promise<GeneRecipe | null> {
  const { condition, species, breed, consultSummary, feedback } = input;

  if (feedback.rating === 3) {
    log({
      level: 'info',
      source: 'geneExtractor',
      message: 'Neutral rating (3), skipping gene extraction',
      signals: ['feedback', 'skip'],
    });
    return null;
  }

  const isPositive = feedback.rating >= 4;
  const category: GeneRecipe['category'] = isPositive ? 'optimize' : 'repair';

  const systemPrompt = isPositive
    ? `You are a veterinary care analyst. Given a pet treatment case and positive owner feedback, extract reusable treatment insights including effective methods, diet adjustments, and prevention tips. Focus on what worked well and should be shared with other pet owners facing similar conditions.`
    : `You are a veterinary care analyst. Given a pet treatment case and negative owner feedback, extract improvement rules to fix the issues. Focus on concrete, actionable changes for future treatment of similar conditions.`;

  const breedInfo = breed ? `, Breed: ${breed}` : '';
  const userMessage = `Species: ${species}${breedInfo}
Condition: ${condition}
Treatment Summary: ${consultSummary}
Owner Rating: ${feedback.rating}/5
Recovered: ${feedback.recovered ? 'Yes' : 'No'}
Owner Comment: ${feedback.comment}

Extract reusable treatment insights from this case. Include treatment methods with effectiveness scores (0-1), diet adjustments, and prevention tips.

Respond with JSON:
{
  "treatments": [
    { "method": "treatment description", "effectiveness": 0.85, "notes": "relevant notes" }
  ],
  "dietAdjustments": ["diet change 1", "diet change 2"],
  "preventionTips": ["prevention tip 1"],
  "summary": "one-line summary of the case outcome"
}`;

  try {
    const extracted = await callClaudeStructured<ExtractedPetRules>({
      systemPrompt,
      userMessage,
      schema: {
        type: 'object',
        properties: {
          treatments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                method: { type: 'string' },
                effectiveness: { type: 'number' },
                notes: { type: 'string' },
              },
            },
          },
          dietAdjustments: { type: 'array', items: { type: 'string' } },
          preventionTips: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
        },
      },
      schemaName: 'ExtractedPetRules',
      temperature: 0.3,
    });

    if (!extracted.treatments || extracted.treatments.length === 0) {
      log({
        level: 'warn',
        source: 'geneExtractor',
        message: 'LLM returned no treatment rules',
        signals: ['feedback', 'empty'],
      });
      return null;
    }

    const petExp: PetExperience = {
      condition,
      species,
      breed,
      treatments: extracted.treatments,
      dietAdjustments: extracted.dietAdjustments ?? [],
      preventionTips: extracted.preventionTips ?? [],
      confidence: isPositive ? 0.8 : 0.5,
      sampleSize: 1,
    };

    const gene: GeneRecipe = {
      id: `pet_${condition.toLowerCase().replace(/\s+/g, '_')}_${uuid().slice(0, 8)}`,
      category,
      signalsMatch: ['pet_health', 'treatment_success', condition.toLowerCase(), species.toLowerCase()],
      preconditions: extracted.treatments.map((t) => `treatment_method: ${t.method}`),
      strategy: [
        ...extracted.treatments.map((t) => `Treatment: ${t.method} (effectiveness: ${t.effectiveness})`),
        ...extracted.dietAdjustments.map((d) => `Diet: ${d}`),
        ...extracted.preventionTips.map((p) => `Prevention: ${p}`),
      ],
      constraints: {
        source: 'owner_feedback',
        rating: feedback.rating,
        species,
        condition,
      },
      validation: [`feedback_score_${isPositive ? 'gte_4' : 'lte_2'}`],
      version: 1,
      petExperience: petExp,
    };

    log({
      level: 'info',
      source: 'geneExtractor',
      message: `Extracted ${category} gene with ${extracted.treatments.length} treatments for ${species}/${condition}: ${extracted.summary}`,
      signals: ['feedback', 'gene_extracted', category],
    });

    return gene;
  } catch (error) {
    log({
      level: 'error',
      source: 'geneExtractor',
      message: `Gene extraction failed: ${(error as Error).message}`,
      signals: ['feedback', 'error'],
    });
    return null;
  }
}
