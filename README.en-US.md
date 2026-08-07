

# PetAlliance Pet Care Alliance

https://github.com/user-attachments/assets/571e9bbb-1f51-418a-849f-be27d7494c77

PetAlliance is a multi-agent pet care consultation system designed for pet owners. It transforms anxiety-inducing questions like "What should I do if my cat is unwell?" into structured care advice that incorporates pet profiles, multi-expert collaboration, priority assessment, and experience accumulation.

## Pain Points Addressed

- **Fragmented Information:** Search results, forum experiences, and generic AI responses often conflict with each other, making it difficult for pet owners to determine whether to prioritize medical risks, dietary adjustments, or daily care.
- **Lack of Pet Context:** Factors like age, weight, breed, and medication status influence judgment, but standard Q&A systems do not continuously maintain pet profiles.
- **Non-actionable Advice:** Many responses lack observation windows, risk boundaries, and next steps, leaving pet owners unsure of what to do.
- **Inability to Accumulate Experience:** Successful resolutions are not retained by the system, causing subsequent similar issues to start from scratch.

PetAlliance is not intended to replace veterinarians. Instead, it helps pet owners quickly organize information, identify risks, and formulate actionable care plans when faced with uncertainty.

## Product Workflow

1. Create a pet profile, recording basic information such as name, breed, age, and weight.
2. Submit real-world pet care questions, such as vomiting, decreased appetite, skin abnormalities, or boarding during travel.
3. Medical, health, dietary, and boarding Agents analyze in parallel, followed by an orchestrator that resolves conflicts and sets priorities.
4. Generate structured advice containing care actions, observation key points, and risk alerts.
5. Once users confirm the advice is effective, the system extracts the experience and stores it in the gene repository for reuse in future similar queries.

## Core Capabilities

- **Pet Profiles:** Ensures every consultation is grounded in specific pet context rather than generic responses.
- **Multi-Agent Collaboration:** Different professional perspectives propose solutions in parallel, reducing the risk of missing key points in a single answer.
- **Real LLM Consultation Pipeline:** After the frontend submits a query, it calls the backend `/api/consult` to generate structured advice.
- **Feedback Loop:** Once users mark advice as effective, the system extracts reusable experiences.
- **GEP Experience Inheritance:** Subsequent similar consultations can inherit matching experiences, making the system increasingly adept at understanding pets over time.

## Technical Architecture

- **Frontend:** React 18, Vite, Tailwind CSS
- **Backend:** TypeScript, Express, better-sqlite3
- **LLM:** OpenAI SDK, supporting OpenAI-compatible endpoints
- **Protocols:** GEP Gene Evolution Protocol, A2A File/HTTP transmission

## Quick Start

### Installation

```bash
git clone https://github.com/zhongyunWan/pet-alliance.git
cd pet-alliance
npm install
```

### Configuration

Create a `.env` file:

```env
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o
PORT=3001
```

### Running

```bash
# Terminal 1: Backend
npm run dev

# Terminal 2: Frontend
cd web && npx vite --host 0.0.0.0 --port 5174
```

Open `http://localhost:5174`. The frontend will proxy `/api` requests to `localhost:3001`.

## Key Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/consult` | Initiate multi-agent consultation |
| `POST` | `/api/feedback` | Submit feedback and accumulate experience |
| `GET` | `/api/messages/stream` | SSE agent event stream |
| `GET` / `POST` | `/api/pets` | Fetch or create pet profiles |
| `GET` | `/api/genes` | View the experience gene repository |
| `GET` | `/api/health` | Health check |

## Assets & Licensing

The demo video music is sourced from [Pixabay - Product Launch Advertisement Commercial Music by HitsLab](https://pixabay.com/music/future-bass-product-launch-advertisement-commercial-music-301409/) and used under the [Pixabay Content License](https://pixabay.com/service/license-summary/). The track's page indicates `Content ID Registered`; please be mindful of platform detection if published to services like YouTube.

## License

MIT
