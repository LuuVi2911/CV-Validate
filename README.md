# CV Enhancer

A tool to evaluate CVs against Job Descriptions (JDs) using LLM-based judging and rule matching.

## Documentation

- **[Engine Documentation](ENGINE_DOCUMENTATION.md)**: Detailed explanation of the matching logic, scoring, and architecture.
- **[API Documentation](API_DOCUMENTATION.md)**: List of available API endpoints.

## Project Setup

The backend is a NestJS application.

1.  **Navigate to the backend directory:**

    ```bash
    cd backend
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    ```

3.  **Configure Environment:**
    Ensure you have a `.env` file in the `backend` directory with the necessary API keys (Gemini, etc.).

4.  **Run the application:**
    ```bash
    # Development mode
    npm run start:dev
    ```

## Use Case & Flow

The CV Enhancer is designed to help candidates tailor their CVs to specific Job Descriptions.

1.  **User Registration/Login**: Users authenticate to access the system.
2.  **Upload & Parse**: Users submit a CV (PDF/Text) and a Job Description.
3.  **Evaluation**:
    - The system parses the JD to extract key requirements (Must-haves, Nice-to-haves).
    - It compares the CV against these rules using semantic search and an LLM judge.
4.  **Results**: The user receives a detailed report with:
    - A readiness score.
    - Matched and missing skills.
    - Specific suggestions for improvement.

## Example Summary Output

Here is a brief example of the evaluation result:

```json
{
  "evaluationId": "41da3bf3-3aa5-46b2-9a8d-5905646ebc39",
  "cvQuality": {
    "decision": "READY",
    "scores": {
      "totalScore": 86,
      "mustHaveScore": 100
    },
    "failedFindings": [
      {
        "category": "NICE_TO_HAVE",
        "reason": "Consider adding an Activities section for volunteer work"
      }
    ]
  },
  "jdMatch": {
    "level": "STRONG_MATCH",
    "matches": [
      {
        "ruleContent": "Strong experience in TypeScript and NestJS",
        "matchStatus": "FULL",
        "confidence": "HIGH"
      }
    ]
  }
}
```
