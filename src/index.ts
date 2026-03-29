import express from 'express';
import cors from 'cors';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import dotenv from 'dotenv';
import { v4 as uuid } from 'uuid';
import type { ConsultRequest, PetProfile, UserFeedback } from './types.js';
import { PetOrchestrator } from './orchestrator/petOrchestrator.js';
import { HealthAgent } from './agents/health.js';
import { DietAgent } from './agents/diet.js';
import { MedicalAgent } from './agents/medical.js';
import { BoardingAgent } from './agents/boarding.js';
import { GepClient } from './gep/client.js';
import { extractGeneFromFeedback } from './evolution/geneExtractor.js';
import { PetProfileStore } from './memory/petProfile.js';
import { log } from './utils/logger.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Initialize 4 domain agents
const agents = [
  new HealthAgent(),
  new DietAgent(),
  new MedicalAgent(),
  new BoardingAgent(),
];

const orchestrator = new PetOrchestrator(agents);

// GEP Client for EvoMap integration (HTTP mode for real EvoMap connection)
const gepClient = new GepClient({
  hubUrl: process.env.GEP_HUB_URL || 'https://evomap.ai',
  nodeId: process.env.EVOMAP_NODE_SECRET ? (process.env.GEP_NODE_ID || '') : '',
  transportMode: 'http',
});

orchestrator.setGepClient(gepClient as any);

// Pet profile store
const petStore = new PetProfileStore();

// SSE clients for real-time agent events
const sseClients: Set<express.Response> = new Set();

orchestrator.getBus().on('message', (msg) => {
  const data = JSON.stringify(msg);
  for (const client of sseClients) {
    client.write(`data: ${data}\n\n`);
  }
});

// Async initialization
(async () => {
  try {
    await gepClient.init();
    log({ level: 'info', source: 'API', message: 'GEP Client initialized', signals: ['init'] });
  } catch (err) {
    log({ level: 'warn', source: 'API', message: `GEP Client init failed (non-fatal): ${(err as Error).message}`, signals: ['init', 'error'] });
  }

  try {
    await petStore.init(join(process.cwd(), 'memory', 'petalliance.db'));
    log({ level: 'info', source: 'API', message: 'PetProfileStore initialized', signals: ['init'] });
  } catch (err) {
    log({ level: 'warn', source: 'API', message: `PetProfileStore init failed (non-fatal): ${(err as Error).message}`, signals: ['init', 'error'] });
  }
})();

// --- API Routes ---

// Create pet profile
app.post('/api/pets', async (req, res) => {
  try {
    const body = req.body as Partial<PetProfile>;
    const pet: PetProfile = {
      id: uuid(),
      name: body.name || '未命名',
      species: body.species || 'cat',
      breed: body.breed || '未知',
      age: body.age || 1,
      weight: body.weight || 4,
      gender: body.gender || 'male',
      indoor: body.indoor ?? true,
      vaccinations: body.vaccinations || [],
      medicalHistory: body.medicalHistory || [],
      allergies: body.allergies || [],
      currentMedications: body.currentMedications || [],
      createdAt: Date.now(),
      ownerId: body.ownerId || 'default-owner',
    };

    await petStore.createPet(pet);
    res.json({ status: 'ok', pet });
  } catch (error) {
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

// Get pet profile
app.get('/api/pets/:id', async (req, res) => {
  try {
    const pet = await petStore.getPet(req.params.id);
    if (!pet) {
      res.status(404).json({ status: 'error', message: 'Pet not found' });
      return;
    }
    res.json({ status: 'ok', pet });
  } catch (error) {
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

// List all pets
app.get('/api/pets', async (_req, res) => {
  try {
    const pets = await petStore.listPets();
    res.json({ status: 'ok', pets });
  } catch (error) {
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

// Consult — triggers multi-agent collaboration
app.post('/api/consult', async (req, res) => {
  const { petId, text, type, skipGenes } = req.body as {
    petId: string;
    text: string;
    type?: ConsultRequest['type'];
    skipGenes?: boolean;
  };

  if (!petId || !text) {
    res.status(400).json({ error: 'Missing petId or text' });
    return;
  }

  const pet = await petStore.getPet(petId);
  if (!pet) {
    res.status(404).json({ error: 'Pet not found' });
    return;
  }

  const request: ConsultRequest = {
    id: uuid(),
    petId,
    text,
    type: type || 'general',
    timestamp: Date.now(),
    skipGenes,
  };

  log({
    level: 'info',
    source: 'API',
    message: `New consultation for ${pet.name}: ${text.slice(0, 100)}`,
    signals: ['pet_care', 'api_request'],
  });

  try {
    const result = await orchestrator.consult(request, pet);
    res.json({
      status: 'ok',
      result: {
        id: result.id,
        petId: result.petId,
        recommendations: result.recommendations,
        negotiationRounds: result.negotiationRounds,
        genesApplied: result.genesApplied,
        processingTimeMs: result.metadata.processingTimeMs,
      },
      agentProposals: result.agentProposals,
      conflicts: result.conflicts,
      messageLog: result.agentMessages,
    });
  } catch (error) {
    log({
      level: 'error',
      source: 'API',
      message: `Consultation failed: ${(error as Error).message}`,
      signals: ['error'],
    });
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

// Feedback — drives Gene evolution
app.post('/api/feedback', async (req, res) => {
  const { consultId, petId, overallScore, categoryScores, comments, outcome, condition, consultSummary } = req.body as
    UserFeedback & { condition?: string; consultSummary?: string };

  if (!consultId || !overallScore) {
    res.status(400).json({ error: 'Missing required feedback fields' });
    return;
  }

  const feedback: UserFeedback = {
    consultId,
    petId: petId || '',
    overallScore,
    categoryScores: categoryScores || {},
    comments: comments || '',
    outcome,
    timestamp: Date.now(),
  };

  try {
    await Promise.all(agents.map(a => a.applyFeedback(feedback)));

    let geneExtracted = false;

    // Extract gene from feedback if condition is known
    if (condition && consultSummary && (overallScore >= 4 || overallScore <= 2)) {
      const pet = petId ? await petStore.getPet(petId) : null;
      const gene = await extractGeneFromFeedback({
        condition,
        species: pet?.species || 'cat',
        breed: pet?.breed,
        consultSummary,
        feedback: {
          rating: overallScore,
          comment: comments || '',
          recovered: outcome === 'resolved',
        },
      });

      if (gene) {
        await gepClient.publishGene(gene);
        geneExtracted = true;
        log({
          level: 'info',
          source: 'API',
          message: `Feedback gene published: ${gene.id} (${gene.category})`,
          signals: ['feedback', 'gene_published', 'treatment_success'],
        });
      }
    }

    // Report to GEP
    gepClient.reportFeedback(consultId, overallScore, comments || '').catch(() => {});

    res.json({ status: 'ok', message: 'Feedback applied', geneExtracted });
  } catch (error) {
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

// SSE endpoint for real-time agent events
app.get('/api/messages/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// Genes endpoint
app.get('/api/genes', (_req, res) => {
  try {
    const genesPath = join(process.cwd(), 'assets', 'gep', 'genes.json');
    const content = readFileSync(genesPath, 'utf-8');
    res.json({ status: 'ok', genes: JSON.parse(content) });
  } catch {
    res.json({ status: 'ok', genes: [] });
  }
});

// Clear all genes
app.delete('/api/genes', async (_req, res) => {
  try {
    await gepClient.clearAllGenes();
    res.json({ status: 'ok', message: 'All genes cleared' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

// Publish gene manually
app.post('/api/genes/publish', async (req, res) => {
  try {
    const gene = req.body;
    await gepClient.publishGene(gene);
    res.json({ status: 'ok', message: `Gene ${gene.id} published` });
  } catch (error) {
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

// Fetch gene from EvoMap
app.get('/api/genes/fetch', async (req, res) => {
  try {
    const condition = req.query.condition as string || 'general';
    const gene = await gepClient.fetchGene(condition);
    res.json({ status: 'ok', gene });
  } catch (error) {
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    agents: agents.map(a => ({ id: a.id, domain: a.domain })),
    version: '0.1.0',
  });
});

app.listen(PORT, () => {
  console.log(`🐾 PetAlliance server running on http://localhost:${PORT}`);
  console.log(`   Agents: ${agents.map(a => a.id).join(', ')}`);
});

export default app;
