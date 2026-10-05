/**
 * The shared tag vocabulary. A tag is `namespace:value` in lower case kebab (for example `topic:ai` or
 * `content-type:video`). The namespaces below are the ones Ultimyr understands; any other well formed namespace is
 * stored and returned but only these take part in icon suggestions.
 *
 * `synonyms` are words that point at the tag: they turn free text into tags and bare words into the right tag.
 * `icons` is the curated shortlist of Lucide icons for the tag, best first. Every name is checked against the bundled
 * catalog by the tests, so a Lucide upgrade that renames one fails loudly.
 */
export interface TagDef {
  label: string;
  synonyms: string[];
  icons: string[];
}

export const NAMESPACES = {
  "content-type": { label: "Content type", weight: 0.6, description: "What kind of material it is. A video with a written summary carries both video and reading." },
  topic: { label: "Topic", weight: 1, description: "What it covers. Drives weak and strong area reading and icon suggestions." },
  level: { label: "Level", weight: 0.1, description: "How advanced it is." },
} as const;
export type KnownNamespace = keyof typeof NAMESPACES;

/** Other spellings people and assistants use for a namespace. */
export const NAMESPACE_ALIASES: Record<string, KnownNamespace> = {
  type: "content-type",
  format: "content-type",
  content: "content-type",
  media: "content-type",
  subject: "topic",
  area: "topic",
  domain: "topic",
  difficulty: "level",
};

const def = (label: string, synonyms: string[], icons: string[]): TagDef => ({ label, synonyms, icons });

export const CONTENT_TYPES: Record<string, TagDef> = {
  video: def("Video", ["video", "videos", "lecture", "lectures", "screencast", "webinar", "watch"], ["video", "clapperboard", "monitor-play", "play", "film"]),
  reading: def("Reading", ["reading", "text", "article", "articles", "documentation", "transcript", "handout", "guide"], ["book-open-text", "file-text", "newspaper", "book-open", "notebook-text"]),
  audio: def("Audio", ["audio", "podcast", "podcasts", "listen"], ["headphones", "mic-vocal", "audio-lines", "mic"]),
  lab: def("Lab", ["lab", "labs", "hands-on", "exercise", "exercises", "sandbox", "simulation", "walkthrough"], ["flask-conical", "terminal", "wrench", "test-tubes"]),
  quiz: def("Quiz", ["quiz", "quizzes", "questions", "test"], ["circle-question-mark", "list-checks", "clipboard-check"]),
  flashcards: def("Flashcards", ["flashcards", "flashcard", "cards", "deck", "recall"], ["layers", "gallery-vertical-end", "copy"]),
  course: def("Course", ["course", "courses", "curriculum", "learning-path", "program"], ["graduation-cap", "library", "school"]),
  "practice-exam": def("Practice exam", ["practice-exam", "mock-exam", "mock", "exam-simulator", "practice-test"], ["file-check", "clipboard-list", "timer"]),
  live: def("Live session", ["live", "workshop", "bootcamp", "instructor-led", "class"], ["radio", "presentation", "users"]),
  checkpoint: def("Checkpoint", ["checkpoint", "milestone", "review"], ["flag", "milestone", "badge-check"]),
};

export const TOPICS: Record<string, TagDef> = {
  ai: def("Artificial intelligence", ["ai", "artificial intelligence", "llm", "llms", "large language model", "generative ai", "genai", "claude", "chatgpt", "gemini", "copilot", "transformer", "foundation model"], ["bot", "brain-circuit", "sparkles", "cpu", "brain"]),
  "prompt-engineering": def("Prompt engineering", ["prompt", "prompts", "prompting", "prompt engineering", "context window", "system prompt"], ["message-square-text", "terminal", "wand-sparkles", "text-cursor-input"]),
  agents: def("Agents and tools", ["agent", "agents", "agentic", "mcp", "model context protocol", "tool use", "function calling", "orchestration"], ["bot", "workflow", "blocks", "plug"]),
  "machine-learning": def("Machine learning", ["machine learning", "ml", "neural network", "neural networks", "deep learning", "training", "supervised", "regression", "classification"], ["brain-circuit", "network", "chart-scatter", "bot"]),
  "data-science": def("Data science", ["data science", "data analysis", "analytics", "pandas", "visualization", "statistics", "statistical", "dashboard"], ["chart-line", "chart-column", "chart-pie", "table"]),
  programming: def("Programming", ["programming", "coding", "code", "software", "python", "javascript", "typescript", "java", "golang", "rust", "developer", "algorithm", "algorithms"], ["code", "braces", "square-terminal", "file-code", "binary"]),
  "web-development": def("Web development", ["web", "html", "css", "frontend", "front-end", "react", "browser", "website"], ["globe", "app-window", "layout-template", "monitor"]),
  testing: def("Testing and QA", ["testing", "unit test", "qa", "quality assurance", "test automation", "debugging"], ["bug", "flask-conical", "badge-check", "test-tubes"]),
  networking: def("Networking", ["networking", "network", "networks", "tcp", "ip", "dns", "dhcp", "routing", "router", "switch", "lan", "wan", "subnet", "wireless", "wifi", "ethernet", "osi"], ["network", "router", "ethernet-port", "wifi", "cable"]),
  security: def("Security", ["security", "cybersecurity", "cyber", "threat", "malware", "encryption", "firewall", "vulnerability", "pentest", "penetration", "incident response", "zero trust"], ["shield-check", "shield", "lock", "key-round", "shield-alert"]),
  privacy: def("Privacy and compliance", ["privacy", "gdpr", "compliance", "governance", "regulation", "audit", "hipaa", "risk"], ["scale", "file-lock", "shield-user", "clipboard-check"]),
  identity: def("Identity and access", ["identity", "iam", "authentication", "authorization", "sso", "saml", "oauth", "oidc", "scim", "passkey", "rbac"], ["fingerprint-pattern", "key-round", "user-lock", "id-card"]),
  cloud: def("Cloud", ["cloud", "aws", "azure", "gcp", "google cloud", "serverless", "saas", "iaas", "paas", "virtualization"], ["cloud", "cloud-cog", "server-cog", "cloudy"]),
  devops: def("DevOps", ["devops", "ci/cd", "cicd", "pipeline", "docker", "container", "containers", "kubernetes", "terraform", "infrastructure as code", "deployment", "sre"], ["container", "git-branch", "workflow", "rocket", "infinity"]),
  databases: def("Databases", ["database", "databases", "sql", "postgres", "postgresql", "mysql", "nosql", "query", "queries", "data modeling"], ["database", "table", "database-zap", "hard-drive"]),
  "operating-systems": def("Operating systems", ["operating system", "operating systems", "windows", "macos", "os", "kernel", "filesystem", "powershell", "bash"], ["monitor", "laptop", "square-terminal", "hard-drive"]),
  linux: def("Linux", ["linux", "ubuntu", "debian", "unix", "shell scripting", "command line", "cli"], ["terminal", "square-terminal", "command", "server"]),
  hardware: def("Hardware", ["hardware", "motherboard", "cpu", "ram", "memory", "storage", "peripherals", "printer", "laptop", "bios", "troubleshooting"], ["cpu", "hard-drive", "memory-stick", "microchip", "monitor-cog"]),
  electronics: def("Electronics and IoT", ["electronics", "iot", "internet of things", "circuit", "embedded", "arduino", "raspberry pi", "sensor", "sensors"], ["circuit-board", "cpu", "radio-tower", "zap"]),
  architecture: def("Architecture and design", ["architecture", "system design", "design patterns", "microservices", "scalability", "api design"], ["blocks", "layout-dashboard", "boxes", "network"]),
  automation: def("Automation", ["automation", "scripting", "workflow", "workflows", "no-code", "rpa", "zapier", "n8n"], ["workflow", "cog", "zap", "repeat"]),
  math: def("Math", ["math", "maths", "mathematics", "algebra", "calculus", "geometry", "linear algebra", "probability"], ["calculator", "sigma", "pi", "square-function"]),
  science: def("Science", ["science", "biology", "chemistry", "physics", "laboratory", "scientific"], ["flask-conical", "atom", "microscope", "dna"]),
  healthcare: def("Healthcare", ["healthcare", "health", "medical", "clinical", "nursing", "anatomy", "pharmacology", "patient"], ["heart-pulse", "stethoscope", "cross", "syringe"]),
  business: def("Business", ["business", "management", "marketing", "sales", "strategy", "operations", "entrepreneurship"], ["briefcase", "building", "handshake", "presentation"]),
  finance: def("Finance", ["finance", "accounting", "investing", "budgeting", "banking", "tax", "economics", "cfa"], ["landmark", "badge-dollar-sign", "chart-no-axes-combined", "wallet"]),
  "project-management": def("Project management", ["project management", "pmp", "agile", "scrum", "kanban", "prince2", "itil", "stakeholder"], ["kanban", "list-checks", "calendar-check", "chart-gantt"]),
  leadership: def("Leadership and people", ["leadership", "team", "teams", "coaching", "communication", "soft skills", "hr", "hiring"], ["users", "handshake", "messages-square", "crown"]),
  law: def("Law and ethics", ["law", "legal", "ethics", "ethical", "responsible ai", "bias", "policy"], ["scale", "gavel", "landmark", "book-lock"]),
  design: def("Design", ["design", "ux", "ui", "figma", "typography", "graphic", "accessibility"], ["palette", "pen-tool", "frame", "swatch-book"]),
  writing: def("Writing", ["writing", "grammar", "editing", "technical writing", "copywriting", "essay"], ["pen-line", "file-pen", "notebook-pen", "feather"]),
  languages: def("Languages", ["foreign language", "language learning", "spanish", "french", "german", "japanese", "vocabulary", "translation", "esl"], ["languages", "messages-square", "book-a", "globe"]),
  "exam-strategy": def("Exam strategy", ["exam strategy", "exam tips", "test taking", "study skills", "time management", "exam day"], ["target", "timer", "trophy", "lightbulb"]),
};

export const LEVELS: Record<string, TagDef> = {
  beginner: def("Beginner", ["beginner", "introductory", "intro", "fundamentals", "foundations", "basics"], []),
  intermediate: def("Intermediate", ["intermediate"], []),
  advanced: def("Advanced", ["advanced", "expert", "deep dive"], []),
};

export const VOCABULARY: Record<KnownNamespace, Record<string, TagDef>> = {
  "content-type": CONTENT_TYPES,
  topic: TOPICS,
  level: LEVELS,
};

/** Fixed mapping from what the app already stores to content type tags. Costs nothing and cannot drift. */
export const RESOURCE_KIND_TYPES: Record<string, string[]> = {
  video: ["video"],
  playlist: ["video"],
  article: ["reading"],
  docs: ["reading"],
  book: ["reading"],
  course: ["course"],
  practice: ["lab"],
  podcast: ["audio"],
  other: [],
};
export const ITEM_KIND_TYPES: Record<string, string[]> = { guide: ["reading"], deck: ["flashcards"], quiz: ["quiz"] };
