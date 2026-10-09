// Structured Computer Science learning catalog. Each topic lists lessons; each lesson
// has real explanatory content (kept concise but genuine). Progress is tracked by the
// useCSProgress hook against completed lesson ids — no fake percentages.

export const LEARN_TOPICS = [
  {
    slug: 'programming-fundamentals', title: 'Programming Fundamentals', category: 'Programming', icon: 'Code2',
    blurb: 'Variables, control flow, functions, and the building blocks of code.',
    lessons: [
      { id: 'pf-1', title: 'Variables & Types', summary: 'How data is stored and typed.', estMinutes: 8,
        body: 'A variable is a named storage location. Types (int, float, string, bool) determine what operations are valid. Statically-typed languages check types at compile time; dynamically-typed languages check at runtime. Choose descriptive names and prefer the smallest type that fits the data.' },
      { id: 'pf-2', title: 'Control Flow', summary: 'Branching and looping.', estMinutes: 10,
        body: 'Control flow directs execution: if/else branches, for/while loops, and early returns. Prefer early returns to reduce nesting. Loops should have a clear termination condition to avoid infinite loops.' },
      { id: 'pf-3', title: 'Functions & Scope', summary: 'Reusable blocks and visibility.', estMinutes: 12,
        body: 'Functions encapsulate behavior. Parameters pass data in; return values pass data out. Scope rules determine where a name is visible. Pure functions (no side effects) are easier to test and reason about.' },
      { id: 'pf-4', title: 'Recursion', summary: 'Functions that call themselves.', estMinutes: 12,
        body: 'A recursive function calls itself with a smaller subproblem until it hits a base case. Every recursion needs a base case to terminate. Recursion depth is bounded by the call stack; deep recursion may need an explicit stack or tail-call optimization.' },
    ],
  },
  {
    slug: 'data-structures', title: 'Data Structures', category: 'Programming', icon: 'Layers',
    blurb: 'Arrays, lists, stacks, queues, trees, heaps, and graphs.',
    lessons: [
      { id: 'ds-1', title: 'Arrays & Dynamic Arrays', summary: 'Contiguous storage.', estMinutes: 10,
        body: 'Arrays offer O(1) indexed access. Dynamic arrays (vectors, ArrayLists) grow by amortized doubling, giving O(1) amortized append. Insertion/deletion in the middle is O(n) due to shifting.' },
      { id: 'ds-2', title: 'Linked Lists', summary: 'Nodes connected by pointers.', estMinutes: 12,
        body: 'A linked list stores nodes with a value and a pointer to the next node. Insertion/deletion at a known node is O(1), but indexing is O(n). Doubly-linked lists add a prev pointer for bidirectional traversal.' },
      { id: 'ds-3', title: 'Stacks & Queues', summary: 'LIFO and FIFO.', estMinutes: 8,
        body: 'A stack is last-in-first-out (push/pop). A queue is first-in-first-out (enqueue/dequeue). Both can be backed by arrays or linked lists. A deque supports both ends in O(1).' },
      { id: 'ds-4', title: 'Hash Tables', summary: 'Average O(1) lookup.', estMinutes: 14,
        body: 'A hash table maps keys to values via a hash function. Average operations are O(1); worst case O(n) with collisions. Resizing (rehashing) keeps the load factor low. Separate chaining and open addressing are common collision strategies.' },
      { id: 'ds-5', title: 'Trees & BSTs', summary: 'Hierarchical, ordered data.', estMinutes: 14,
        body: 'A tree is a connected acyclic graph. A binary search tree keeps left subtree values < node < right subtree values, enabling O(log n) search when balanced. Self-balancing trees (AVL, Red-Black) guarantee height O(log n).' },
      { id: 'ds-6', title: 'Heaps', summary: 'Priority queues.', estMinutes: 12,
        body: 'A binary heap is a complete binary tree where each parent is ordered relative to its children (min-heap: parent <= children). Insert and extract-min are O(log n). Backed by an array with index arithmetic.' },
      { id: 'ds-7', title: 'Graphs', summary: 'Nodes and edges.', estMinutes: 14,
        body: 'A graph is vertices connected by edges. Represent it with an adjacency list (sparse) or matrix (dense). Traversal via BFS (shortest unweighted path) or DFS (component detection, cycle finding).' },
    ],
  },
  {
    slug: 'algorithms', title: 'Algorithms', category: 'Programming', icon: 'Workflow',
    blurb: 'Sorting, searching, greedy, DP, divide & conquer, backtracking.',
    lessons: [
      { id: 'al-1', title: 'Sorting', summary: 'Ordering elements.', estMinutes: 14,
        body: 'Comparison sorts (quicksort, mergesort, heapsort) are O(n log n). Quicksort is in-place but worst-case O(n^2); mergesort is stable and O(n log n) worst case but uses O(n) extra space. Counting/radix sorts beat the bound for restricted keys.' },
      { id: 'al-2', title: 'Binary Search', summary: 'Divide and conquer on sorted data.', estMinutes: 10,
        body: 'Binary search halves the search space each step, giving O(log n). Requires a sorted domain and a monotonic predicate. Off-by-one errors are the classic pitfall — use inclusive/exclusive bounds consistently.' },
      { id: 'al-3', title: 'Greedy', summary: 'Locally optimal choices.', estMinutes: 12,
        body: 'A greedy algorithm makes the best local choice at each step. It works when the problem has the greedy-choice property and optimal substructure (e.g., Huffman coding, activity selection). Prove optimality or it may fail.' },
      { id: 'al-4', title: 'Dynamic Programming', summary: 'Overlapping subproblems.', estMinutes: 16,
        body: 'DP solves problems with overlapping subproblems and optimal substructure by storing sub-results. Top-down uses memoization; bottom-up fills a table. Identify the state, the transition, and the base cases.' },
      { id: 'al-5', title: 'Backtracking', summary: 'Systematic search with pruning.', estMinutes: 14,
        body: 'Backtracking explores a decision tree, abandoning partial solutions that cannot lead to a valid answer (pruning). Used for N-Queens, permutations, and constraint satisfaction. Order choices to maximize early pruning.' },
      { id: 'al-6', title: 'Graph Algorithms', summary: 'Shortest paths, MST, traversal.', estMinutes: 16,
        body: 'BFS/DFS traverse graphs. Dijkstra finds shortest paths with non-negative weights using a min-heap. Bellman-Ford handles negative weights. Kruskal/Prim build a minimum spanning tree. Topological sort orders a DAG.' },
    ],
  },
  {
    slug: 'computer-architecture', title: 'Computer Architecture', category: 'Systems', icon: 'Cpu',
    blurb: 'CPU, memory hierarchy, and instruction execution.',
    lessons: [
      { id: 'ca-1', title: 'The CPU & Instruction Cycle', summary: 'Fetch-decode-execute.', estMinutes: 12,
        body: 'The CPU repeats the instruction cycle: fetch the next instruction at the program counter, decode it, execute it, and write back results. The clock synchronizes stages. Pipelining overlaps stages to improve throughput.' },
      { id: 'ca-2', title: 'Memory Hierarchy', summary: 'Registers, cache, RAM, disk.', estMinutes: 12,
        body: 'Faster memory is smaller and costlier. Registers are fastest, then L1/L2/L3 cache, then RAM, then storage. Locality (temporal and spatial) is exploited by caches to approximate the speed of the fastest level with the size of the slowest.' },
      { id: 'ca-3', title: 'The ALU & Flags', summary: 'Arithmetic and status.', estMinutes: 10,
        body: 'The Arithmetic Logic Unit performs operations and sets status flags (zero, carry, overflow, sign). Conditional branches read these flags to alter control flow.' },
    ],
  },
  {
    slug: 'operating-systems', title: 'Operating Systems', category: 'Systems', icon: 'Terminal',
    blurb: 'Processes, scheduling, memory, and concurrency.',
    lessons: [
      { id: 'os-1', title: 'Processes & Threads', summary: 'Units of execution.', estMinutes: 12,
        body: 'A process is an instance of a program with its own address space. Threads share a process address space. Context switching swaps the CPU between processes, saving and restoring state.' },
      { id: 'os-2', title: 'CPU Scheduling', summary: 'Sharing the processor.', estMinutes: 14,
        body: 'Scheduling policies decide which ready process runs: FCFS is simple but can suffer convoy; SJF minimizes average wait but needs prediction; Round Robin gives fairness via time quanta; Priority can starve low-priority tasks without aging.' },
      { id: 'os-3', title: 'Memory Management', summary: 'Paging and virtual memory.', estMinutes: 14,
        body: 'Paging divides memory into fixed-size frames, eliminating external fragmentation. Virtual memory maps logical to physical addresses via page tables. The TLB caches translations. Page faults trigger disk I/O.' },
      { id: 'os-4', title: 'Deadlocks', summary: 'When processes wait forever.', estMinutes: 12,
        body: 'A deadlock needs four conditions: mutual exclusion, hold-and-wait, no preemption, circular wait. Prevention breaks one condition. Banker\'s algorithm avoids unsafe states by checking a safe allocation sequence.' },
    ],
  },
  {
    slug: 'computer-networks', title: 'Computer Networks', category: 'Systems', icon: 'Network',
    blurb: 'Protocols, addressing, routing, and the layered model.',
    lessons: [
      { id: 'cn-1', title: 'The Layered Model', summary: 'OSI and TCP/IP.', estMinutes: 12,
        body: 'Networks are layered: physical, data link, network, transport, application. Each layer serves the one above. TCP/IP collapses these into link, internet, transport, application. Encapsulation wraps data with headers at each layer.' },
      { id: 'cn-2', title: 'IP & Subnetting', summary: 'Addressing and routing.', estMinutes: 14,
        body: 'IP addresses identify hosts; subnet masks divide a network into subnets. CIDR notation (e.g., /24) specifies the prefix length. Routers forward packets between subnets using the longest-prefix-match in their routing tables.' },
      { id: 'cn-3', title: 'TCP vs UDP', summary: 'Reliable vs best-effort.', estMinutes: 10,
        body: 'TCP is connection-oriented, reliable, ordered, with flow and congestion control (three-way handshake, ACKs, retransmits). UDP is connectionless, unreliable, low-overhead — used for DNS, VoIP, and real-time media.' },
    ],
  },
  {
    slug: 'databases', title: 'Databases', category: 'Systems', icon: 'Database',
    blurb: 'Relational model, SQL, and transactions.',
    lessons: [
      { id: 'db-1', title: 'The Relational Model', summary: 'Tables, keys, normalization.', estMinutes: 12,
        body: 'A relational database stores data in tables (relations). Primary keys uniquely identify rows; foreign keys reference other tables. Normalization reduces redundancy: 1NF, 2NF, 3NF, BCNF.' },
      { id: 'db-2', title: 'SQL', summary: 'Querying relational data.', estMinutes: 14,
        body: 'SQL selects (SELECT/FROM/WHERE), groups (GROUP BY/HAVING), orders (ORDER BY), and joins tables (INNER, LEFT, RIGHT, FULL). Subqueries nest queries; CTEs (WITH) improve readability.' },
      { id: 'db-3', title: 'Transactions & ACID', summary: 'Atomic, consistent, isolated, durable.', estMinutes: 12,
        body: 'A transaction is a unit of work. ACID: Atomic (all-or-nothing), Consistent (valid state), Isolated (concurrent transactions don\'t interfere), Durable (committed writes survive crashes). Isolation levels balance safety and performance.' },
    ],
  },
  {
    slug: 'theory-of-computation', title: 'Theory of Computation', category: 'Theory', icon: 'Sigma',
    blurb: 'Automata, languages, and what can be computed.',
    lessons: [
      { id: 'tc-1', title: 'Finite Automata', summary: 'DFA and NFA.', estMinutes: 12,
        body: 'A DFA reads a string and changes state deterministically; it accepts if it ends in a final state. An NFA allows multiple transitions and epsilon moves. DFAs and NFAs recognize exactly the regular languages and are convertible.' },
      { id: 'tc-2', title: 'Regular Expressions', summary: 'Describing regular languages.', estMinutes: 10,
        body: 'Regular expressions describe regular languages with union, concatenation, and Kleene star. They are equivalent in power to finite automata. Some features (backreferences) go beyond regular languages.' },
      { id: 'tc-3', title: 'Turing Machines', summary: 'The limits of computation.', estMinutes: 14,
        body: 'A Turing machine has an infinite tape, a head, and a finite control. It defines what is computable. The Halting Problem is undecidable: no algorithm can decide for all programs whether they halt.' },
    ],
  },
  {
    slug: 'compilers', title: 'Compiler Design', category: 'Systems', icon: 'Workflow',
    blurb: 'From source code to executable.',
    lessons: [
      { id: 'co-1', title: 'Lexical Analysis', summary: 'Source to tokens.', estMinutes: 10,
        body: 'The lexer (scanner) converts a character stream into tokens, discarding whitespace and comments. Tokens are classified by category (keyword, identifier, literal, operator). Lexical errors are malformed tokens.' },
      { id: 'co-2', title: 'Parsing', summary: 'Tokens to AST.', estMinutes: 12,
        body: 'The parser builds an abstract syntax tree from tokens according to a grammar. Top-down (recursive descent, LL) and bottom-up (LR, LALR) parsers differ in power and implementation. Syntax errors violate the grammar.' },
      { id: 'co-3', title: 'Optimization & Codegen', summary: 'Better IR to machine code.', estMinutes: 12,
        body: 'Optimization improves the intermediate representation (constant folding, dead-code elimination, loop-invariant code motion). Code generation maps the IR to the target machine\'s instructions, handling register allocation.' },
    ],
  },
  {
    slug: 'cybersecurity', title: 'Cybersecurity', category: 'Systems', icon: 'ShieldCheck',
    blurb: 'Defensive concepts and secure coding.',
    lessons: [
      { id: 'cy-1', title: 'Hashing & Salting', summary: 'One-way integrity.', estMinutes: 10,
        body: 'A cryptographic hash maps data to a fixed-size digest. It is one-way and collision-resistant. Passwords should be salted and stretched with a slow KDF (bcrypt, argon2) — never stored in plaintext or with a fast hash like MD5.' },
      { id: 'cy-2', title: 'Authentication', summary: 'Proving identity.', estMinutes: 10,
        body: 'Authentication verifies identity (something you know/have/are). Passwords, OTPs, hardware keys, and biometrics combine for multi-factor auth. Sessions use tokens; never store secrets in client-side code.' },
      { id: 'cy-3', title: 'Secure Coding', summary: 'Avoiding common flaws.', estMinutes: 12,
        body: 'Validate and sanitize all input to prevent injection (SQL, XSS, command). Use parameterized queries. Principle of least privilege. Never trust client-supplied data. Keep dependencies patched.' },
    ],
  },
  {
    slug: 'software-engineering', title: 'Software Engineering', category: 'Engineering', icon: 'GitBranch',
    blurb: 'Version control, testing, and design.',
    lessons: [
      { id: 'se-1', title: 'Version Control with Git', summary: 'Branches and history.', estMinutes: 12,
        body: 'Git tracks snapshots with a DAG of commits. Branches are lightweight pointers; merging combines histories. Feature branches keep main stable. Rebase rewrites history linearly; squash condenses commits.' },
      { id: 'se-2', title: 'Testing', summary: 'Unit and integration tests.', estMinutes: 12,
        body: 'Unit tests verify individual functions; integration tests verify components together. Test coverage measures what is exercised, not correctness. Red-Green-Refactor (TDD) drives design from tests.' },
      { id: 'se-3', title: 'Design & Architecture', summary: 'Structuring systems.', estMinutes: 12,
        body: 'Good design favors high cohesion and low coupling. Patterns (MVC, repository, factory) solve recurring problems. Layered and hexagonal architectures separate concerns. Diagrams (UML, C4) communicate structure.' },
    ],
  },
];

export const LEARN_CATEGORIES = Array.from(new Set(LEARN_TOPICS.map((t) => t.category)));

export function getTopic(slug) {
  return LEARN_TOPICS.find((t) => t.slug === slug);
}