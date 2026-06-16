# Graph Report - .  (2026-06-16)

## Corpus Check
- 100 files · ~140,761 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 668 nodes · 903 edges · 37 communities (30 shown, 7 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.82)
- Token cost: 154,693 input · 0 output

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
- [[_COMMUNITY_Embedding Web Worker|Embedding Web Worker]]
- [[_COMMUNITY_App Icon Branding|App Icon Branding]]
- [[_COMMUNITY_MCP devDependencies|MCP devDependencies]]
- [[_COMMUNITY_Repository Metadata|Repository Metadata]]
- [[_COMMUNITY_Worker Export Map|Worker Export Map]]
- [[_COMMUNITY_Peer Dependency Meta|Peer Dependency Meta]]
- [[_COMMUNITY_Shared Config (JS)|Shared Config (JS)]]
- [[_COMMUNITY_Frontend App Identity|Frontend App Identity]]
- [[_COMMUNITY_Transformers Peer Dep|Transformers Peer Dep]]
- [[_COMMUNITY_Shared Config (TS)|Shared Config (TS)]]

## God Nodes (most connected - your core abstractions)
1. `SettingsDrawerComponent` - 29 edges
2. `AppComponent` - 20 edges
3. `StorageService` - 17 edges
4. `EmbeddingService` - 16 edges
5. `compilerOptions` - 16 edges
6. `ApiService` - 15 edges
7. `compilerOptions` - 15 edges
8. `scoreResumeAgainstJob()` - 15 edges
9. `compilerOptions` - 14 edges
10. `MissingKeywordSettings` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Keyword Similarity (TF-IDF)` --semantically_similar_to--> `Hybrid Semantic + TF-IDF Scoring Model`  [INFERRED] [semantically similar]
  description.md → README.md
- `Java / Spring Boot Skills` --semantically_similar_to--> `TypeScript / Node.js Skills`  [INFERRED] [semantically similar]
  resources/test_files/senior_software_engineer.txt → packages/scoring/test/fixtures/resume.txt
- `writeConfigAtomic()` --calls--> `require`  [INFERRED]
  src/main/claude-desktop.ts → packages/mcp-server/src/resume-loader.ts
- `Auto-Update Config (electron-updater)` --references--> `ResuRank Application`  [INFERRED]
  app-update.yml → README.md
- `HealthResponse` --references--> `ModelStatus`  [EXTRACTED]
  frontend/src/app/api.service.ts → packages/scoring/src/worker-embedder.ts

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

## Communities (37 total, 7 thin omitted)

### Community 0 - "Embedding & Matcher Services"
Cohesion: 0.06
Nodes (40): HealthResponse, EmbeddingService, MatcherService, extractPageText(), ResumeParserService, PIN_IMPORTANCE_MULTIPLIERS, embedder, NodeEmbedder (+32 more)

### Community 1 - "API Service (IPC Bridge)"
Cohesion: 0.07
Nodes (21): ApiService, ResumeInfo, BreakdownMode, DEFAULT_MISSING_KEYWORD_SETTINGS, DEFAULT_PREFERENCE_MISMATCH_SETTINGS, MissingKeywordSettings, PreferenceMismatchSettings, ResumeData (+13 more)

### Community 2 - "Electron Root Package"
Cohesion: 0.04
Nodes (44): author, config, forge, dependencies, dotenv, electron-squirrel-startup, electron-updater, rxjs (+36 more)

### Community 3 - "Frontend Package Deps"
Cohesion: 0.05
Nodes (39): dependencies, @angular/animations, @angular/common, @angular/compiler, @angular/core, @angular/forms, @angular/platform-browser, @angular/platform-browser-dynamic (+31 more)

### Community 4 - "MCP Server Package"
Cohesion: 0.05
Nodes (39): author, bin, resurank-mcp, bugs, url, dependencies, @huggingface/transformers, mammoth (+31 more)

### Community 5 - "MCP Integration & Skill Domains"
Cohesion: 0.08
Nodes (33): Angular Frontend Skills, Backend Engineering Domain, Java / Spring Boot Skills, Nursing / Legal Nurse Domain, TypeScript / Node.js Skills, MCP Jane Doe Resume Fixture, Claude Desktop, Model Context Protocol (+25 more)

### Community 6 - "Angular Build Targets"
Cohesion: 0.07
Nodes (33): build, extract-i18n, serve, test, builder, configurations, defaultConfiguration, options (+25 more)

### Community 7 - "Angular Workspace Config"
Cohesion: 0.07
Nodes (29): cli, analytics, packageManager, prefix, projectType, root, schematics, sourceRoot (+21 more)

### Community 8 - "Claude Desktop Config (Main)"
Cohesion: 0.12
Nodes (25): ClaudeConfig, ClaudeDesktopStatus, connect(), ConnectOptions, ConnectResult, disconnect(), getConfigPath(), getMcpEntry() (+17 more)

### Community 9 - "Settings Drawer Component"
Cohesion: 0.08
Nodes (4): PinnedTerm, SettingsDrawerComponent, PinImportance, PinnedTerm

### Community 10 - "Frontend UI Layout"
Cohesion: 0.12
Nodes (26): Keyword Breakdown Mode (weighted / counts), Job Description Input Panel, Job Description Keywords Panel, Matched / Missing Terms Section, App Root Component, Score Ring & Breakdown, App Toolbar (brand, theme toggle, settings), Claude Desktop Card Component (+18 more)

### Community 11 - "MCP Resume Resolver"
Cohesion: 0.12
Nodes (14): FileCacheEntry, loadResumeFile(), ResolvedResume, resolveResume(), resumePath, ResumeSource, server, validateResumeText() (+6 more)

### Community 12 - "Scoring Model & Design Decisions"
Cohesion: 0.11
Nodes (22): Auto-Update Config (electron-updater), Critical Missing Keywords Penalty, Divergence Adjustment, Keyword Similarity (TF-IDF), Preference Mismatch Penalty, ResuRank Product Description, Security Posture (Fuses, CSP, Isolation), Semantic Similarity (Vector Embeddings) (+14 more)

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

### Community 24 - "Preload tsconfig"
Cohesion: 0.25
Nodes (7): compilerOptions, module, moduleResolution, outDir, rootDir, extends, include

### Community 25 - "Install Shell Script"
Cohesion: 0.52
Nodes (6): blank(), bold(), die(), info(), warn(), install.sh script

### Community 26 - "Embedding Web Worker"
Cohesion: 0.47
Nodes (4): _config, embed(), getEmbedder(), triggerEagerLoad()

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

## Knowledge Gaps
- **294 isolated node(s):** `$schema`, `version`, `packageManager`, `analytics`, `newProjectRoot` (+289 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `embedder` connect `Embedding & Matcher Services` to `MCP Resume Resolver`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `require` connect `MCP Resume Resolver` to `Claude Desktop Config (Main)`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `writeConfigAtomic()` connect `Claude Desktop Config (Main)` to `MCP Resume Resolver`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **What connects `$schema`, `version`, `packageManager` to the rest of the system?**
  _298 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Embedding & Matcher Services` be split into smaller, more focused modules?**
  _Cohesion score 0.0639386189258312 - nodes in this community are weakly interconnected._
- **Should `API Service (IPC Bridge)` be split into smaller, more focused modules?**
  _Cohesion score 0.07294117647058823 - nodes in this community are weakly interconnected._
- **Should `Electron Root Package` be split into smaller, more focused modules?**
  _Cohesion score 0.044444444444444446 - nodes in this community are weakly interconnected._