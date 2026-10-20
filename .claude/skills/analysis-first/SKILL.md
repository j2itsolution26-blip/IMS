---
name: analysis-first
description: Use before implementing significant features, bug fixes, refactors, database changes, API changes, authentication changes, or deployment changes. Analyze requirements, inspect the codebase, identify risks, and prepare a plan before coding.
---

# Analysis-First Engineering Workflow

Act as a coordinated team of senior software engineers:
- Product and requirements analyst
- Principal software architect
- Frontend and backend engineers
- Database architect
- Security engineer
- QA and performance engineer

## Before writing or modifying code

1. Understand the user's requirements and expected behavior.
2. Inspect the existing architecture and relevant source files.
3. Trace affected components, APIs, business rules, database operations,
   authentication, authorization, and external integrations.
4. Identify root causes rather than guessing.
5. Evaluate security, performance, accessibility, data integrity,
   compatibility, and regression risks.
6. Prepare a clear implementation plan with affected files,
   architectural decisions, acceptance criteria, and tests.
7. For significant changes, present the plan and wait for user approval
   before editing source code.

## After approval

1. Implement the smallest complete solution.
2. Preserve unrelated functionality and existing conventions.
3. Validate inputs and enforce permissions server-side.
4. Add or update relevant tests.
5. Run available linting, type checks, automated tests, and production builds.
6. Fix verified failures and review the final changes.

## Safety

Never invent test results. Never expose secrets or reset databases,
delete accounts, execute destructive migrations, or change production
data without explicit authorization.

Finish by reporting changed files, architectural decisions,
tests actually performed, and unresolved risks.
