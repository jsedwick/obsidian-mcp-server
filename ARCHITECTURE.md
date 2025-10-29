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
        
        subgraph "MCP Tools"
            T1[start_session]
            T2[save_session_note]
            T3[search_vault]
            T4[create_topic_page]
            T5[create_decision]
            T6[update_topic_page]
            T7[get_session_context]
            T8[link_to_topic]
            T9[close_session]
        end
    end
    
    subgraph "File System"
        Vault[📁 Obsidian Vault]
        
        subgraph "Vault Structure"
            Sessions[sessions/]
            Topics[topics/]
            Decisions[decisions/]
            Index[index.md]
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
    
    T1 -.->|Creates| Sessions
    T2 -.->|Updates| Sessions
    T3 -.->|Searches| Sessions & Topics & Decisions
    T4 -.->|Creates| Topics
    T5 -.->|Creates| Decisions
    T6 -.->|Updates| Topics
    T7 -.->|Reads| Sessions
    
    style User fill:#e1f5ff
    style CC fill:#ffeb9c
    style MCP fill:#c5f0c5
    style Vault fill:#ffd6cc
    style Obs fill:#e1d5e7
```

## Data Flow

```mermaid
sequenceDiagram
    participant User
    participant Claude as Claude Code
    participant MCP as MCP Server
    participant FS as File System
    
    User->>Claude: "Start a session about auth"
    Claude->>MCP: start_session(topic: "auth")
    MCP->>FS: Create sessions/2025-10-28_auth.md
    MCP->>FS: Search for related content
    FS-->>MCP: Return past auth sessions
    MCP-->>Claude: Session created + context
    Claude-->>User: "I've started a session..."
    
    User->>Claude: "We should use JWT tokens"
    Claude->>MCP: save_session_note(content: "...")
    MCP->>FS: Append to session file
    Claude->>MCP: create_topic_page(topic: "JWT")
    MCP->>FS: Create topics/jwt.md
    MCP-->>Claude: Topic created
    Claude-->>User: "I've recorded this..."
    
    User->>Claude: "What did we discuss about databases?"
    Claude->>MCP: search_vault(query: "database")
    MCP->>FS: Search all .md files
    FS-->>MCP: Matching content
    MCP-->>Claude: Search results
    Claude-->>User: "Here's what we discussed..."
```

## Session Lifecycle

```mermaid
stateDiagram-v2
    [*] --> SessionRequested: User starts conversation
    SessionRequested --> SessionCreated: start_session()
    SessionCreated --> SessionActive: File created
    
    SessionActive --> SearchingContext: search_vault()
    SearchingContext --> SessionActive: Context retrieved
    
    SessionActive --> SavingNotes: save_session_note()
    SavingNotes --> SessionActive: Notes saved
    
    SessionActive --> CreatingTopics: create_topic_page()
    CreatingTopics --> SessionActive: Topic created
    
    SessionActive --> CreatingDecisions: create_decision()
    CreatingDecisions --> SessionActive: Decision recorded
    
    SessionActive --> SessionClosed: close_session()
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
        V2 --> S1[sessions/]
        S1 --> SF1[2025-10-28_auth.md]
        V2 --> I2[index.md]
    end
    
    subgraph "After Creating Topics"
        V3[obsidian-vault/]
        V3 --> S2[sessions/]
        S2 --> SF2[2025-10-28_auth.md]
        V3 --> T1[topics/]
        T1 --> TF1[jwt-tokens.md]
        T1 --> TF2[database-schema.md]
        V3 --> I3[index.md]
    end
    
    subgraph "Fully Populated"
        V4[obsidian-vault/]
        V4 --> S3[sessions/]
        S3 --> SF3[2025-10-28_auth.md]
        S3 --> SF4[2025-10-28_api.md]
        S3 --> SF5[...]
        V4 --> T2[topics/]
        T2 --> TF3[jwt-tokens.md]
        T2 --> TF4[database-schema.md]
        T2 --> TF5[api-design.md]
        T2 --> TF6[...]
        V4 --> D1[decisions/]
        D1 --> DF1[001-use-postgresql.md]
        D1 --> DF2[002-api-structure.md]
        D1 --> DF3[...]
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
    Found -->|Yes| UseContext[Use Context]
    Found -->|No| NoContext[Proceed without]
    
    UseContext --> Answer[Generate Answer]
    NoContext --> Answer
    Direct --> Answer
    
    Answer --> Important{Important Info?}
    Important -->|Yes| Save[save_session_note]
    Important -->|No| Done[Complete]
    
    Save --> Topic{New Concept?}
    Topic -->|Yes| CreateTopic[create_topic_page]
    Topic -->|No| Done
    
    CreateTopic --> Decision{Major Decision?}
    Decision -->|Yes| CreateDecision[create_decision]
    Decision -->|No| Done
    
    CreateDecision --> Done
```

## View in Obsidian

You can view these diagrams in Obsidian by:

1. Copy this file to your vault
2. Install the "Mermaid" plugin (optional, Obsidian has built-in support)
3. Open in preview mode

The diagrams will render interactively!
