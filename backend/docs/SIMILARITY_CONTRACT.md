# Canonical Similarity Contract

This document defines the **single source of truth** for similarity computation in the CV Enhancer system.

**All engines MUST reference this contract. DO NOT duplicate or redefine similarity logic.**

## Vector Operator

| Property | Value |
|----------|-------|
| pgvector operator | `<=>` (cosine distance) |
| Distance range | `[0, 2]` where 0 = identical, 1 = orthogonal, 2 = opposite |

## Similarity Transform

```
similarity = 1 - cosine_distance
```

| Similarity | Meaning |
|------------|---------|
| 1.0 | Identical vectors |
| 0.0 | Orthogonal vectors |
| -1.0 | Opposite vectors |

## Thresholds

| Threshold | Default | Purpose |
|-----------|---------|---------|
| `SIM_FLOOR` | 0.15 | Candidates below this are NO_EVIDENCE |
| `SIM_LOW_THRESHOLD` | 0.40 | Boundary between LOW and AMBIGUOUS |
| `SIM_HIGH_THRESHOLD` | 0.75 | Boundary between AMBIGUOUS and HIGH |

## Similarity Bands

| Band | Condition |
|------|-----------|
| `NO_EVIDENCE` | `similarity < SIM_FLOOR` |
| `LOW` | `SIM_FLOOR <= similarity < SIM_LOW_THRESHOLD` |
| `AMBIGUOUS` | `SIM_LOW_THRESHOLD <= similarity < SIM_HIGH_THRESHOLD` |
| `HIGH` | `similarity >= SIM_HIGH_THRESHOLD` |

## Rule-Level Aggregation

| Result | Condition |
|--------|-----------|
| `FULL` | Any chunk has HIGH band |
| `PARTIAL` | No HIGH, but at least one AMBIGUOUS |
| `NONE` | No AMBIGUOUS/HIGH, but at least one LOW |
| `NO_EVIDENCE` | No candidates above SIM_FLOOR |

## Section Weights (Soft Ranking)

Used for tie-breaking only, NOT hard filtering.

| Section | Weight |
|---------|--------|
| EXPERIENCE | 1.15 |
| PROJECTS | 1.15 |
| SKILLS | 1.05 |
| ACTIVITIES | 1.00 |
| SUMMARY | 0.90 |
| EDUCATION | 0.90 |

## Deterministic Tie-Break Order

When multiple candidates have equal similarity:

1. Similarity DESC
2. Section weight DESC
3. Section priority ASC (EXPERIENCE=1, PROJECTS=2, SKILLS=3, ACTIVITIES=4, EDUCATION=5, SUMMARY=6)
4. Chunk order ASC
5. Chunk ID ASC (lexicographic)

## PARTIAL → FULL Upgrade

A PARTIAL result may be upgraded to FULL if ALL conditions are met:

1. Best candidate is from EXPERIENCE or PROJECTS
2. Best similarity >= (SIM_HIGH_THRESHOLD - 0.05)
3. At least 2 candidates with similarity >= SIM_LOW_THRESHOLD

## Implementation

The canonical implementation is in:

```
backend/src/engines/similarity/similarity.contract.ts
```

**All engines MUST import and use functions from this file.**

## Audit Checklist

- [ ] Vector operator is `<=>` everywhere
- [ ] Similarity = `1 - distance` everywhere
- [ ] SIM_FLOOR applied in every topK query
- [ ] Bands computed using `classifySimilarityBand()`
- [ ] Tie-break uses `compareCandidates()` or equivalent SQL
- [ ] No keyword lists for semantic meaning (structural only)

---

*Last updated: 2026-02-03*
