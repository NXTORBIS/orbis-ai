# J.A.R.V.I.S. — Computer Science Studio and Games Studio

## Computer Science Studio (`/cs`)

A left rail of **24 sections**: Overview · Learn · Problems · Daily Challenge · Contests · Programming &
Development · Algorithms & DSA · Computer Architecture · Operating Systems · Computer Networks · Databases ·
Digital Logic · Compiler Design · Theory of Computation · Cybersecurity · AI & Machine Learning · Data Science ·
Computer Graphics · Distributed Systems · Software Engineering · Projects · Playground · Achievements · Progress.

### Learn (`/cs/learn`)
> "Structured Computer Science topics with real lessons. Progress is tracked from completed lessons."

Eleven courses, each with a lesson count and a percentage: Programming Fundamentals (4) · Data Structures (7) ·
Algorithms (6) · Computer Architecture (3) · Operating Systems (4) · Computer Networks (3) · Databases (3) ·
Theory of Computation (3) · Compiler Design (3) · Cybersecurity (3) · Software Engineering (3). Grouped as
**Programming / Systems / Theory / Engineering**.

### Problems (`/cs/problems`) — a LeetCode
`16 problems · 0 solved`. Filters: **Easy / Medium / Hard / Expert**; 21 topic tags (Array, BFS, Backtracking,
Binary Search, DFS, Design, Divide and Conquer, Dynamic Programming, Graph, Hash Table, Heap, Linked List, Math,
Matrix, Pointers, Recursion, Shortest Path, Sliding Window, Stack, String, Two Pointers); status
**All / Solved / Attempted / Bookmarked**; sort **Newest / Acceptance / Difficulty**.

Each row: number, title, **acceptance %**, difficulty, **XP** (+25 Easy, +50 Medium, +100 Hard, +200 Expert).
The sixteen: Two Sum · Reverse Linked List · Valid Parentheses · Binary Search · Maximum Subarray · Longest
Substring Without Repeating Characters · Merge Two Sorted Lists · Climbing Stairs · Shortest Path (Dijkstra) ·
LRU Cache · Word Ladder · Trapping Rain Water · Number of Islands · Median of Two Sorted Arrays · Regular
Expression Matching · N-Queens.

### A problem page (`/cs/problem/:slug`)
Statement · worked **Examples** with explanation · **Constraints** · topic tags · **Hints (Reveal hint 0/2)** ·
**View Solution** · **My notes** · language selector · **Run** · **Submit** · code editor · **Console** with
**Custom stdin** ("STDIN — type input here, one value per line, then hit Run").

**Note:** the language selector reads **"Python — execution unavailable"**. JARVIS has the same limit Orbis has: it
cannot execute code. It still ships the whole surface around it, and says so in one short phrase rather than hiding
the feature.

### Laboratories (`/cs/labs`)
> "Interactive Computer Science laboratories. Available labs run real simulations; others are on the roadmap."

**Available (3):** Algorithms & DSA (`/algorithm-lab`) · Digital Logic (`/digital-logic-lab`) ·
Electronics (`/electronics-lab`, "analog circuit design with a real MNA simulation engine").

**Coming soon / on roadmap (12):** Computer Architecture (CPU, ALU, registers, fetch-decode-execute) ·
Operating Systems (CPU scheduling, paging, page replacement, deadlocks) · Computer Networks (build a network, route
packets, inspect protocols) · Databases (SQL editor with schema diagrams and query plans) · Compiler Design (lexing,
parsing, AST, code generation) · Theory of Computation (DFA/NFA, regular expressions, Turing machines) ·
Cybersecurity · AI & Machine Learning · Data Science · Computer Graphics (transformations, projection, lighting,
rasterization) · Distributed Systems (consensus, replication, fault tolerance) · Software Engineering.

> **Worth noticing:** every one of those twelve "roadmap" labs is something **Orbis has already built** — the
> processor pipeline, the scheduler and pager, the network, the SQL lab with its schema diagram, the learning and
> neural labs. Orbis is ahead of JARVIS on exactly the list JARVIS has not got to.

## Games Studio (`/games`)

**47 games**, presented like a storefront. Rails: **Recent games · Featured · Recommended for you · Trending now ·
New releases · Popular this week · Editor's picks · Browse by category**. Sub-nav: Hub · Search · Favorites ·
Hand Cricket · History · **Leaderboards**.

Every game carries a **rating** (4.0–4.6) and a **difficulty** (Easy / Medium / Hard / Expert), and tiles offer
**Play** and **More Info**.

| Category | Count | Games |
| --- | --- | --- |
| Arcade | 14 | 2048 · Flappy Bird · Doodle Jump · Tetris · Pinball · Breakout · Bubble Shooter · Snake · Color Switch · Lane Runner · Gravity Flip · Fruit Slice · Pong · Stack Tower |
| Action | 6 | Bullet Dodge · Territory Grab · Arena Survival · Space Invaders · Maze Escape · Tower Defense |
| Puzzle | 9 | Sudoku · Pipe Connect · Water Sort · One Line Path · Hex Puzzle · Sliding Puzzle · Match Three · Drop Merge · Minesweeper |
| Brain & Skill | 5 | Whack-a-Mole · Simon Says · Memory Match · Aim Trainer · Reaction Time Test |
| Word | 3 | Hangman · Typing Race · Wordle |
| Board | 4 | Connect 4 · Chess · Light Cycle · Tic-Tac-Toe |
| Casual | 5 | Spin the Wheel · Trivia Quiz · Catch Fall · Idle Empire · Dodge Fall |
| Sports | 1 | Hand Cricket |

Also: `/games-centre` ("Game library", keywords *directory, download, discover, catalogue, store*),
`/games/leaderboards`, `/games/history`, `/games/favorites`, `/games/search`, and per-game routes
`/games/game/:gameId`, `/games/play/:gameId`, `/games/category/:categoryId`.

## Chess Studio (`/chess`) — nine screens

> "Play against AI opponents from **100 to 3200 Elo** or a friend, with **full FIDE rules**, move history, and an
> **AI coach**."

`/chess/hub` · `/chess/play` · `/chess/analysis` · `/chess/puzzles` · `/chess/openings` · `/chess/multiplayer` ·
`/chess/archive` · `/chess/statistics` · `/chess/achievements` · `/chess/engine` · `/chess/custom`.
