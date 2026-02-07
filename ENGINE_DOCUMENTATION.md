# CV Enhancer Engine - Complete Technical Documentation

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Pipeline Flow](#pipeline-flow)
4. [Core Engines](#core-engines)
5. [Services](#services)
6. [Similarity Contract](#similarity-contract)
7. [Configuration](#configuration)
8. [Example Output](#example-output)

---

## System Overview

The CV Enhancer is an intelligent CV evaluation and job-matching system that:

- **Evaluates CV quality** using both structural and semantic analysis
- **Matches CVs against Job Descriptions (JDs)** using vector similarity and LLM-based judgment
- **Generates actionable suggestions** to improve CV competitiveness
- **Creates mock interview questions** based on gaps and requirements

### Key Technologies

- **NestJS**: Backend framework
- **Prisma + PostgreSQL with pgvector**: Database with vector search capabilities
- **Google Gemini AI**: Embeddings (`Gemini-embedding`), LLM judge (`gemini-2.5-flash`), and smart parsing
- **Vector Search**: Cosine similarity for semantic matching (3072 dimensions)

---

## Architecture

### High-Level Architecture

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────┐
│        API Layer (NestJS)               │
│  ┌──────┬──────┬──────┬──────────────┐  │
│  │ Auth │  CV  │  JD  │ Evaluation   │  │
│  └──────┴──────┴──────┴──────────────┘  │
└───────────────┬─────────────────────────┘
                │
       ┌────────┴────────┐
       │                 │
       ▼                 ▼
┌─────────────┐   ┌─────────────┐
│  Services   │   │   Engines   │
│  ──────────  │   │  ─────────  │
│  • Embedding│   │  • CV Qual  │
│  • Chunking │   │  • JD Match │
│  • PDF Parse│   │  • Semantic │
│  • LLM Judge│   │  • Gap Det  │
│  • Smart JD │   │  • Suggest  │
└─────────────┘   └─────────────┘
       │                 │
       └────────┬────────┘
                ▼
      ┌──────────────────┐
      │  PostgreSQL +    │
      │    pgvector      │
      └──────────────────┘
```

### Database Schema (Key Tables)

```
Cv
├── CvSection (EXPERIENCE, PROJECTS, SKILLS, etc.)
│   └── CvChunk (text chunks with 3072-dim embeddings)
├── CvQuality (structural checks)
└── Evaluation (results)

Jd
├── JDRule (requirements extracted from JD)
│   └── JDRuleChunk (atomic requirement chunks with 3072-dim embeddings)
└── Evaluation (results)

RuleSet (CV Quality Rules)
├── CvQualityRule
    └── CvQualityRuleChunk (3072-dim embeddings)
```

---

## Pipeline Flow

### 1. CV Upload & Processing Pipeline

```
User uploads PDF
     │
     ▼
┌──────────────────────────────────┐
│ Parse PDF to text                │
│  • pdf-parse extracts raw text   │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ Detect sections                  │
│  • Classify sections (EXPERIENCE,│
│    PROJECTS, SKILLS, etc.)       │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ Create chunks                    │
│  • Split sections into chunks    │
│  • Preserve context (overlapping)│
│  • Max 500 chars per chunk       │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ Update status to PARSED          │
└──────────────────────────────────┘
```

### 2. JD Upload & Processing Pipeline

```
User submits JD text
     │
     ▼
┌──────────────────────────────────┐
│ Extract rules from JD text       │
│  • Smart LLM parsing (Gemini)    │
│  • Fallback: Regex extraction    │
│  • Categorize (MUST/NICE/BEST)   │
│  • Filter noise (benefits, etc.) │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ Chunk rules into matchable units│
│  • Use LLM chunks if available   │
│  • Fallback: Chunking service    │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ Classify rule intents (async)   │
│  • Technical vs Soft Skills      │
│  • Non-blocking background task  │
└──────────────────────────────────┘
```

### 3. Evaluation Pipeline

```
User runs evaluation
     │
     ▼
┌──────────────────────────────────┐
│ Gate: CV Must Be Parsed          │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ CV Quality (STRUCTURAL only)     │
│  • Quick structural check        │
│  • If NOT_READY → STOP           │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ Embed CV Chunks (3072-dim)       │
│  • Generate embeddings (Gemini)  │
│  • Store in pgvector             │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ CV Quality (STRUCTURAL+SEMANTIC) │
│  • Match against quality rules   │
│  • Vector search + similarity    │
│  • Decision: READY/NEEDS_IMPROVE │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ Embed JD Chunks (3072-dim)       │
│  • Generate embeddings           │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ JD Matching Engine               │
│  (See detailed flow below)       │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ Final DTO Assembly & Persist     │
└──────────────────────────────────┘
```

---

## Core Engines

### 1. Evaluation Service (Pure Orchestrator)

**Location**: `src/routes/evaluation/evaluation.service.ts`

**Purpose**: Orchestrate the entire evaluation pipeline without performing any business logic.

**Responsibilities**:

- Ownership checks (CV/JD belongs to user)
- Pipeline status checks (`Cv.status`)
- Readiness gates (NOT_READY blocks pipeline; NEEDS_IMPROVEMENT continues)
- DTO assembly
- Timing/metrics collection

**Pipeline Stages**:

1. Ensure CV is parsed
2. CV Quality evaluation (structural only) - fast gate
3. Embed CV chunks (3072-dim)
4. CV Quality evaluation (structural + semantic)
5. Hard gate: If NOT_READY, stop
6. Embed JD chunks (3072-dim)
7. JD Matching Engine
8. Final DTO assembly
9. Persist evaluation

**Key Code**:

```typescript
async runEvaluation(userId: string, cvId: string, jdId?: string) {
  const evaluationId = randomUUID()

  // Gate: Ensure CV parsed
  await this.cvService.ensureCvParsed(userId, cvId)

  // CV Quality (STRUCTURAL only, cheap gate)
  const cvQualityStructural = await this.cvQualityEngine.evaluate(cvId, {
    includeSemantic: false
  })

  // Hard gate: If NOT_READY, return immediately
  if (cvQualityStructural.decision === 'NOT_READY') {
    return this.buildResponse(...)
  }

  // Embed CV chunks
  await this.embeddingService.embedCvChunks(cvId)

  // CV Quality (STRUCTURAL + SEMANTIC)
  const cvQualityResult = await this.cvQualityEngine.evaluate(cvId, {
    includeSemantic: true,
    semanticRuleSetKey: 'cv-quality-student-fresher',
  })

  // JD Matching (if JD provided)
  if (jdId) {
    await this.embeddingService.embedJdRuleChunks(jdId)
    const jdMatchResult = await this.jdMatchingEngine.evaluate(cvId, jdId, {...})
  }

  // Persist and return
  await this.evaluationRepo.createEvaluation(userId, cvId, jdId, result, evaluationId)
  return result
}
```

---

### 2. JD Service

**Location**: `src/routes/jd/jd.service.ts`

**Purpose**: Handle JD creation and rule extraction.

**Pipeline**:

```typescript
async createJd(userId: string, title: string | undefined, text: string) {
  const jd = await this.jdRepo.createJd(userId, title)

  // Extract rules from JD text (Smart LLM parsing with fallback)
  const extractedRules = await this.jdRuleExtractionService.extractRulesSemantically(text)

  // Chunk rules into smaller matchable units
  // If smart parser provided chunks, use them directly
  const chunksMap = new Map()
  for (const rule of extractedRules) {
    if (rule.chunks && rule.chunks.length > 0) {
      // Use smart parser chunks
      chunksMap.set(i, rule.chunks.map(chunk => ({ content: chunk })))
    } else {
      // Fallback to chunking service
      const fallbackChunks = this.jdRuleChunkingService.createChunks([rule])
      chunksMap.set(i, fallbackChunks.get(0) || [])
    }
  }

  // Persist rules and chunks
  // ...

  // Classify rule intents (async, non-blocking)
  this.classifyRuleIntents(createdRules).catch(...)
}
```

---

### 3. CV Quality Engine

**Location**: `src/engines/cv-quality/cv-quality.engine.ts`

**Purpose**: Evaluate CV against quality standards (structural + semantic).

**Responsibilities**:

- Execute STRUCTURAL CV quality rules (format/pattern checks)
- Delegate SEMANTIC rules to `SemanticEvaluator`
- Return findings with traceable evidence
- Enforce MUST_HAVE violations → NOT_READY

**Two-Phase Approach**:

**Phase 1: Structural Checks** (Fast, Cheap)

```typescript
// Execute only STRUCTURAL rules
for (const rule of CV_STRUCTURAL_RULES) {
  const result = rule.evaluate(cv)
  findings.push(result)
}
```

**Phase 2: Semantic Checks** (Rich, Embedding-based)

```typescript
if (includeSemantic) {
  const semantic = await this.semanticEvaluator.evaluateCvQualityRules(cvId, semanticRuleSetKey, { topK, thresholds })

  // Map semantic results to findings
  for (const r of semantic.results) {
    const passed = r.result === 'FULL' || r.result === 'PARTIAL'
    findings.push({
      ruleId: r.ruleKey,
      category,
      passed,
      severity,
      reason: passed ? `Semantic evidence: ${r.result}` : `No sufficient semantic evidence`,
      evidence,
    })
  }
}
```

**Decision Logic**:

```typescript
if (mustHaveViolations.length > 0) {
  decision = 'NOT_READY'
} else if (failedNice > 2 || failedBest > 3) {
  decision = 'NEEDS_IMPROVEMENT'
} else {
  decision = 'READY'
}
```

---

### 4. JD Matching Engine

**Location**: `src/engines/jd-matching/jd-matching.engine.ts`

**Purpose**: Match CV content against JD requirements using vector similarity and LLM judgment.

**Responsibilities**:

- Vector match JDRuleChunk ↔ CvChunk (cosine similarity)
- Similarity band classification: HIGH | AMBIGUOUS | LOW
- Rule-level match status: FULL | PARTIAL | NONE
- Section-aware upgrade for PROJECTS/EXPERIENCE
- Optional Gemini judge for AMBIGUOUS refinement
- Deterministic gap detection + suggestion generation + scoring

**Detailed Flow**:

```
For each JD Rule:
    │
    ├─► Semantic evaluation using DB embeddings (CvChunk ↔ JDRuleChunk)
    │     • SemanticEvaluator returns candidates per chunk
    │
    ├─► For each Rule Chunk:
    │       │
    │       ├─► Band Classification
    │       │     • HIGH: similarity >= 0.7
    │       │     • AMBIGUOUS: 0.5 <= similarity < 0.7
    │       │     • LOW: < 0.5
    │       │     • NO_EVIDENCE: No candidates above floor
    │       │
    │       ├─► Optional LLM Judge (for AMBIGUOUS)
    │       │     • Gemini 2.5 Flash
    │       │     • Streaming API (prevents truncation)
    │       │     • Output: FULL | PARTIAL | NONE
    │       │     • Mapping:
    │       │       - FULL → HIGH (ensures strong match)
    │       │       - PARTIAL → AMBIGUOUS (preserves relevance)
    │       │       - NONE → LOW (demotes match)
    │       │
    │       └─► Deduplicate Candidates
    │             • Remove near-duplicates (similarity > 0.95)
    │
    ├─► Multi-Mention Aggregation
    │     • Count unique mentions across CV
    │     • HIGH mentions: similarity >= 0.6
    │     • MEDIUM mentions: 0.5 <= similarity < 0.6
    │     • Boost Logic:
    │       - 3+ HIGH mentions → FULL match
    │       - 1 HIGH + 1 MEDIUM mention → FULL match
    │       - 4+ MEDIUM mentions → FULL match
    │
    ├─► Section Upgrade (if applicable)
    │     • If rule is EXPERIENCE-related
    │     • AND CV has EXPERIENCE section
    │     • Upgrade PARTIAL → FULL
    │
    └─► Rule-Level Decision
          • Aggregate chunk evidence
          • Apply boost rules
          • Final status: FULL | PARTIAL | NONE | NO_EVIDENCE
          • Score: 1.0 (FULL), 0.5 (PARTIAL), 0.0 (NONE)
```

**Band Aggregation Logic** (Conservative):

- All chunks HIGH → FULL
- Any chunk HIGH → PARTIAL
- All chunks AMBIGUOUS/LOW → NONE
- All chunks NO_EVIDENCE → NO_EVIDENCE

**Scoring**:

```typescript
Rule Score = matchStatus score (0.0 | 0.5 | 1.0)
Weighted Score = Rule Score × Rule Type Multiplier
  • MUST_HAVE: 3.0x
  • NICE_TO_HAVE: 2.0x
  • BEST_PRACTICE: 1.0x

Total Score = Σ Weighted Scores / Σ Max Possible Weighted Scores
```

---

### 5. Semantic Evaluator

**Location**: `src/engines/semantic/semantic-evaluator.ts`

**Purpose**: SINGLE SOURCE OF TRUTH for semantic rule evaluation. Used by BOTH CV Quality Engine and JD Matching Engine.

**Responsibilities**:

- Query topK CvChunks via pgvector cosine distance
- Convert distance → similarity
- Apply SIM_FLOOR filtering
- Assign bands (HIGH / AMBIGUOUS / LOW / NO_EVIDENCE)
- Return structured evidence candidates (tie-broken deterministically)
- Rule-level aggregation (FULL / PARTIAL / NONE / NO_EVIDENCE)

**Key Methods**:

```typescript
// For CV Quality Rules
async evaluateCvQualityRules(
  cvId: string,
  ruleSetKey: string,
  config: EvaluationConfig
): Promise<SemanticEvaluationResult>

// For JD Rules
async evaluateJdRules(
  cvId: string,
  jdId: string,
  config: EvaluationConfig
): Promise<SemanticEvaluationResult>
```

**Vector Query** (pgvector):

```sql
SELECT
  cc.id as cv_chunk_id,
  cs.type as section_type,
  cc.content,
  cc.embedding <=> rc.embedding as distance
FROM "CvChunk" cc
JOIN "CvSection" cs ON cs.id = cc."sectionId"
JOIN "JDRuleChunk" rc ON rc.id = $ruleChunkId
WHERE cs."cvId" = $cvId
  AND cc.embedding IS NOT NULL
  AND rc.embedding IS NOT NULL
ORDER BY cc.embedding <=> rc.embedding ASC
LIMIT $topK
```

**Similarity Conversion**:

```typescript
const similarity = 1 - distance // cosine distance → similarity
```

---

### 6. Gap Detector

**Location**: `src/engines/gap-detector.ts`

**Purpose**: Identify missing or weak skills from JD matching.

**Logic**:

```typescript
For each Rule Chunk with matchStatus = NONE or NO_EVIDENCE:
    severity = determineSeverity(ruleType, similarity)

    // Severity Mapping (from SimilarityContract)
    - CRITICAL_SKILL_GAP: MUST_HAVE + NO_EVIDENCE
    - MAJOR_GAP: MUST_HAVE + LOW similarity
    - MINOR_GAP: NICE_TO_HAVE + LOW similarity
    - PARTIAL_MATCH_ADVISORY: PARTIAL match
    - ADVISORY: Other cases
```

**Key Code**:

```typescript
detectGaps(
  evaluationResults: RuleEvaluationResult[],
  ruleTypes: Map<string, RuleType>
): GapDetectionResult {
  const gaps: Gap[] = []

  for (const result of evaluationResults) {
    for (const chunkEvidence of result.chunkEvidence) {
      const severity = getGapSeverity(chunkEvidence.bestBand, ruleType)
      if (severity !== 'NONE') {
        gaps.push(this.detectGapForChunk(...))
      }
    }
  }

  return this.buildSummary(gaps)
}
```

---

### 7. Suggestion Generator

**Location**: `src/engines/suggestion-generator.ts`

**Purpose**: Create actionable suggestions to address gaps.

**Types of Suggestions**:

1. **MISSING** (for NO_EVIDENCE gaps)

   ```
   "Add a bullet showing hands-on experience with {concept}."
   Action: ADD_BULLET
   ```

2. **PARTIAL** (for LOW/AMBIGUOUS matches)

   ```
   "Expand this bullet to clarify how you used {concept} and the impact."
   Action: EXPAND_BULLET
   ```

3. **ADD_METRIC** (for achievements without quantification)

   ```
   "Add quantifiable results (numbers, percentages, or timeframes) for {concept}."
   ```

4. **ADD_LINK** (for projects/GitHub)
   ```
   "Include a link to your {concept} project."
   ```

**Concept Label Extraction**:

```typescript
private extractConceptLabel(content: string): string {
  // Extract 2-3 most important keywords from rule content
  // Filter stopwords and noise
  // Return concise label (e.g., "typescript react" from "Experience with TypeScript and React")
}
```

---

## Similarity Contract

**Location**: `src/engines/similarity/similarity.contract.ts`

**Purpose**: SINGLE SOURCE OF TRUTH for similarity computation. ALL engines MUST use these definitions.

### Vector Operator (pgvector)

```typescript
// pgvector operator: <=> (cosine distance)
// Returns distance in range [0, 2] where:
// - 0 = identical vectors
// - 1 = orthogonal vectors
// - 2 = opposite vectors
export const VECTOR_OPERATOR = '<=>' as const
```

### Similarity Transform

```typescript
// Convert cosine distance to similarity
// similarity = 1 - cosine_distance
// Result range: [-1, 1] where:
//  1 = identical
//  0 = orthogonal
// -1 = opposite
export function distanceToSimilarity(distance: number): number {
  return 1 - distance
}
```

### Similarity Bands

```typescript
export type SimilarityBand = 'HIGH' | 'AMBIGUOUS' | 'LOW' | 'NO_EVIDENCE'

export interface SimilarityThresholds {
  floor: number // Below this = NO_EVIDENCE
  low: number // [floor, low) = LOW
  high: number // [low, high) = AMBIGUOUS, >= high = HIGH
}

// Classify a similarity score into a band
export function classifySimilarityBand(similarity: number, thresholds: SimilarityThresholds): SimilarityBand {
  if (similarity < thresholds.floor) return 'NO_EVIDENCE'
  if (similarity >= thresholds.high) return 'HIGH'
  if (similarity >= thresholds.low) return 'AMBIGUOUS'
  return 'LOW'
}
```

### Rule-Level Aggregation

```typescript
export type RuleLevelResult = 'FULL' | 'PARTIAL' | 'NONE' | 'NO_EVIDENCE'

// Aggregate multiple chunk-level bands into a rule-level result
// Logic:
// - FULL: any chunk has HIGH
// - PARTIAL: none HIGH, but at least one AMBIGUOUS
// - NONE: no AMBIGUOUS/HIGH, but at least one LOW
// - NO_EVIDENCE: no candidates above SIM_FLOOR at all
export function aggregateRuleResult(bands: SimilarityBand[]): RuleLevelResult {
  if (bands.length === 0) return 'NO_EVIDENCE'

  const hasHigh = bands.includes('HIGH')
  const hasAmbiguous = bands.includes('AMBIGUOUS')
  const hasLow = bands.includes('LOW')

  if (hasHigh) return 'FULL'
  if (hasAmbiguous) return 'PARTIAL'
  if (hasLow) return 'NONE'
  return 'NO_EVIDENCE'
}
```

### Section Weights

```typescript
// Default section weights for ranking candidates
// Higher weight = more relevant section
export const DEFAULT_SECTION_WEIGHTS: Record<CvSectionType, number> = {
  EXPERIENCE: 1.15,
  PROJECTS: 1.15,
  SKILLS: 1.05,
  ACTIVITIES: 1.0,
  SUMMARY: 0.9,
  EDUCATION: 0.9,
}
```

### Deterministic Tie-Break

```typescript
// Sort candidates deterministically
// 1. Similarity (descending)
// 2. Section weight (descending)
// 3. Section priority (ascending)
// 4. Chunk order (ascending)
// 5. Chunk ID (ascending)
export function sortCandidates<T extends CandidateForTieBreak>(candidates: T[]): T[]
```

### PARTIAL → FULL Upgrade Logic

```typescript
// Allow upgrade from PARTIAL to FULL if:
// - Best match is from EXPERIENCE/PROJECTS section
// - Best match similarity >= low threshold
// - Multiple candidates above low threshold
export function canUpgradePartialToFull(
  bestMatch: { sectionType: CvSectionType; similarity: number },
  candidatesAboveLow: number,
  thresholds: SimilarityThresholds,
  config: UpgradeConfig,
): boolean
```

### Official Severity Mapping

```typescript
export type GapSeverity =
  | 'CRITICAL_SKILL_GAP'
  | 'MAJOR_GAP'
  | 'MINOR_GAP'
  | 'PARTIAL_MATCH_ADVISORY'
  | 'ADVISORY'
  | 'NONE'

// Map similarity band + rule type to gap severity
export function getGapSeverity(
  band: SimilarityBand,
  ruleType: 'MUST_HAVE' | 'NICE_TO_HAVE' | 'BEST_PRACTICE',
): GapSeverity {
  if (band === 'HIGH') return 'NONE'
  if (band === 'NO_EVIDENCE') {
    return ruleType === 'MUST_HAVE' ? 'CRITICAL_SKILL_GAP' : 'MINOR_GAP'
  }
  if (band === 'LOW') {
    return ruleType === 'MUST_HAVE' ? 'MAJOR_GAP' : 'MINOR_GAP'
  }
  return 'PARTIAL_MATCH_ADVISORY'
}
```

---

## Services

### 1. Embedding Service

**Purpose**: Generate vector embeddings for text chunks.

**Model**: `text-embedding-004` (Gemini)
**Dimension**: 3072
**Batch Size**: 100 chunks

**Usage**:

```typescript
await embeddingService.embedCvChunks(cvId)
await embeddingService.embedJdRuleChunks(jdId)
```

---

### 2. Gemini Judge Service

**Purpose**: LLM-based relevance judgment for ambiguous matches.

**Model**: `gemini-2.5-flash`
**Max Output**: 1024 tokens
**Temperature**: 0 (deterministic)

**Prompt Structure**:

```
You are a CV-JD matching judge.

JD REQUIREMENT: "TypeScript and React"
CV CONTENT (from SKILLS): "TypeScript, JavaScript, React.js"

Evaluate the match status:
Respond with JSON: {status: "FULL"|"PARTIAL"|"NONE", reason: string, confidence: "low"|"medium"|"high"}
```

**Output Status Mapping**:

- **FULL**: Strong/Exact match. Special cases:
  - **English Communication**: Automatic FULL if CV is in English.
  - **Problem Solving**: Automatic FULL if CV has real-world solutions.
- **PARTIAL**: Implied/Related match.
- **NONE**: No clear connection.

````

**Features**:

- **Streaming API** (`generateContentStream`) to prevent truncation
- Concise reasons (max 25 words)
- Retry logic with exponential backoff
- Token usage logging

---

### 3. Gemini JD Parser Service

**Purpose**: Smart JD parsing using LLM to extract structured rules.

**Model**: `gemini-2.5-flash-lite`
**Output**: Structured rules with categories, titles, and atomic chunks

**Benefits**:

- **Better rule extraction** than regex
- **Automatic noise filtering** (benefits, company culture, etc.)
- **Explicitly ignores** availability/duration rules (e.g., "6-month contract", "Must be available immediately")
- **Atomic chunking** (e.g., `["JavaScript", "TypeScript", "React"]`)
- Categorization (`MUST_HAVE`, `NICE_TO_HAVE`, `BEST_PRACTICE`)

**Fallback**: If LLM fails, falls back to regex-based extraction.

---

## Configuration

### Environment Variables

#### Similarity Thresholds

```env
SIM_FLOOR=0.3                    # Minimum similarity to consider
SIM_LOW_THRESHOLD=0.5            # LOW/AMBIGUOUS boundary
SIM_HIGH_THRESHOLD=0.7           # AMBIGUOUS/HIGH boundary
````

#### Multi-Mention Boost

```env
MULTI_MENTION_THRESHOLD=3        # Mentions needed for boost
MULTI_MENTION_HIGH_SIMILARITY=0.6 # High mention threshold
DEDUP_SIMILARITY_THRESHOLD=0.95   # Near-duplicate threshold
```

#### LLM Configuration

```env
GEMINI_API_KEY=your_api_key
EMBEDDING_MODEL=text-embedding-004
EMBEDDING_DIM=3072
LLM_JUDGE_ENABLED=true
LLM_JUDGE_BATCH_SIZE=10
```

#### Search Configuration

```env
MATCH_TOP_K=5                    # Top candidates per rule chunk
```

---

## Performance Characteristics

### Typical Latencies

- **CV Upload**: 2-4s (PDF parsing + sectioning)
- **CV Embedding**: 1-2s (100-200 chunks, 3072-dim)
- **JD Upload**: 1-2s (smart parsing)
- **Evaluation Run**: 5-15s (depending on JD size)
  - Vector search: <100ms per rule chunk
  - LLM judge: 1-2s per AMBIGUOUS match
  - Batch processing: Used for efficiency

### Token Usage (per evaluation)

- **Embeddings**: ~200-500 tokens
- **LLM Judge**: ~30-60 tokens per judgment
- **Smart JD Parser**: ~500-2000 tokens per JD

---

## Error Handling

### Graceful Degradation

1. **LLM Unavailable**: Falls back to vector-only matching
2. **Smart Parser Fails**: Falls back to regex extraction
3. **Embedding Fails**: Returns error (critical service)

### Retry Logic

- LLM services: 3 retries with exponential backoff
- Rate limits: Automatic retry with delay

---

## Glossary

- **Chunk**: Small text segment (300-500 chars) used for matching
- **Embedding**: Vector representation of text (3072 dimensions)
- **Band**: Similarity classification (HIGH/AMBIGUOUS/LOW/NO_EVIDENCE)
- **Rule**: Single requirement extracted from JD
- **Match Status**: Rule-level result (FULL/PARTIAL/NONE/NO_EVIDENCE)
- **Boost**: Logic to upgrade match status based on evidence
- **Intent**: Classification of rule purpose (Technical/Soft Skill/etc.)
- **Cosine Distance**: pgvector operator `<=>` measuring vector distance [0, 2]
- **Similarity**: Transformed distance (1 - distance) in range [-1, 1]

---

---

## Example Output

Below is a detailed example of the engine's output for an evaluation run:

```json
{
  "evaluationId": "2afa8562-b05a-4de7-9b8d-100c8c6f347c",
  "cvQuality": {
    "decision": "READY",
    "mustHaveViolations": [],
    "niceToHaveFindings": [
      {
        "ruleId": "S-NH-07",
        "category": "NICE_TO_HAVE",
        "passed": false,
        "severity": "warning",
        "reason": "Consider adding an Activities section for volunteer or extracurricular work",
        "evidence": [
          {
            "type": "section",
            "cvId": "93b539ca-e77a-46c0-bf72-6c4aa435f77e",
            "sectionType": "ACTIVITIES"
          }
        ]
      },
      {
        "ruleId": "AUTO-structure-ats-compliance-82bc25cd",
        "category": "NICE_TO_HAVE",
        "passed": false,
        "severity": "info",
        "reason": "No sufficient semantic evidence (best n/a, NO_EVIDENCE)",
        "evidence": [
          {
            "type": "section",
            "cvId": "93b539ca-e77a-46c0-bf72-6c4aa435f77e",
            "sectionType": "SUMMARY"
          }
        ]
      }
    ],
    "bestPracticeFindings": [
      {
        "ruleId": "S-BP-01",
        "category": "BEST_PRACTICE",
        "passed": false,
        "severity": "info",
        "reason": "Work experience would strengthen your CV",
        "evidence": [
          {
            "type": "section",
            "cvId": "93b539ca-e77a-46c0-bf72-6c4aa435f77e",
            "sectionType": "EXPERIENCE"
          }
        ]
      },
      {
        "ruleId": "S-BP-03",
        "category": "BEST_PRACTICE",
        "passed": false,
        "severity": "info",
        "reason": "Consider adding measurable results (e.g., \"improved performance by 30%\")",
        "evidence": [
          {
            "type": "section",
            "cvId": "93b539ca-e77a-46c0-bf72-6c4aa435f77e",
            "sectionType": "EXPERIENCE"
          }
        ]
      }
    ],
    "scores": {
      "mustHaveScore": 100,
      "niceToHaveScore": 80,
      "bestPracticeScore": 60,
      "totalScore": 86
    },
    "ruleSetVersion": "student-fresher.cv-quality@2026-02-03"
  },
  "jdMatch": {
    "level": "STRONG_MATCH",
    "matchTrace": [
      {
        "ruleId": "62920260-0e2c-440c-b886-12be7b37affd",
        "ruleType": "MUST_HAVE",
        "ruleContent": "Strong experience in TypeScript and NestJS for building and maintaining backend services.",
        "chunkEvidence": [
          {
            "ruleChunkId": "22ec1f06-60ec-46fc-b99c-08ef914c7e32",
            "ruleChunkContent": "NestJS",
            "candidates": [],
            "bestCandidate": {
              "cvChunkId": "20ddb03b-6939-4c68-92b0-dcab78319fec",
              "sectionId": "14d45298-bb3e-4674-a1c4-07e2dc6ec8e4",
              "sectionType": "PROJECTS",
              "score": 0.6590400934219548,
              "band": "AMBIGUOUS"
            },
            "bandStatus": "HIGH",
            "judgeUsed": true,
            "judgeSkipped": false,
            "judgeUnavailable": false,
            "judgeResult": {
              "status": "FULL",
              "reason": "The CV content explicitly states the use of 'NestJS' in a production-style E-commerce API project.",
              "confidence": "high"
            }
          },
          {
            "ruleChunkId": "e7fd2088-2d42-4bec-a3d4-3a256ac91cca",
            "ruleChunkContent": "TypeScript",
            "candidates": [],
            "bestCandidate": {
              "cvChunkId": "eb6b9f7a-90e2-47b3-a09f-0e5a68af9a39",
              "sectionId": "7274dd19-e2aa-44ab-94ae-d2ffbbb6eab0",
              "sectionType": "SKILLS",
              "score": 0.5862076385268734,
              "band": "AMBIGUOUS"
            },
            "bandStatus": "HIGH",
            "judgeUsed": true,
            "judgeSkipped": false,
            "judgeUnavailable": false,
            "judgeResult": {
              "status": "FULL",
              "reason": "TypeScript is explicitly listed under the 'Languages' section in the CV content, directly matching the JD requirement.",
              "confidence": "high"
            }
          }
        ],
        "matchStatus": "FULL",
        "bestChunkMatch": {
          "ruleChunkId": "22ec1f06-60ec-46fc-b99c-08ef914c7e32",
          "cvChunkId": "20ddb03b-6939-4c68-92b0-dcab78319fec",
          "sectionType": "PROJECTS",
          "score": 0.6590400934219548,
          "band": "AMBIGUOUS"
        },
        "sectionUpgradeApplied": false,
        "multiMentionCount": 4,
        "multiMentionBoost": true,
        "mentionDetails": {
          "high": 3,
          "medium": 1,
          "low": 0
        },
        "score": 1,
        "weightedScore": 1,
        "satisfied": true
      },
      {
        "ruleId": "e90d87fd-412c-480b-9274-83337819af76",
        "ruleType": "MUST_HAVE",
        "ruleContent": "Experience working with data pipelines that integrate large language models for intelligent features.",
        "chunkEvidence": [
          {
            "ruleChunkId": "00f09e5f-a1c3-4b13-8641-7d0ca49515b1",
            "ruleChunkContent": "Data pipelines",
            "candidates": [],
            "bestCandidate": {
              "cvChunkId": "67084c27-4be1-4a2c-9dee-75cae4803c3f",
              "sectionId": "14d45298-bb3e-4674-a1c4-07e2dc6ec8e4",
              "sectionType": "PROJECTS",
              "score": 0.5947331673225007,
              "band": "AMBIGUOUS"
            },
            "bandStatus": "HIGH",
            "judgeUsed": true,
            "judgeSkipped": false,
            "judgeUnavailable": false,
            "judgeResult": {
              "status": "FULL",
              "reason": "The CV explicitly mentions designing a 'pipeline' for processing data, directly matching the 'Data pipelines' requirement.",
              "confidence": "high"
            }
          },
          {
            "ruleChunkId": "96b1f480-430b-430d-b120-7a1343eaa0a0",
            "ruleChunkContent": "LLM integration",
            "candidates": [],
            "bestCandidate": {
              "cvChunkId": "3f1eb59c-47f2-4a07-ae7c-0899870058be",
              "sectionId": "14d45298-bb3e-4674-a1c4-07e2dc6ec8e4",
              "sectionType": "PROJECTS",
              "score": 0.6291773185172039,
              "band": "AMBIGUOUS"
            },
            "bandStatus": "HIGH",
            "judgeUsed": true,
            "judgeSkipped": false,
            "judgeUnavailable": false,
            "judgeResult": {
              "status": "FULL",
              "reason": "The mention of 'tokens per document' strongly implies the use and integration of Large Language Models for document processing.",
              "confidence": "high"
            }
          },
          {
            "ruleChunkId": "c7131a35-5de7-4116-94af-d945636ba720",
            "ruleChunkContent": "Large Language Models (LLM)",
            "candidates": [],
            "bestCandidate": {
              "cvChunkId": "67084c27-4be1-4a2c-9dee-75cae4803c3f",
              "sectionId": "14d45298-bb3e-4674-a1c4-07e2dc6ec8e4",
              "sectionType": "PROJECTS",
              "score": 0.5891073239913834,
              "band": "AMBIGUOUS"
            },
            "bandStatus": "AMBIGUOUS",
            "judgeUsed": true,
            "judgeSkipped": false,
            "judgeUnavailable": false,
            "judgeResult": {
              "status": "PARTIAL",
              "reason": "The CV mentions \"embeddings-based document analysis,\" a core technique often used with or by LLMs, implying related skills.",
              "confidence": "high"
            }
          }
        ],
        "matchStatus": "FULL",
        "bestChunkMatch": {
          "ruleChunkId": "96b1f480-430b-430d-b120-7a1343eaa0a0",
          "cvChunkId": "3f1eb59c-47f2-4a07-ae7c-0899870058be",
          "sectionType": "PROJECTS",
          "score": 0.6291773185172039,
          "band": "AMBIGUOUS"
        },
        "sectionUpgradeApplied": false,
        "multiMentionCount": 3,
        "multiMentionBoost": true,
        "mentionDetails": {
          "high": 1,
          "medium": 2,
          "low": 0
        },
        "score": 1,
        "weightedScore": 1,
        "satisfied": true
      },
      {
        "ruleId": "570e0601-5ee1-4b77-a225-3ed698c45107",
        "ruleType": "NICE_TO_HAVE",
        "ruleContent": "Familiarity with LLM concepts such as prompt design, model integration, or evaluation workflows is expected.",
        "chunkEvidence": [
          {
            "ruleChunkId": "7ba8410a-ceb7-4e00-a069-7371c92c8946",
            "ruleChunkContent": "LLM model integration",
            "candidates": [],
            "bestCandidate": {
              "cvChunkId": "3f1eb59c-47f2-4a07-ae7c-0899870058be",
              "sectionId": "14d45298-bb3e-4674-a1c4-07e2dc6ec8e4",
              "sectionType": "PROJECTS",
              "score": 0.6326166300043435,
              "band": "AMBIGUOUS"
            },
            "bandStatus": "HIGH",
            "judgeUsed": true,
            "judgeSkipped": false,
            "judgeUnavailable": false,
            "judgeResult": {
              "status": "FULL",
              "reason": "The mention of \"tokens per document\" strongly indicates the use and integration of an LLM for document processing and automation.",
              "confidence": "high"
            }
          },
          {
            "ruleChunkId": "b05e24bf-988f-4af8-8182-4c3b6d5bfeab",
            "ruleChunkContent": "Prompt design",
            "candidates": [],
            "bestCandidate": {
              "cvChunkId": "4a98cf97-cff1-4988-a3ee-bfbb412b973c",
              "sectionId": "14d45298-bb3e-4674-a1c4-07e2dc6ec8e4",
              "sectionType": "PROJECTS",
              "score": 0.5614704583760749,
              "band": "AMBIGUOUS"
            },
            "bandStatus": "LOW",
            "judgeUsed": true,
            "judgeSkipped": false,
            "judgeUnavailable": false,
            "judgeResult": {
              "status": "NONE",
              "reason": "The CV content describes backend, embeddings pipeline, and frontend work, but does not mention prompt design or related activities.",
              "confidence": "high"
            }
          },
          {
            "ruleChunkId": "cfc53c33-c371-4e5f-bed9-3dce6390e182",
            "ruleChunkContent": "LLM evaluation workflows",
            "candidates": [],
            "bestCandidate": {
              "cvChunkId": "67084c27-4be1-4a2c-9dee-75cae4803c3f",
              "sectionId": "14d45298-bb3e-4674-a1c4-07e2dc6ec8e4",
              "sectionType": "PROJECTS",
              "score": 0.6373310521446449,
              "band": "AMBIGUOUS"
            },
            "bandStatus": "AMBIGUOUS",
            "judgeUsed": true,
            "judgeSkipped": false,
            "judgeUnavailable": false,
            "judgeResult": {
              "status": "PARTIAL",
              "reason": "CV describes an embeddings-based document analysis pipeline, which is related to LLM technologies and workflows, but doesn't explicitly mention LLM evaluation.",
              "confidence": "high"
            }
          }
        ],
        "matchStatus": "FULL",
        "bestChunkMatch": {
          "ruleChunkId": "cfc53c33-c371-4e5f-bed9-3dce6390e182",
          "cvChunkId": "67084c27-4be1-4a2c-9dee-75cae4803c3f",
          "sectionType": "PROJECTS",
          "score": 0.6373310521446449,
          "band": "AMBIGUOUS"
        },
        "sectionUpgradeApplied": false,
        "multiMentionCount": 2,
        "multiMentionBoost": true,
        "mentionDetails": {
          "high": 1,
          "medium": 1,
          "low": 0
        },
        "score": 1,
        "weightedScore": 0.5,
        "satisfied": true
      },
      {
        "ruleId": "45185e2a-127b-42cf-be40-6e4b7de739c9",
        "ruleType": "BEST_PRACTICE",
        "ruleContent": "Eagerness to learn, collaborate, and contribute to real-world products.",
        "chunkEvidence": [
          {
            "ruleChunkId": "00f4a3ce-4e4e-44e1-9ef3-d7fcf43ef1c0",
            "ruleChunkContent": "Collaboration",
            "candidates": [],
            "bestCandidate": {
              "cvChunkId": "4a98cf97-cff1-4988-a3ee-bfbb412b973c",
              "sectionId": "14d45298-bb3e-4674-a1c4-07e2dc6ec8e4",
              "sectionType": "PROJECTS",
              "score": 0.5598111010048149,
              "band": "AMBIGUOUS"
            },
            "bandStatus": "HIGH",
            "judgeUsed": true,
            "judgeSkipped": false,
            "judgeUnavailable": false,
            "judgeResult": {
              "status": "FULL",
              "reason": "The CV explicitly states 'collaborating in a 3-person team' to deliver a shared outcome, directly matching the requirement.",
              "confidence": "high"
            }
          },
          {
            "ruleChunkId": "53b49dd1-8c3f-478b-b2a0-47905d74af92",
            "ruleChunkContent": "Contribute to products",
            "candidates": [],
            "bestCandidate": {
              "cvChunkId": "4a98cf97-cff1-4988-a3ee-bfbb412b973c",
              "sectionId": "14d45298-bb3e-4674-a1c4-07e2dc6ec8e4",
              "sectionType": "PROJECTS",
              "score": 0.6025160902700208,
              "band": "AMBIGUOUS"
            },
            "bandStatus": "HIGH",
            "judgeUsed": true,
            "judgeSkipped": false,
            "judgeUnavailable": false,
            "judgeResult": {
              "status": "FULL",
              "reason": "The CV explicitly states \"Contributed to\" and mentions delivering an \"MVP,\" which directly aligns with contributing to products.",
              "confidence": "high"
            }
          },
          {
            "ruleChunkId": "5e5c7b5c-4916-48b7-9eef-24f089945c4f",
            "ruleChunkContent": "Eager to learn",
            "candidates": [],
            "bestCandidate": {
              "cvChunkId": "fa7f4811-0bee-4eed-92d5-4004161b01c7",
              "sectionId": "dacdc07e-f1aa-44d7-8691-c0c5eb24e94f",
              "sectionType": "EDUCATION",
              "score": 0.616492083637492,
              "band": "AMBIGUOUS"
            },
            "bandStatus": "AMBIGUOUS",
            "judgeUsed": true,
            "judgeSkipped": false,
            "judgeUnavailable": false,
            "judgeResult": {
              "status": "PARTIAL",
              "reason": "Ongoing education implies a commitment to learning and acquiring new knowledge, but doesn't explicitly state eagerness.",
              "confidence": "medium"
            }
          }
        ],
        "matchStatus": "FULL",
        "bestChunkMatch": {
          "ruleChunkId": "5e5c7b5c-4916-48b7-9eef-24f089945c4f",
          "cvChunkId": "fa7f4811-0bee-4eed-92d5-4004161b01c7",
          "sectionType": "EDUCATION",
          "score": 0.616492083637492,
          "band": "AMBIGUOUS"
        },
        "sectionUpgradeApplied": false,
        "multiMentionCount": 5,
        "multiMentionBoost": true,
        "mentionDetails": {
          "high": 0,
          "medium": 5,
          "low": 0
        },
        "score": 1,
        "weightedScore": 0.25,
        "satisfied": true
      },
      {
        "ruleId": "d897b992-7013-4ea1-958c-10c0f8b2fa4c",
        "ruleType": "MUST_HAVE",
        "ruleContent": "Hands-on experience developing production-ready backend services, including designing APIs and implementing business logic.",
        "chunkEvidence": [
          {
            "ruleChunkId": "06ca003d-9d7e-4a2c-9dee-75cae4803c3f",
            "ruleChunkContent": "Business logic implementation",
            "candidates": [],
            "bestCandidate": {
              "cvChunkId": "5049e29e-a996-4913-a52b-240f94636142",
              "sectionId": "14d45298-bb3e-4674-a1c4-07e2dc6ec8e4",
              "sectionType": "PROJECTS",
              "score": 0.6057468652725392,
              "band": "AMBIGUOUS"
            },
            "bandStatus": "HIGH",
            "judgeUsed": true,
            "judgeSkipped": false,
            "judgeUnavailable": false,
            "judgeResult": {
              "status": "FULL",
              "reason": "The CV describes implementing solutions for core business processes (cart/order) to ensure business consistency (inventory).",
              "confidence": "high"
            }
          },
          {
            "ruleChunkId": "ec72ce40-1f47-4916-b037-edc8cfbfe1c1",
            "ruleChunkContent": "API design",
            "candidates": [],
            "bestCandidate": {
              "cvChunkId": "d70ae43c-f36c-4ea6-90c6-6c589f153c93",
              "sectionId": "14d45298-bb3e-4674-a1c4-07e2dc6ec8e4",
              "sectionType": "PROJECTS",
              "score": 0.6153390178286455,
              "band": "AMBIGUOUS"
            },
            "bandStatus": "LOW",
            "judgeUsed": true,
            "judgeSkipped": false,
            "judgeUnavailable": false,
            "judgeResult": {
              "status": "NONE",
              "reason": "Failed to parse judge response",
              "confidence": "low"
            }
          },
          {
            "ruleChunkId": "f4add1ce-bfe2-48f2-a24c-d755855c2c8d",
            "ruleChunkContent": "Production-ready services",
            "candidates": [],
            "bestCandidate": {
              "cvChunkId": "cb68682b-1fd0-4b2c-8e5f-8a6a16f18ca4",
              "sectionId": "14d45298-bb3e-4674-a1c4-07e2dc6ec8e4",
              "sectionType": "PROJECTS",
              "score": 0.6292612619529178,
              "band": "AMBIGUOUS"
            },
            "bandStatus": "HIGH",
            "judgeUsed": true,
            "judgeSkipped": false,
            "judgeUnavailable": false,
            "judgeResult": {
              "status": "FULL",
              "reason": "The CV details deployment technologies and CI/CD pipelines explicitly used for production, directly demonstrating experience with production-ready services.",
              "confidence": "high"
            }
          }
        ],
        "matchStatus": "FULL",
        "bestChunkMatch": {
          "ruleChunkId": "f4add1ce-bfe2-48f2-a24c-d755855c2c8d",
          "cvChunkId": "cb68682b-1fd0-4b2c-8e5f-8a6a16f18ca4",
          "sectionType": "PROJECTS",
          "score": 0.6292612619529178,
          "band": "AMBIGUOUS"
        },
        "sectionUpgradeApplied": false,
        "multiMentionCount": 2,
        "multiMentionBoost": true,
        "mentionDetails": {
          "high": 1,
          "medium": 1,
          "low": 0
        },
        "score": 1,
        "weightedScore": 1,
        "satisfied": true
      },
      {
        "ruleId": "20b3d6b8-93ca-4844-974a-46701d7fc50f",
        "ruleType": "MUST_HAVE",
        "ruleContent": "Proficiency in writing tests for backend services.",
        "chunkEvidence": [
          {
            "ruleChunkId": "46ed33bf-ce5f-4d5c-82fc-91c936d7f62c",
            "ruleChunkContent": "Testing",
            "candidates": [],
            "bestCandidate": {
              "cvChunkId": "d70ae43c-f36c-4ea6-90c6-6c589f153c93",
              "sectionId": "14d45298-bb3e-4674-a1c4-07e2dc6ec8e4",
              "sectionType": "PROJECTS",
              "score": 0.5441833734512368,
              "band": "AMBIGUOUS"
            },
            "bandStatus": "LOW",
            "judgeUsed": true,
            "judgeSkipped": false,
            "judgeUnavailable": false,
            "judgeResult": {
              "status": "NONE",
              "reason": "The CV content describes development and optimization tasks, but does not mention 'testing' or related activities.",
              "confidence": "high"
            }
          },
          {
            "ruleChunkId": "72e1cfd1-8526-4d68-a8a0-61318be2e11d",
            "ruleChunkContent": "Integration testing",
            "candidates": [],
            "bestCandidate": {
              "cvChunkId": "5049e29e-a996-4913-a52b-240f94636142",
              "sectionId": "14d45298-bb3e-4674-a1c4-07e2dc6ec8e4",
              "sectionType": "PROJECTS",
              "score": 0.5637942064421764,
              "band": "AMBIGUOUS"
            },
            "bandStatus": "AMBIGUOUS",
            "judgeUsed": true,
            "judgeSkipped": false,
            "judgeUnavailable": false,
            "judgeResult": {
              "status": "PARTIAL",
              "reason": "The CV describes handling complex interactions between multiple system components, which is the domain of integration, but doesn't explicitly mention testing.",
              "confidence": "medium"
            }
          },
          {
            "ruleChunkId": "a0e91d33-dbae-41e1-ad64-20bd1bf807ea",
            "ruleChunkContent": "Unit testing",
            "candidates": [],
            "bestCandidate": {
              "cvChunkId": "5049e29e-a996-4913-a52b-240f94636142",
              "sectionId": "14d45298-bb3e-4674-a1c4-07e2dc6ec8e4",
              "sectionType": "PROJECTS",
              "score": 0.5477291558273166,
              "band": "AMBIGUOUS"
            },
            "bandStatus": "LOW",
            "judgeUsed": true,
            "judgeSkipped": false,
            "judgeUnavailable": false,
            "judgeResult": {
              "status": "NONE",
              "reason": "The CV content describes handling race conditions and concurrency, which is unrelated to the practice of unit testing.",
              "confidence": "high"
            }
          }
        ],
        "matchStatus": "FULL",
        "bestChunkMatch": {
          "ruleChunkId": "72e1cfd1-8526-4d68-a8a0-61318be2e11d",
          "cvChunkId": "5049e29e-a996-4913-a52b-240f94636142",
          "sectionType": "PROJECTS",
          "score": 0.5637942064421764,
          "band": "AMBIGUOUS"
        },
        "sectionUpgradeApplied": false,
        "multiMentionCount": 4,
        "multiMentionBoost": true,
        "mentionDetails": {
          "high": 0,
          "medium": 4,
          "low": 0
        },
        "score": 1,
        "weightedScore": 1,
        "satisfied": true
      },
      {
        "ruleId": "6fbfde27-4b2f-4908-b21e-281a26c88fa1",
        "ruleType": "MUST_HAVE",
        "ruleContent": "Familiarity with modern backend architectures.",
        "chunkEvidence": [
          {
            "ruleChunkId": "19fd5817-74a0-422f-93cf-dd0080253b43",
            "ruleChunkContent": "Backend architectures",
            "candidates": [],
            "bestCandidate": {
              "cvChunkId": "4a98cf97-cff1-4988-a3ee-bfbb412b973c",
              "sectionId": "14d45298-bb3e-4674-a1c4-07e2dc6ec8e4",
              "sectionType": "PROJECTS",
              "score": 0.6314092498177838,
              "band": "AMBIGUOUS"
            },
            "bandStatus": "HIGH",
            "judgeUsed": true,
            "judgeSkipped": false,
            "judgeUnavailable": false,
            "judgeResult": {
              "status": "FULL",
              "reason": "The CV explicitly states \"Contributed to backend architecture\", directly matching the JD requirement.",
              "confidence": "high"
            }
          }
        ],
        "matchStatus": "FULL",
        "bestChunkMatch": {
          "ruleChunkId": "19fd5817-74a0-422f-93cf-dd0080253b43",
          "cvChunkId": "4a98cf97-cff1-4988-a3ee-bfbb412b973c",
          "sectionType": "PROJECTS",
          "score": 0.6314092498177838,
          "band": "AMBIGUOUS"
        },
        "sectionUpgradeApplied": false,
        "multiMentionCount": 3,
        "multiMentionBoost": true,
        "mentionDetails": {
          "high": 3,
          "medium": 0,
          "low": 0
        },
        "score": 1,
        "weightedScore": 1,
        "satisfied": true
      }
    ],
    "gaps": [],
    "suggestions": [],
    "scores": {
      "mustHaveScore": 100,
      "niceToHaveScore": 100,
      "bestPracticeScore": 100,
      "totalScore": 100
    }
  },
  "mockQuestions": [],
  "decisionSupport": {
    "readinessScore": 100,
    "recommendation": "READY_TO_APPLY",
    "explanation": {
      "criticalMustHaveGaps": 0,
      "majorGaps": 0,
      "improvementAreas": 0
    }
  },
  "trace": {
    "requestId": "cdb83bd8-4184-4d5e-8f5e-60daffd5799f",
    "cvId": "93b539ca-e77a-46c0-bf72-6c4aa435f77e",
    "jdId": "7481d507-9550-4a3c-aeb9-36c1699fa238",
    "ruleSetVersion": "student-fresher.cv-quality@2026-02-03",
    "timingsMs": {
      "total": 51430
    }
  }
}
```

---

## Contact & Support

For questions or issues, please refer to the project repository or contact the development team.
