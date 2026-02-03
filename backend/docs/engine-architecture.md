# CV Enhancement Engine Architecture

This document describes the workflow and scoring logic for the two primary engines in the CV Evaluator system: the **CV Quality Engine** and the **Job Matching Engine**, and how they synergistically work together.

---

## 1. CV Quality Engine (Base Quality)

**Goal:** Evaluate the intrinsic quality of a CV, independent of any specific Job Description. It acts as a "Gatekeeper".

### Core Workflow
1. **Structural Analysis**: Checks for essential sections (Contact, Education, etc.), ATS-compatibility, and formatting consistency (single-column, no tables).
2. **Semantic Quality Check**: Uses embeddings to verify if the content meets "Best Practice" standards for a student/fresher level (e.g., "Do bullets use active verbs?", "is there project verifiability?").
3. **Rule Categories**:
    - **MUST_HAVE**: Critical blockers. If one is violated, the CV is marked `NOT_READY`.
    - **NICE_TO_HAVE**: Quality signals. Affect the overall score.
    - **BEST_PRACTICE**: Strong professional indicators.

### Scoring & Decision Logic
- **Decision**: 
    - `NOT_READY`: Any MUST_HAVE violation.
    - `NEEDS_IMPROVEMENT`: Too many failing NICE_TO_HAVE or BEST_PRACTICE rules.
    - `READY`: All MUST_HAVEs passed and majority of others passed.
- **Weighted Score**:
    - MUST_HAVE: 50%
    - NICE_TO_HAVE: 30%
    - BEST_PRACTICE: 20%

---

## 2. JD Matching Engine (Relevance Analysis)

**Goal:** Measure the semantic alignment between a specific CV and a particular Job Description.

### Core Workflow
1. **JD Rule Extraction**: Atomic requirements (Must-Have, Nice-to-Have, Best-Practice) are extracted and chunked from the JD text.
2. **Semantic Matching**: CV chunks are mapped to JD rule chunks using vector similarity (pgvector).
3. **Similarity Banding**:
    - **HIGH**: Strong match (`FULL`).
    - **AMBIGUOUS**: Relevant but under-expressed (`PARTIAL`).
    - **LOW**: Weak match (`NONE`).
4. **Section-Aware Upgrade**: A `PARTIAL` match can be upgraded to `FULL` if the evidence is found in "high-trust" sections like `PROJECTS` or `EXPERIENCE`.
5. **Human-in-the-Loop (Gemini Judge)**: Optional LLM validation specifically for `AMBIGUOUS` matches to prevent false positives.

### Scoring Logic
- **Weighted Match Rate**:
    - MUST_HAVE rules carry the highest weight.
    - Match Status: `FULL` (1.0), `PARTIAL` (0.5), `NONE` (0.0).
- **Match Level**:
    - `STRONG_MATCH`, `GOOD_MATCH`, `PARTIAL_MATCH`, or `LOW_MATCH`.

---

## 3. Synergy: How They Work Together

The two engines serve different but complementary purposes.

### The Relationship Model
| Scenario | CV Quality Score | JD Match Score | Result |
| :--- | :--- | :--- | :--- |
| **Perfect Match** | High (`READY`) | High (`STRONG`) | The ideal candidate. Ready to submit. |
| **Irrelevant Pro** | High (`READY`) | Low (`LOW`) | A great CV, but not for this job (e.g., Accountant applying for Coding). |
| **Diamond in the Rough**| Low (`NOT_READY`) | High (`STRONG`) | Has the right skills, but the CV is poorly presented. Needs structural fixing. |
| **Poor Fit** | Low (`NOT_READY`) | Low (`LOW`) | Doesn't have the skills and the CV is poor. Disqualification. |

### Integrated Workflow
1. **CV Quality First**: The system first validates the CV's structure and general quality. If the decision is `NOT_READY`, the user is prompted to fix baseline issues (e.g., "Add Contact Info") before worrying about JD alignment.
2. **JD Matching Second**: For a `READY` CV, the JD Matcher highlights **Gaps** specific to the role.
3. **Unified Suggestions**: The system combines findings from both:
    - **Quality Suggestion**: "Add active verbs to your bullets."
    - **Matching Suggestion**: "Expand your project section to emphasize Python usage mentioned in the JD."

---

## 4. Scoring Summary Table

| Metric | Weights | Purpose |
| :--- | :--- | :--- |
| **CV Quality Total** | 50% MH / 30% NH / 20% BP | Ensures the CV is professional and ATS-compliant. |
| **JD Match Score** | Weighted by JD Rule Type | Measures how well the CV "answering" the JD requirements. |
| **Final Recommendation**| Synergy of both | Provides a context-aware assessment for the user. |
