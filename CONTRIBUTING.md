# Contributing

Thanks for looking at ForgeSense. This document is short because the project
is small and the rules are few.

## Ground rules

1. **Documentation must match the code.** If a document and the source
   disagree, the source is correct and the document is the defect. Every claim
   needs implementation evidence.
2. **Do not overstate.** This system runs on synthetic telemetry and does not
   connect to plant equipment. A change that makes it sound more capable than
   it is will be rejected even if the code works.
3. **No fabricated metrics.** A number shown to an operator must be computed
   from real data or deterministic seeded data, and must be labelled with its
   basis. A message count is not throughput; a modelled figure is not a
   measurement.
4. **Prefer a labelled degradation to a silent substitution.** If the ML
   service is unavailable, say so on screen rather than quietly substituting a
   different number.

## Getting set up

```bash
# Backend (dev profile: embedded H2, in-process event bus, no external services)
cd backend && ./mvnw spring-boot:run

# ML service (optional; the backend falls back to heuristics without it)
cd ml-service && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app.main:app --port 8001

# Console
cd frontend && npm ci && npm run dev
```

## Before you open a pull request

```bash
cd frontend
npm run verify        # doc links, artifact gate, typecheck, unit tests, build
npm run e2e           # Playwright, requires backend + ML running

cd ../backend && ./mvnw test
cd ../ml-service && python -m pytest tests -q
```

`npm run verify` is the same gate CI runs, so running it locally avoids a
failed build.

## What a good change looks like

- Fixes a real defect, with a regression test that fails without the fix.
- Keeps the synthetic-data boundary intact. Nothing in this repository may
  imply a connection to real machinery.
- Keeps loading, empty and error states distinct. A failed request must never
  render as "no data".
- Updates the documentation in the same change if it altered observable
  behaviour.

## Reporting security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your work is licensed under the
[MIT License](LICENSE).