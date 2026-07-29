# Graph Report - resurank  (2026-07-29)

## Corpus Check
- 135 files · ~182,718 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1235 nodes · 1903 edges · 76 communities (61 shown, 15 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1165dd1a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Embedding & Matcher Services|Embedding & Matcher Services]]
- [[_COMMUNITY_API Service (IPC Bridge)|API Service (IPC Bridge)]]
- [[_COMMUNITY_Electron Root Package|Electron Root Package]]
- [[_COMMUNITY_Frontend Package Deps|Frontend Package Deps]]
- [[_COMMUNITY_MCP Server Package|MCP Server Package]]
- [[_COMMUNITY_MCP Integration & Skill Domains|MCP Integration & Skill Domains]]
- [[_COMMUNITY_Angular Build Targets|Angular Build Targets]]
- [[_COMMUNITY_Angular Workspace Config|Angular Workspace Config]]
- [[_COMMUNITY_Claude Desktop Config (Main)|Claude Desktop Config (Main)]]
- [[_COMMUNITY_Settings Drawer Component|Settings Drawer Component]]
- [[_COMMUNITY_Frontend UI Layout|Frontend UI Layout]]
- [[_COMMUNITY_MCP Resume Resolver|MCP Resume Resolver]]
- [[_COMMUNITY_Scoring Model & Design Decisions|Scoring Model & Design Decisions]]
- [[_COMMUNITY_App Root Component Logic|App Root Component Logic]]
- [[_COMMUNITY_Scoring tsconfig|Scoring tsconfig]]
- [[_COMMUNITY_MCP tsconfig|MCP tsconfig]]
- [[_COMMUNITY_Scoring Package Manifest|Scoring Package Manifest]]
- [[_COMMUNITY_Electron Main tsconfig|Electron Main tsconfig]]
- [[_COMMUNITY_Storage Service (JSON Files)|Storage Service (JSON Files)]]
- [[_COMMUNITY_Claude Desktop Card (Frontend)|Claude Desktop Card (Frontend)]]
- [[_COMMUNITY_Scoring Package Exports|Scoring Package Exports]]
- [[_COMMUNITY_Scoring npm Scripts|Scoring npm Scripts]]
- [[_COMMUNITY_MCP Test tsconfig|MCP Test tsconfig]]
- [[_COMMUNITY_Scoring Test tsconfig|Scoring Test tsconfig]]
- [[_COMMUNITY_Preload tsconfig|Preload tsconfig]]
- [[_COMMUNITY_Install Shell Script|Install Shell Script]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_App Icon Branding|App Icon Branding]]
- [[_COMMUNITY_MCP devDependencies|MCP devDependencies]]
- [[_COMMUNITY_Repository Metadata|Repository Metadata]]
- [[_COMMUNITY_Worker Export Map|Worker Export Map]]
- [[_COMMUNITY_Peer Dependency Meta|Peer Dependency Meta]]
- [[_COMMUNITY_Shared Config (JS)|Shared Config (JS)]]
- [[_COMMUNITY_Frontend App Identity|Frontend App Identity]]
- [[_COMMUNITY_Transformers Peer Dep|Transformers Peer Dep]]
- [[_COMMUNITY_Shared Config (TS)|Shared Config (TS)]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]

## God Nodes (most connected - your core abstractions)
1. `SettingsDrawerComponent` - 29 edges
2. `AppComponent` - 21 edges
3. `AuthService` - 21 edges
4. `MissingKeywordSettings` - 20 edges
5. `PreferenceMismatchSettings` - 20 edges
6. `HttpStorageAdapter` - 19 edges
7. `ResuRank` - 17 edges
8. `ApiService` - 16 edges
9. `ElectronStorageAdapter` - 16 edges
10. `EmbeddingService` - 16 edges

## Surprising Connections (you probably didn't know these)
- `Java / Spring Boot Skills` --semantically_similar_to--> `TypeScript / Node.js Skills`  [INFERRED] [semantically similar]
  resources/test_files/senior_software_engineer.txt → packages/scoring/test/fixtures/resume.txt
- `Auto-Update Config (electron-updater)` --references--> `ResuRank`  [INFERRED]
  app-update.yml → README.md
- `Senior Software Engineer Backend Platform JD` --conceptually_related_to--> `Preference Mismatch Penalty`  [INFERRED]
  resources/test_files/senior_software_engineer.txt → packages/scoring/README.md
- `HealthResponse` --references--> `ModelStatus`  [EXTRACTED]
  apps/ui/src/app/shared/api.service.ts → packages/scoring/src/worker-embedder.ts
- `ResuRank Product Description` --conceptually_related_to--> `ResuRank`  [INFERRED]
  description.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Hybrid Scoring Components** — description_semantic_similarity, description_keyword_similarity_tfidf, description_divergence_adjustment, description_critical_missing_keywords, description_preference_mismatch [EXTRACTED 0.90]
- **CI Release Pipeline** — workflows_release_release_job, workflows_release_macos_codesign_notarize, workflows_release_windows_prestage, workflows_release_publish_github_releases [EXTRACTED 0.90]
- **Score Composition & Penalty Pipeline** — score_info_modal_embedding_score, score_info_modal_tfidf_score, score_info_modal_divergence_adjustment, score_info_modal_critical_missing_keywords, score_info_modal_preference_mismatch [EXTRACTED 0.90]
- **Modal Shell Reused Across Info Modals** — modal_shell_modal_shell, score_info_modal_score_info_modal, keyword_info_modal_keyword_info_modal, settings_info_modal_settings_info_modal, stopwords_modal_stopwords_modal [EXTRACTED 0.90]
- **Hybrid Scoring Pipeline** — scoring_semantic_embedding, scoring_tfidf_score, scoring_divergence_penalty, scoring_hybrid_scoring_model [EXTRACTED 1.00]
- **Shared Scoring Engine Consumers** — scoring_resurank_scoring_pkg, mcp_server_resurank_mcp, scoring_score_resume_against_job [EXTRACTED 1.00]
- **Job Description Test Corpus** — test_files_english_java_angular, test_files_foreign_language, test_files_registered_nurse, test_files_senior_software_engineer [INFERRED 0.85]

## Communities (76 total, 15 thin omitted)

### Community 0 - "Embedding & Matcher Services"
Cohesion: 0.15
Nodes (17): embedder, buildTfIdf(), computeMissingKeywordPenalty(), computePreferenceMismatchPenalty(), detectNonEnglish(), dotProduct(), normalizeBoosts(), normSq() (+9 more)

### Community 1 - "API Service (IPC Bridge)"
Cohesion: 0.08
Nodes (13): errorMessage(), HistoryComponent, SortMode, HistoryDetailModalComponent, errorMessage(), ResumesComponent, scoreTier, ApiHistoryEntry (+5 more)

### Community 2 - "Electron Root Package"
Cohesion: 0.04
Nodes (48): author, config, forge, dependencies, dotenv, electron-squirrel-startup, electron-updater, rxjs (+40 more)

### Community 3 - "Frontend Package Deps"
Cohesion: 0.04
Nodes (46): dependencies, @angular/animations, @angular/common, @angular/compiler, @angular/core, @angular/forms, @angular/platform-browser, @angular/platform-browser-dynamic (+38 more)

### Community 4 - "MCP Server Package"
Cohesion: 0.05
Nodes (39): author, bin, resurank-mcp, bugs, url, dependencies, @huggingface/transformers, mammoth (+31 more)

### Community 5 - "MCP Integration & Skill Domains"
Cohesion: 0.16
Nodes (13): Claude Desktop, Model Context Protocol, RESUME_PATH Env Var, resurank-mcp MCP Server, resurank_score MCP Tool, score-resume Prompt, createTransformersEmbedder(), Embedder Interface (+5 more)

### Community 6 - "Angular Build Targets"
Cohesion: 0.06
Nodes (42): build, extract-i18n, serve, test, builder, configurations, defaultConfiguration, options (+34 more)

### Community 7 - "Angular Workspace Config"
Cohesion: 0.07
Nodes (29): cli, analytics, packageManager, prefix, projectType, root, schematics, sourceRoot (+21 more)

### Community 8 - "Claude Desktop Config (Main)"
Cohesion: 0.12
Nodes (26): ClaudeConfig, ClaudeDesktopStatus, connect(), ConnectOptions, ConnectResult, disconnect(), getConfigPath(), getMcpEntry() (+18 more)

### Community 10 - "Frontend UI Layout"
Cohesion: 0.12
Nodes (26): Keyword Breakdown Mode (weighted / counts), Job Description Input Panel, Job Description Keywords Panel, Matched / Missing Terms Section, App Root Component, Score Ring & Breakdown, App Toolbar (brand, theme toggle, settings), Claude Desktop Card Component (+18 more)

### Community 11 - "MCP Resume Resolver"
Cohesion: 0.13
Nodes (13): FileCacheEntry, loadResumeFile(), ResolvedResume, resolveResume(), resumePath, ResumeSource, server, validateResumeText() (+5 more)

### Community 12 - "Scoring Model & Design Decisions"
Cohesion: 0.06
Nodes (30): Auto-Update Config (electron-updater), Critical Missing Keywords Penalty, Divergence Adjustment, Keyword Similarity (TF-IDF), Preference Mismatch Penalty, ResuRank Product Description, Security Posture (Fuses, CSP, Isolation), Semantic Similarity (Vector Embeddings) (+22 more)

### Community 13 - "App Root Component Logic"
Cohesion: 0.16
Nodes (15): main(), assertDatabaseReachable(), closeDatabase(), Database, db, pool, migrationsFolder, registerAuthDecorators() (+7 more)

### Community 14 - "Scoring tsconfig"
Cohesion: 0.11
Nodes (17): compilerOptions, declaration, declarationMap, esModuleInterop, isolatedModules, lib, module, moduleResolution (+9 more)

### Community 15 - "MCP tsconfig"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, esModuleInterop, isolatedModules, lib, module, moduleResolution, outDir (+8 more)

### Community 16 - "Scoring Package Manifest"
Cohesion: 0.13
Nodes (14): author, bugs, url, description, engines, node, files, homepage (+6 more)

### Community 17 - "Electron Main tsconfig"
Cohesion: 0.13
Nodes (14): compilerOptions, allowSyntheticDefaultImports, declaration, esModuleInterop, module, moduleResolution, outDir, resolveJsonModule (+6 more)

### Community 18 - "Storage Service (JSON Files)"
Cohesion: 0.20
Nodes (5): post(), Res, RESULT, saveScore(), upload()

### Community 19 - "Claude Desktop Card (Frontend)"
Cohesion: 0.14
Nodes (16): MatcherService, extractPageText(), ResumeParserService, NodeEmbedder, NodeEmbedderOptions, DEFAULT_MISSING_KEYWORD_SETTINGS, DEFAULT_PREFERENCE_MISMATCH_SETTINGS, Embedder (+8 more)

### Community 20 - "Scoring Package Exports"
Cohesion: 0.17
Nodes (12): default, types, default, exports, ./constants, ./node-embedder, ./worker-embedder, default (+4 more)

### Community 21 - "Scoring npm Scripts"
Cohesion: 0.22
Nodes (9): scripts, build, build:test, clean, prepublishOnly, test, version:major, version:minor (+1 more)

### Community 22 - "MCP Test tsconfig"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, outDir, rootDir, sourceMap, extends, include

### Community 23 - "Scoring Test tsconfig"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, declarationMap, outDir, rootDir, extends, include

### Community 25 - "Install Shell Script"
Cohesion: 0.52
Nodes (6): blank(), bold(), die(), info(), warn(), install.sh script

### Community 26 - "Community 26"
Cohesion: 0.12
Nodes (15): Context: Semantic search over saved jobs and resumes, Current database schema (`apps/web/src/db/schema.ts`), Exact embedding inputs (critical — any cache/index key must match these), Infrastructure blockers found, Key files, `MatchResult` shape (`packages/scoring/src/types.ts:44`), One correction to make if this ships, Open design questions (+7 more)

### Community 27 - "App Icon Branding"
Cohesion: 0.50
Nodes (4): ResuRank App Icon, Purple-Violet Gradient Design, Rounded Squircle App-Icon Form, RR Monogram

### Community 28 - "MCP devDependencies"
Cohesion: 0.50
Nodes (4): devDependencies, @huggingface/transformers, @types/node, typescript

### Community 29 - "Repository Metadata"
Cohesion: 0.50
Nodes (4): repository, directory, type, url

### Community 30 - "Worker Export Map"
Cohesion: 0.67
Nodes (3): ./worker, default, types

### Community 31 - "Peer Dependency Meta"
Cohesion: 0.67
Nodes (3): optional, peerDependenciesMeta, @huggingface/transformers

### Community 34 - "Transformers Peer Dep"
Cohesion: 0.05
Nodes (40): author, dependencies, argon2, drizzle-orm, fastify, @fastify/cookie, @fastify/helmet, @fastify/rate-limit (+32 more)

### Community 35 - "Shared Config (TS)"
Cohesion: 0.25
Nodes (7): compilerOptions, module, moduleResolution, outDir, rootDir, extends, include

### Community 37 - "Community 37"
Cohesion: 0.09
Nodes (21): Architecture, Changes, Confirmed decisions, Context, Database schema (Drizzle migrations), Deployment, Findings from the current UI, Frontend folder structure (+13 more)

### Community 38 - "Community 38"
Cohesion: 0.11
Nodes (18): Architecture Notes, Branch Policy, Build everything, Create installers, Dependency resolution, Dev mode (hot reload), Development Workflows, First-time setup (+10 more)

### Community 39 - "Community 39"
Cohesion: 0.12
Nodes (17): After publishing a new scoring version, API, `Embedder` interface, How scoring works, Language detection, License, Publishing a new version, @resurank/scoring (+9 more)

### Community 40 - "Community 40"
Cohesion: 0.12
Nodes (16): Configuration, Distribution, How the score works, License, Limitations, Local registration (during development), One-command install (macOS / Linux), Prerequisites (+8 more)

### Community 41 - "Community 41"
Cohesion: 0.12
Nodes (15): Context, Critical files, Decisions taken (these close doc questions 2, 3, 4, 5, and half of 7), Find similar saved jobs — semantic search over `score_history` (pgvector / pg18), Phase A — `packages/scoring`: export the embedding-input builders, Phase B — infra, Phase C — schema + migration, Phase D — server route (+7 more)

### Community 42 - "Community 42"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, esModuleInterop, isolatedModules, lib, module, moduleResolution, outDir (+8 more)

### Community 43 - "Community 43"
Cohesion: 0.11
Nodes (18): appConfig, KeywordInfoModalComponent, KeywordInfoMode, ModalShellComponent, ScoreInfoModalComponent, BoostRow, SettingsInfoModalComponent, SettingsInfoMode (+10 more)

### Community 44 - "Community 44"
Cohesion: 0.25
Nodes (7): Build, Code scaffolding, Development server, Frontend, Further help, Running end-to-end tests, Running unit tests

### Community 45 - "Community 45"
Cohesion: 0.33
Nodes (5): **Feature list (supplementary bullets)**, **Long description (website / landing page)**, **Short description (app store listing, ~80 words)**, **Tagline (one line, hero text)**, **Under the hood (technical readers / developer audience)**

### Community 46 - "Community 46"
Cohesion: 0.33
Nodes (12): getTransporter(), layout(), Mail, send(), sendAccountExistsEmail(), sendEmailChangedNotice(), sendEmailChangeEmail(), sendInBackground() (+4 more)

### Community 47 - "Community 47"
Cohesion: 0.14
Nodes (13): 1. Start Postgres + Mailpit, 2. Configure environment, 3. Apply the database schema, 4. Run the server, 5. Run the tests, Building & running for production, Docker, Environment variables (+5 more)

### Community 48 - "Community 48"
Cohesion: 0.14
Nodes (24): EmailToken, emailTokens, EmailTokenType, emailTokenTypes, NewUser, Resume, resumes, ScoreHistoryEntry (+16 more)

### Community 49 - "Community 49"
Cohesion: 0.21
Nodes (19): sessions, linkPath(), login(), register(), registerAndVerify(), sessionCookie(), signedInUser(), uniqueEmail() (+11 more)

### Community 50 - "Community 50"
Cohesion: 0.12
Nodes (24): scoreHistory, ApiHistoryEntry, ApiHistorySummary, ErrorCode, sendError(), sendValidationError(), DomainRoutesOptions, writeLimit() (+16 more)

### Community 52 - "Community 52"
Cohesion: 0.14
Nodes (14): ClaudeDesktopConnectResult, ClaudeDesktopStatus, Window, Window, DEFAULT_MISSING_KEYWORD_SETTINGS, DEFAULT_PREFERENCE_MISMATCH_SETTINGS, HistoryEntryInput, MissingKeywordSettings (+6 more)

### Community 54 - "Community 54"
Cohesion: 0.18
Nodes (10): 1. What you need before starting, 2. Build the image, 3. Run migrations, 4. Environment variables, 5. TLS and headers, 6. Post-deploy verification checklist, 7. Rollback, Corrections / open items (kept current — Phase 10) (+2 more)

### Community 56 - "Community 56"
Cohesion: 0.47
Nodes (4): _config, embed(), getEmbedder(), triggerEagerLoad()

### Community 57 - "Community 57"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, sourceMap, extends, include

### Community 58 - "Community 58"
Cohesion: 0.36
Nodes (9): Angular Frontend Skills, Backend Engineering Domain, Java / Spring Boot Skills, TypeScript / Node.js Skills, MCP Jane Doe Resume Fixture, Senior Backend Engineer JD Fixture, Jane Doe Backend Resume Fixture, Senior Software Engineer (Angular) JD (+1 more)

### Community 59 - "Community 59"
Cohesion: 0.22
Nodes (9): Nursing / Legal Nurse Domain, Critical Missing Keyword Penalty, Divergence Adjustment, Hybrid 60% Semantic + 40% TF-IDF Model, Language Detection Warning, Preference Mismatch Penalty, TF-IDF Keyword Score, Polish Senior Java Engineer JD (+1 more)

### Community 62 - "Community 62"
Cohesion: 0.40
Nodes (3): FILES, here, outDir

### Community 65 - "Community 65"
Cohesion: 0.09
Nodes (34): User, users, generateToken(), getDummyHash(), hashPassword(), hashToken(), verifyPassword(), createSession() (+26 more)

### Community 67 - "Community 67"
Cohesion: 0.16
Nodes (8): PrivacyComponent, TermsComponent, RegisterComponent, SignInComponent, VerifyEmailComponent, authGuard(), ApiErrorBody, PublicUser

### Community 68 - "Community 68"
Cohesion: 0.14
Nodes (9): HealthResponse, EmbeddingService, MODEL_CACHE_DIR, ModelHostConfig, createWorkerEmbedder(), ModelStatus, WorkerEmbedder, WorkerEmbedderOptions (+1 more)

### Community 71 - "Community 71"
Cohesion: 0.67
Nodes (3): Option 1 — npx (no app required), Option 2 — ResuRank desktop app (automatic), Setup

### Community 72 - "Community 72"
Cohesion: 0.22
Nodes (6): MODEL_HOST, RESUME_PICKER_PANEL, appConfig, AppShellComponent, authInterceptor(), webRoutes

## Knowledge Gaps
- **543 isolated node(s):** `BreakdownMode`, `$schema`, `version`, `packageManager`, `analytics` (+538 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `embedder` connect `Embedding & Matcher Services` to `Claude Desktop Card (Frontend)`, `MCP Resume Resolver`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `require` connect `Claude Desktop Config (Main)` to `MCP Resume Resolver`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **What connects `BreakdownMode`, `$schema`, `version` to the rest of the system?**
  _546 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `API Service (IPC Bridge)` be split into smaller, more focused modules?**
  _Cohesion score 0.07862679955703211 - nodes in this community are weakly interconnected._
- **Should `Electron Root Package` be split into smaller, more focused modules?**
  _Cohesion score 0.04081632653061224 - nodes in this community are weakly interconnected._
- **Should `Frontend Package Deps` be split into smaller, more focused modules?**
  _Cohesion score 0.0425531914893617 - nodes in this community are weakly interconnected._
- **Should `MCP Server Package` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._