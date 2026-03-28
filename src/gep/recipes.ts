import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { log, logEvolutionEvent } from '../utils/logger.js';
import type { GeneRecipe } from '../types.js';
export class RecipeManager {
  private recipes: GeneRecipe[] = [];
  private filePath: string = '';

  async loadFromFile(path: string): Promise<void> {
    this.filePath = path;
    try {
      const raw = readFileSync(path, 'utf-8');
      const data = JSON.parse(raw) as unknown[];

      this.recipes = data.map((item) => this.normalizeRecipe(item as Record<string, unknown>));

      log({
        level: 'info',
        source: 'recipe_manager',
        message: `Loaded ${this.recipes.length} Gene Recipes from ${path}`,
        signals: ['gene_loaded'],
      });
    } catch (err) {
      this.recipes = [];
      log({
        level: 'warn',
        source: 'recipe_manager',
        message: `Failed to load recipes from ${path}: ${err instanceof Error ? err.message : String(err)}`,
        signals: ['gene_load_error', 'error'],
      });
    }
  }

  getAllRecipes(): GeneRecipe[] {
    return [...this.recipes];
  }

  findBySignals(signals: string[]): GeneRecipe[] {
    return this.recipes.filter((recipe) =>
      recipe.signalsMatch.some((s) => signals.includes(s))
    );
  }
  async addRecipe(recipe: GeneRecipe): Promise<void> {
    const existing = this.recipes.findIndex((r) => r.id === recipe.id);
    if (existing !== -1) {
      this.recipes[existing] = recipe;
    } else {
      this.recipes.push(recipe);
    }

    await this.persist();

    logEvolutionEvent({
      type: 'gene_created',
      geneId: recipe.id,
      description: `Gene ${recipe.id} v${recipe.version} added to recipe store`,
      signals: ['gene_created', recipe.category],
    });
  }

  private async persist(): Promise<void> {
    if (!this.filePath) return;

    try {
      mkdirSync(dirname(this.filePath), { recursive: true });

      // Convert to evolver-compatible format with snake_case
      const output = this.recipes.map((r) => ({
        id: r.id,
        category: r.category,
        signals_match: r.signalsMatch,
        preconditions: r.preconditions,
        strategy: r.strategy,
        constraints: r.constraints,
        validation: r.validation,
        version: r.version,
        ...(r.petExperience ? { pet_experience: r.petExperience } : {}),
      }));

      writeFileSync(this.filePath, JSON.stringify(output, null, 2) + '\n');
    } catch (err) {
      log({
        level: 'error',
        source: 'recipe_manager',
        message: `Failed to persist recipes: ${err instanceof Error ? err.message : String(err)}`,
        signals: ['gene_persist_error', 'error'],
      });
    }
  }

  private normalizeRecipe(raw: Record<string, unknown>): GeneRecipe {
    return {
      id: raw.id as string,
      category: raw.category as GeneRecipe['category'],
      signalsMatch: (raw.signals_match ?? raw.signalsMatch ?? []) as string[],
      preconditions: (raw.preconditions ?? []) as string[],
      strategy: (raw.strategy ?? []) as string[],
      constraints: (raw.constraints ?? {}) as Record<string, unknown>,
      validation: (raw.validation ?? []) as string[],
      version: (raw.version as number) ?? 1,
      petExperience: (raw.pet_experience ?? raw.petExperience) as GeneRecipe['petExperience'],
    };
  }
}
