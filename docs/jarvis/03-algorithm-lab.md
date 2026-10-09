# J.A.R.V.I.S. — Algorithm Laboratory (`/algorithm-lab`)

> "Step-by-step visualization of real algorithm execution"

This is the single most directly comparable thing to an Orbis laboratory, and it is far larger than ours: **84
algorithms in 16 categories**, against Orbis's handful.

## The screen

**Header:** title, strapline, **Compare**, **Favorite**.

**Category filter (16):** All · Sorting · Searching · Arrays · Linked Lists · Stacks · Queues · Trees · Graphs ·
Shortest Path · Dynamic Programming · Strings · Recursion · Backtracking · Greedy · Hashing.

**Input row:** a comma-separated number box (default `5,3,8,1,9,2,7,4,6`), **Run**, **Randomize & Run**.

**Generators:** Random · Sorted · Reverse · Nearly sorted · Duplicates, with **Size**, **Min**, **Max** and **Seed**
boxes. (A seed, so a run is repeatable.)

**Visualization** with **Expand** (full-screen).

**Transport controls** — a full media bar, not just play:
Jump to start · Skip back 5 · Previous step · **Play/Pause** · Next step · Skip forward 5 · Jump to end · **Stop** ·
**Restart**, with `Step n / N` and a percentage.

**Speed:** 0.1× · 0.25× · 0.5× · 0.75× · 1× · 1.5× · 2× · 4× · 8× · 16× · 32× · 64× · **128×**.

**CURRENT STEP** — a sentence describing what the algorithm is doing at this step.

**VARIABLES** — the live values of the algorithm's own variables.

**STATISTICS** — Comparisons · Swaps · Assignments · **Array accesses**.

**SOURCE CODE** — the algorithm's code, shown beside the run.

**COMPLEXITY & PROPERTIES** — a description, then Best case / Average case / Worst case / Space / **Stable** /
**In-place**, then **Use cases**, **Advantages**, **Disadvantages**.
(Bubble Sort: O(n) / O(n²) / O(n²) / O(1) / stable / in-place · "Teaching, tiny arrays" · "Simple, stable" ·
"Very slow on large data".)

## All 84 algorithms

**Sorting (24)** — Bubble · Selection · Insertion · Quick · Randomized Quick · 3-Way Quick · Merge (top-down) ·
Merge (bottom-up) · Heap · Counting · Radix (LSD) · Bucket · Shell · Cocktail Shaker · Comb · Gnome · Cycle ·
Odd-Even · Pancake · Tim Sort (simplified) · Tree Sort · Bitonic · IntroSort · Stooge · Bogo.

**Searching (7)** — Linear · Binary · Jump · Interpolation · Exponential · Fibonacci · Ternary.

**Arrays (13)** — Traversal · Reversal · Rotation · Prefix Sum · Kadane's · Two-Pointer (pair sum) ·
Sliding Window (max sum, size k) · Dutch National Flag · Move Zeros · Remove Duplicates (sorted) · Two Sum (hash) ·
Missing Number · Majority Element (Boyer-Moore).

**Linked Lists (4)** — Reverse · Find Middle (slow/fast) · Detect Cycle (Floyd) · Search.

**Stacks (3)** — Balanced Parentheses · Infix → Postfix · Postfix Evaluation.

**Queues (2)** — BFS Queue Demo · Circular Queue.

**Trees (6)** — BST Insert · BST Search · In-order · Pre-order · Post-order · Level-order (BFS).

**Graphs (2)** — Breadth-First Search · Depth-First Search.

**Shortest Path (3)** — Dijkstra's · Dijkstra (Grid) · A* Search (Grid).

**Dynamic Programming (4)** — Fibonacci DP · Longest Common Subsequence · 0/1 Knapsack · Coin Change (min coins).

**Strings (3)** — Naive String Search · KMP · Rabin-Karp.

**Recursion (3)** — Factorial · Fibonacci · Tower of Hanoi.

**Backtracking (2)** — N-Queens · Permutations.

**Greedy (2)** — Activity Selection · Fractional Knapsack.

**Hashing (2)** — Hash Table (chaining) · Hash Table (linear probing).

## What Orbis has against this

Orbis's Algorithm Laboratory traces a far smaller set and has bars, a graph view and a DP table, a step slider and
counts of comparisons/swaps/reads. It does **not** have: 84 algorithms, a seeded input generator with five shapes, a
transport bar with step-back and skip-5, speeds beyond 1×, a live variables panel, the source code beside the run, or
the complexity/properties card with use cases and trade-offs.
