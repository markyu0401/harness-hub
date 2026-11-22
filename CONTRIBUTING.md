# Contributing to HarnessHub

Thanks for your interest in contributing to **HarnessHub**!

## Development Workflow

1. Fork the repository and create a branch from `main` using a descriptive name:
   - `feat/<short-name>` for new features or harness adapters
   - `fix/<short-name>` for bug fixes
   - `docs/<short-name>` for documentation updates
2. Follow **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`).
3. Keep PRs focused and small. Link the relevant GitHub Issue in the PR description.
4. Ensure all tests, typechecks, and linters pass before requesting review.

## Adding a New Harness Adapter

Each harness adapter lives under `packages/core/src/adapters/<harness>.ts` and must:
- Implement `HarnessAdapter` (`detect`, `readCurrentState`, `planSync`, `applySync`, `verifyLive`).
- Never delete or overwrite unmanaged user files or harness-builtin skills.
- Always create a timestamped backup before modifying any configuration file.
- Include unit tests using temporary sandbox directories (never touch real `~/` paths in tests).

## Reporting Bugs & Requesting Features

Use the GitHub Issue templates under `.github/ISSUE_TEMPLATE/` and include your OS, Node/Python versions, and target harness versions when reporting bugs.
