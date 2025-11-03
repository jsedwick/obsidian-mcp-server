# Architecture Diagram

```mermaid
graph TB
    subgraph "User Environment"
        User[👤 User]
        CC[Claude Code]
        Obs[📓 Obsidian App]
    end

    subgraph "MCP Server Process"
        MCP[🔧 Obsidian MCP Server]

        subgraph "Session & Content Tools"
            T1[start_session]
            T2[save_session_note]
            T9[close_session]
            T4[create_topic_page]
            T5[create_decision]
            T6[update_topic_page]
            T7[get_session_context]
            T8[link_to_topic]
        end

        subgraph "Search & Retrieval"
            T3[search_vault]
            T20[toggle_embeddings]
            SE[Semantic Engine<br/>+ Keyword Search]
        end

        subgraph "Git Integration Tools"
            T10[track_file_access]
            T11[detect_session_repositories]
            T12[link_session_to_repository]
            T13[create_project_page]
            T14[record_commit]
        end
    end

    subgraph "External Services"
        Git[🐙 Git Repositories]
        Embeddings["🤖 Local Embeddings<br/>(Xenova/all-MiniLM)"]
        Cache["💾 Embedding Cache<br/>(.embedding-cache/)"]
    end

    subgraph "File System"
        Vault[📁 Obsidian Vault]

        subgraph "Vault Structure"
            Sessions["sessions/<br/>(organized by month)"]
            Topics[topics/]
            Decisions[decisions/]
            Projects[projects/]
            Index[index.md]
            EmbedCache[.embedding-cache/]
        end
    end

    User -->|Chats with| CC
    CC <-->|MCP Protocol<br/>stdio| MCP
    MCP -->|Reads/Writes| Vault
    Obs -->|Views/Edits| Vault
    User -->|Views| Obs

    MCP --> T1
    MCP --> T2
    MCP --> T3
    MCP --> T4
    MCP --> T5
    MCP --> T6
    MCP --> T7
    MCP --> T8
    MCP --> T9
    MCP --> T10
    MCP --> T11
    MCP --> T12
    MCP --> T13
    MCP --> T14
    MCP --> T20

    T1 -.->|Creates| Sessions
    T2 -.->|Updates| Sessions
    T3 -.->|Searches| Sessions & Topics & Decisions
    T3 -->|Uses| SE
    T20 -.->|Controls| SE
    SE -->|Caches| Cache
    SE -->|Reads| Cache
    T4 -.->|Creates| Topics
    T5 -.->|Creates| Decisions
    T6 -.->|Updates| Topics
    T7 -.->|Reads| Sessions
    T10 -.->|Records| Sessions
    T11 -.->|Detects| Git
    T12 -.->|Updates| Sessions
    T13 -.->|Creates| Projects
    T14 -.->|Records| Projects

    style User fill:#e1f5ff
    style CC fill:#ffeb9c
    style MCP fill:#c5f0c5
    style Vault fill:#ffd6cc
    style Obs fill:#e1d5e7
    style Git fill:#f0f0f0
    style Embeddings fill:#fff9c4
    style Cache fill:#fff9c4
    style SE fill:#fff9c4
```

## Data Flow

```mermaid
sequenceDiagram
    participant User
    participant Claude as Claude Code
    participant MCP as MCP Server
    participant SE as Semantic Engine
    participant FS as File System
    participant Git as Git Repos

    User->>Claude: "Start a session about auth"
    Claude->>MCP: start_session(topic: "auth")
    MCP->>FS: Create sessions/2025-11/auth.md
    Claude->>MCP: search_vault(query: "auth")
    MCP->>SE: Get embeddings + search
    SE-->>MCP: Ranked results (semantic + keyword)
    MCP-->>Claude: Session created + context
    Claude-->>User: "I've started a session..."

    User->>Claude: "Edit auth.ts"
    Claude->>MCP: track_file_access(path, action: "edit")
    MCP->>FS: Record in session metadata

    User->>Claude: "Save decision about JWT tokens"
    Claude->>MCP: save_session_note(content: "...")
    MCP->>FS: Append to session file
    Claude->>MCP: create_topic_page(topic: "JWT")
    MCP->>FS: Create topics/jwt.md
    MCP-->>Claude: Topic created
    Claude-->>User: "Recorded..."

    User->>Claude: "Close session"
    Claude->>MCP: close_session()
    MCP->>Git: Detect repositories
    Git-->>MCP: Found api-server repo
    MCP->>FS: Update session with repo link
    MCP-->>Claude: Session closed, repo detected
    Claude-->>User: "Session closed. Create a commit?"

    User->>Claude: "What past auth work exists?"
    Claude->>MCP: search_vault(query: "authentication")
    MCP->>SE: Generate embedding + hybrid search
    SE->>FS: Search with semantic ranking
    FS-->>SE: Matching files (ranked)
    SE-->>MCP: Top results with scores
    MCP-->>Claude: Results (30% time first, <1s cached)
    Claude-->>User: "Here's what we discussed..."
```

## Session Lifecycle

```mermaid
stateDiagram-v2
    [*] --> SessionRequested: User starts conversation
    SessionRequested --> SessionCreated: start_session()
    SessionCreated --> SessionActive: File created + auto-search

    SessionActive --> SearchingContext: search_vault()
    SearchingContext --> SessionActive: Context retrieved (semantic + keyword)

    SessionActive --> TrackingFiles: Files accessed during work
    TrackingFiles --> SessionActive: File access recorded

    SessionActive --> SavingNotes: save_session_note()
    SavingNotes --> SessionActive: Notes saved

    SessionActive --> CreatingTopics: create_topic_page()
    CreatingTopics --> SessionActive: Topic created

    SessionActive --> CreatingDecisions: create_decision()
    CreatingDecisions --> SessionActive: Decision recorded

    SessionActive --> SessionClosing: close_session()
    SessionClosing --> DetectingRepos: Auto-detect Git repos
    DetectingRepos --> RepoFound: Repositories detected
    RepoFound --> RepoNotFound: No repos found

    RepoFound --> LinkedToRepo: link_session_to_repository()
    LinkedToRepo --> ProjectPage: create_project_page()
    ProjectPage --> RecordingCommit: record_commit()
    RecordingCommit --> SessionClosed: Commit recorded

    RepoNotFound --> SessionClosed: No linking needed
    SessionClosed --> [*]: Status: completed
```

## File Structure Evolution

```mermaid
graph LR
    subgraph "Initial State"
        V1[obsidian-vault/]
        V1 --> I1[index.md]
    end

    subgraph "After First Session"
        V2[obsidian-vault/]
        V2 --> S1["sessions/2025-11/"]
        S1 --> SF1["2025-11-01_auth.md"]
        V2 --> I2[index.md]
    end

    subgraph "After Creating Topics"
        V3[obsidian-vault/]
        V3 --> S2["sessions/2025-11/"]
        S2 --> SF2["2025-11-01_auth.md"]
        V3 --> T1[topics/]
        T1 --> TF1[jwt-tokens.md]
        T1 --> TF2[database-schema.md]
        V3 --> I3[index.md]
    end

    subgraph "After Git Integration"
        V4[obsidian-vault/]
        V4 --> S3["sessions/2025-11/"]
        S3 --> SF3["2025-11-01_auth.md<br/>(with repo link)"]
        V4 --> T2[topics/]
        T2 --> TF3[jwt-tokens.md]
        T2 --> TF4[database-schema.md]
        V4 --> D1[decisions/]
        D1 --> DF1["001-use-postgresql.md"]
        V4 --> PR["projects/api-server/"]
        PR --> PF1["project.md"]
        PR --> PF2["commits/"]
        PF2 --> CF1["abc123d.md"]
        V4 --> EC[".embedding-cache/"]
        V4 --> I4[index.md]
    end

    V1 --> V2
    V2 --> V3
    V3 --> V4
```

## Tool Interactions

```mermaid
graph TD
    Start[User Question] --> Search{Need Context?}
    Search -->|Yes| SearchVault[search_vault]
    Search -->|No| Direct[Direct Answer]

    SearchVault --> Found{Found?}
    Found -->|Yes| UseContext[Use Context<br/>Semantic Ranking]
    Found -->|No| NoContext[Proceed without]

    UseContext --> Answer[Generate Answer]
    NoContext --> Answer
    Direct --> Answer

    Answer --> Important{Important Info?}
    Important -->|Yes| Save[save_session_note]
    Important -->|No| WorkingOnCode{Code Work?}

    WorkingOnCode -->|Yes| Track[track_file_access]
    WorkingOnCode -->|No| Done[Complete]
    Track --> WorkDone[Files recorded]

    Save --> Topic{New Concept?}
    Topic -->|Yes| CreateTopic[create_topic_page]
    Topic -->|No| WorkingOnCode

    CreateTopic --> Decision{Major Decision?}
    Decision -->|Yes| CreateDecision[create_decision]
    Decision -->|No| WorkingOnCode

    CreateDecision --> WorkingOnCode

    WorkDone --> SessionEnd{End Session?}
    SessionEnd -->|Yes| Close[close_session]
    SessionEnd -->|No| Done

    Close --> Detect[detect_session_repositories]
    Detect --> RepoFound{Repos Found?}
    RepoFound -->|Yes| Link[link_session_to_repository]
    RepoFound -->|No| Done

    Link --> CreateProj[create_project_page]
    CreateProj --> Record[record_commit]
    Record --> Done
```

## View in Obsidian

You can view these diagrams in Obsidian by:

1. Copy this file to your vault
2. Install the "Mermaid" plugin (optional, Obsidian has built-in support)
3. Open in preview mode

The diagrams will render interactively!
