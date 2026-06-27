---
name: sub_agents_workflow
description: Production sub agents for parallel review and optimization
metadata:
  type: feedback
---

## Sub Agents in Production

Used for continuous adjustments and corrections. All run in parallel after implementation.

### 1. **Tester Agent**
- **Role**: Verify functionality works as intended
- **Runs after**: Code changes, new features, bugfixes
- **Reports**: "Works ✓" or "Issue found: [details]"
- **Trigger**: Auto on every feature/fix

### 2. **Frontend Specialist Agent**
- **Role**: Review React components, CSS, UX, performance
- **Reviews**: Component structure, hooks usage, styling, responsiveness
- **Reports**: Improvements, refactoring suggestions, accessibility issues
- **Trigger**: After React component changes

### 3. **Backend Specialist Agent**
- **Role**: Review Node.js/Express APIs, queries, performance
- **Reviews**: Route handlers, middleware, database queries, error handling
- **Reports**: Performance optimizations, security issues, best practices
- **Trigger**: After API/route changes

### 4. **Code Quality Reviewer Agent**
- **Role**: Enforce standards, refactoring, debt
- **Reviews**: Code style, naming, architecture, duplication
- **Reports**: Refactoring candidates, debt items, pattern violations
- **Trigger**: After any code change

### 5. **Security Auditor Agent**
- **Role**: Validate security posture
- **Reviews**: Input validation, SQL injection, XSS, auth/authz
- **Reports**: Vulnerabilities, OWASP violations, risk assessment
- **Trigger**: After sensitive changes (auth, data handling, APIs)

### 6. **Performance Optimizer Agent**
- **Role**: Identify bottlenecks and optimization opportunities
- **Reviews**: Frontend metrics, API response times, database queries
- **Reports**: Slow endpoints, heavy components, query optimization
- **Trigger**: On performance-critical changes

---

## Workflow

**DEFAULT: Use NO sub agents unless necessary.**

Only spawn agents when:
- ❌ Deletion or high-risk change flagged by validator
- ❌ Complex multi-perspective analysis needed
- ❌ Parallel work genuinely saves time
- ❌ User explicitly requests "get a second opinion"

**Why:** Save tokens, faster delivery, simpler workflow.

**Me approach:**
1. Implement directly
2. Quick self-test
3. Report done
4. User can request agent review if needed

This is the **fast path**. Use agents only when slow path adds value.
