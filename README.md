# CV Enhancer

A tool to evaluate CVs against Job Descriptions (JDs) using LLM-based judging and rule matching.

## Documentation

- **[Engine Documentation](ENGINE_DOCUMENTATION.md)**: Detailed explanation of the matching logic, scoring, and architecture.
- **[API Documentation](API_DOCUMENTATION.md)**: List of available API endpoints.

## Project Setup

The backend is a NestJS application.
1.  **Navigate to the infra directory and run the database:**
   
       ```bash
    cd infra
    docker compose up -d
    ```

2.  **Navigate to the backend directory:**

    ```bash
    cd backend
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    ```

3.  **Configure Environment:**
    Ensure you have a `.env` file in the `backend` directory with the necessary API keys (Gemini, etc.).
    You can check the varriable in `.env.example in` in `backend`

4.  **Run the application:**
    ```bash
    # Development mode
    npm run start:dev
    ```

## Use Case & Flow

The CV Enhancer is designed to help candidates tailor their CVs to specific Job Descriptions.

1.  **User Registration/Login**: Users authenticate to access the system.
2.  **Upload & Parse**: Users submit a CV (PDF) and a Job Description (Text).
3.  **Evaluation**:
    - The system parse the CV into each section
    - It compares the CV against the CV rules (Structure and Content). If pass the JD matching is enable
    - The system parses the JD to extract key requirements (Must-haves, Nice-to-haves and Best-practice).
    - The systems compare the CV with these requirement rules and give the evaluation
5.  **Results**: The user receives a detailed report with:
    - What rule that the CV didn't follow and the reason
    - The Score for the CV
    - JD rule extracted from JD and their type with the status of the CV (satified: boolean)
    - Gap detection what the CV miss in this JD rules
    - Suggestion for enhance the CV to get more point of this engine

## Example Summary Output

Here is a brief example of the evaluation result:

```json
{
    "evaluationId": "e0baea21-4319-41b1-95e5-0bd04e383a08",
    "cvId": "93b539ca-e77a-46c0-bf72-6c4aa435f77e",
    "jdId": "7df84a89-444e-4a90-8819-d6f5013368d4",
    "cvQuality": {
        "failedFindings": [
            {
                "category": "NICE_TO_HAVE",
                "reason": "Consider adding an Activities section for volunteer or extracurricular work"
            },
            {
                "category": "NICE_TO_HAVE",
                "reason": "No sufficient semantic evidence (best n/a, NO_EVIDENCE)"
            },
            {
                "category": "BEST_PRACTICE",
                "reason": "Work experience would strengthen your CV"
            },
            {
                "category": "BEST_PRACTICE",
                "reason": "Consider adding measurable results (e.g., \"improved performance by 30%\")"
            }
        ]
    },
    "jdMatch": {
        "matches": [
            {
                "ruleType": "MUST_HAVE",
                "ruleContent": "Experience with backend programming languages including TypeScript, Python, and Go.",
                "judgeReason": "The CV mentions 'Google OAuth' which refers to a service, not the 'Go' programming language. There is no indication of Go language experience.",
                "score": 1,
                "weightedScore": 1,
                "satisfied": true,
                "confidence": "HIGH"
            },
            {
                "ruleType": "BEST_PRACTICE",
                "ruleContent": "Desire to grow in a collaborative engineering team.",
                "judgeReason": "Expected graduation implies ongoing education and personal development, which is a form of growth, but not directly stated professional growth.",
                "score": 1,
                "weightedScore": 0.25,
                "satisfied": true,
                "confidence": "MEDIUM"
            },
            {
                "ruleType": "MUST_HAVE",
                "ruleContent": "Experience building and maintaining scalable backend services.",
                "judgeReason": "CV content explicitly mentions \"Improved API performance\" using optimization techniques, which is a direct form of service maintenance.",
                "score": 1,
                "weightedScore": 1,
                "satisfied": true,
                "confidence": "HIGH"
            },
            {
                "ruleType": "MUST_HAVE",
                "ruleContent": "Ability to debug backend systems in a production-like environment.",
                "judgeReason": "The CV content only states an expected graduation date, which has no relation to the technical skill of debugging.",
                "score": 1,
                "weightedScore": 1,
                "satisfied": true,
                "confidence": "HIGH"
            },
            {
                "ruleType": "MUST_HAVE",
                "ruleContent": "Experience working with MongoDB databases.",
                "judgeReason": "The CV explicitly lists 'MongoDB' under the 'Tools' section, directly matching the JD requirement.",
                "score": 1,
                "weightedScore": 1,
                "satisfied": true,
                "confidence": "HIGH"
            },
            {
                "ruleType": "MUST_HAVE",
                "ruleContent": "Proficiency in using Git for version control.",
                "judgeReason": "GitHub Actions CI/CD inherently relies on Git for version control and repository management, strongly implying Git usage.",
                "score": 1,
                "weightedScore": 1,
                "satisfied": true,
                "confidence": "HIGH"
            },
            {
                "ruleType": "MUST_HAVE",
                "ruleContent": "Experience writing automated tests for backend systems.",
                "judgeReason": "The CV content provides contact information and links, but does not mention 'testing' or any related skills/experience.",
                "score": 0,
                "weightedScore": 0,
                "satisfied": false,
                "confidence": "HIGH"
            },
            {
                "ruleType": "BEST_PRACTICE",
                "ruleContent": "Ability to collaborate effectively with a team.",
                "judgeReason": "The CV explicitly states \"collaborating in a 3-person team,\" directly demonstrating the collaboration requirement.",
                "score": 1,
                "weightedScore": 0.25,
                "satisfied": true,
                "confidence": "HIGH"
            },
            {
                "ruleType": "BEST_PRACTICE",
                "ruleContent": "Strong problem-solving skills are essential for designing reliable and maintainable backend architectures.",
                "judgeReason": "Delivering an MVP under tight hackathon constraints strongly implies identifying and solving problems to achieve the goal.",
                "score": 1,
                "weightedScore": 0.25,
                "satisfied": true,
                "confidence": "HIGH"
            },
            {
                "ruleType": "MUST_HAVE",
                "ruleContent": "Experience integrating messaging systems like Kafka for asynchronous and event-driven workflows.",
                "judgeReason": "The CV explicitly mentions \"asynchronous payment processing\" and describes a workflow with related elements.",
                "score": 1,
                "weightedScore": 1,
                "satisfied": true,
                "confidence": "HIGH"
            },
            {
                "ruleType": "MUST_HAVE",
                "ruleContent": "Experience in designing and implementing RESTful APIs.",
                "judgeReason": "Improving API performance, caching, and query optimization strongly implies prior API implementation and deep understanding.",
                "score": 1,
                "weightedScore": 1,
                "satisfied": true,
                "confidence": "HIGH"
            },
            {
                "ruleType": "BEST_PRACTICE",
                "ruleContent": "Eagerness to learn and contribute to real backend APIs.",
                "judgeReason": "Ongoing education towards a degree directly demonstrates engagement in and commitment to learning.",
                "score": 1,
                "weightedScore": 0.25,
                "satisfied": true,
                "confidence": "HIGH"
            }
        ],
        "scores": {
            "totalScore": 93.75,
            "mustHaveScore": 87.5,
            "niceToHaveScore": 100,
            "bestPracticeScore": 100
        },
        "level": "GOOD_MATCH",
        "gaps": [
            {
                "ruleChunkContent": "testing",
                "ruleType": "MUST_HAVE",
                "reason": "Best match score (0.57) in AMBIGUOUS band - severity: PARTIAL_MATCH_ADVISORY"
            }
        ],
        "suggestions": [
            {
                "severity": "MAJOR_GAP",
                "type": "MISSING",
                "message": "Consider adding content that shows: experience, writing, automated, tests, backend",
                "evidenceSnippet": "Enabled auditors to perform compliance checks at low cost (~30k–50k tokens per document) instead of ",
                "suggestedActionType": "ADD_BULLET",
                "conceptLabel": "experience, writing, automated, tests, backend",
                "sectionType": "PROJECTS"
            }
        ]
    },
    "decisionSupport": {
        "explanation": {
            "majorGaps": 0,
            "improvementAreas": 0,
            "criticalMustHaveGaps": 0
        },
        "readinessScore": 100,
        "recommendation": "READY_TO_APPLY"
    }
}
```
