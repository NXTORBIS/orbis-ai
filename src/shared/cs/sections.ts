/**
 * The Computer Science Studio's sections and algorithms, without the React that renders them.
 *
 * Their rail pairs each section with a lucide icon, and their algorithm registry pairs each algorithm with the
 * generator that traces it. Both are therefore renderer files. The main process needs the same lists so Orion
 * can open a section or an algorithm by name, and it cannot import React — so these are those lists with the
 * components left out.
 *
 * ## It is generated, and guarded
 *
 * Written from the ported studio rather than by hand, and `sections.test.ts` checks the two still agree. A
 * section added to the rail and missing here would be one Orion could not open, which is exactly the kind of gap
 * nobody notices until somebody asks for it.
 */

export interface CSSectionRow {
  label: string
  /** The route their own rail navigates to. */
  route: string
}

export const CS_SECTIONS: readonly CSSectionRow[] = Object.freeze([
  Object.freeze({ label: 'Overview', route: '/cs' }),
  Object.freeze({ label: 'Learn', route: '/cs/learn' }),
  Object.freeze({ label: 'Problems', route: '/cs/problems' }),
  Object.freeze({ label: 'Daily Challenge', route: '/cs/daily' }),
  Object.freeze({ label: 'Contests', route: '/cs/contests' }),
  Object.freeze({ label: 'Programming & Development', route: '/cs/playground' }),
  Object.freeze({ label: 'Algorithms & DSA', route: '/algorithm-lab' }),
  Object.freeze({ label: 'Computer Architecture', route: '/cs/architecture' }),
  Object.freeze({ label: 'Operating Systems', route: '/cs/os' }),
  Object.freeze({ label: 'Computer Networks', route: '/cs/networks' }),
  Object.freeze({ label: 'Databases', route: '/cs/databases' }),
  Object.freeze({ label: 'Digital Logic', route: '/digital-logic-lab' }),
  Object.freeze({ label: 'Compiler Design', route: '/cs/compilers' }),
  Object.freeze({ label: 'Theory of Computation', route: '/cs/theory' }),
  Object.freeze({ label: 'Cybersecurity', route: '/cs/cybersecurity' }),
  Object.freeze({ label: 'AI & Machine Learning', route: '/cs/ai-ml' }),
  Object.freeze({ label: 'Data Science', route: '/cs/data-science' }),
  Object.freeze({ label: 'Computer Graphics', route: '/cs/graphics' }),
  Object.freeze({ label: 'Distributed Systems', route: '/cs/distributed' }),
  Object.freeze({ label: 'Software Engineering', route: '/cs/software-engineering' }),
  Object.freeze({ label: 'Projects', route: '/cs/projects' }),
  Object.freeze({ label: 'Playground', route: '/cs/playground' }),
  Object.freeze({ label: 'Achievements', route: '/cs/progress' }),
  Object.freeze({ label: 'Progress', route: '/cs/progress' }),
])

export interface CSAlgorithmRow {
  id: string
  name: string
  category: string
  /** How the laboratory draws it: an array, a graph, a grid, a tree or a linked list. */
  view: string
  /** Average-case time, in their own words. */
  time: string
  /** Extra space, in their own words. */
  space: string
}

export const CS_ALGORITHMS: readonly CSAlgorithmRow[] = Object.freeze([
  Object.freeze({ id: 'traversal', name: 'Array Traversal', category: 'Arrays', view: 'bar', time: 'O(n)', space: 'O(1)' }),
  Object.freeze({ id: 'reversal', name: 'Array Reversal', category: 'Arrays', view: 'bar', time: 'O(n)', space: 'O(1)' }),
  Object.freeze({ id: 'rotation', name: 'Array Rotation', category: 'Arrays', view: 'bar', time: 'O(n)', space: 'O(1)' }),
  Object.freeze({ id: 'prefixSum', name: 'Prefix Sum', category: 'Arrays', view: 'bar', time: 'O(n)', space: 'O(n)' }),
  Object.freeze({ id: 'kadane', name: 'Kadane\'s Algorithm', category: 'Arrays', view: 'bar', time: 'O(n)', space: 'O(1)' }),
  Object.freeze({ id: 'twoPointer', name: 'Two-Pointer (pair sum)', category: 'Arrays', view: 'bar', time: 'O(n)', space: 'O(1)' }),
  Object.freeze({ id: 'slidingWindow', name: 'Sliding Window (max sum, size k)', category: 'Arrays', view: 'bar', time: 'O(n)', space: 'O(1)' }),
  Object.freeze({ id: 'dutchFlag', name: 'Dutch National Flag', category: 'Arrays', view: 'bar', time: 'O(n)', space: 'O(1)' }),
  Object.freeze({ id: 'moveZeros', name: 'Move Zeros', category: 'Arrays', view: 'bar', time: 'O(n)', space: 'O(1)' }),
  Object.freeze({ id: 'removeDuplicates', name: 'Remove Duplicates (sorted)', category: 'Arrays', view: 'bar', time: 'O(n)', space: 'O(1)' }),
  Object.freeze({ id: 'twoSum', name: 'Two Sum (hash)', category: 'Arrays', view: 'bar', time: 'O(n)', space: 'O(n)' }),
  Object.freeze({ id: 'missingNumber', name: 'Missing Number', category: 'Arrays', view: 'bar', time: 'O(n)', space: 'O(1)' }),
  Object.freeze({ id: 'majorityElement', name: 'Majority Element (Boyer-Moore)', category: 'Arrays', view: 'bar', time: 'O(n)', space: 'O(1)' }),
  Object.freeze({ id: 'nQueens', name: 'N-Queens', category: 'Backtracking', view: 'grid', time: 'O(n!)', space: 'O(n)' }),
  Object.freeze({ id: 'permutations', name: 'Permutations', category: 'Backtracking', view: 'grid', time: 'O(n!)', space: 'O(n)' }),
  Object.freeze({ id: 'fibDP', name: 'Fibonacci DP', category: 'Dynamic Programming', view: 'table', time: 'O(n)', space: 'O(n)' }),
  Object.freeze({ id: 'lcs', name: 'Longest Common Subsequence', category: 'Dynamic Programming', view: 'table', time: 'O(nm)', space: 'O(nm)' }),
  Object.freeze({ id: 'knapsack', name: '0/1 Knapsack', category: 'Dynamic Programming', view: 'table', time: 'O(nW)', space: 'O(nW)' }),
  Object.freeze({ id: 'coinChange', name: 'Coin Change (min coins)', category: 'Dynamic Programming', view: 'table', time: 'O(na)', space: 'O(a)' }),
  Object.freeze({ id: 'editDistance', name: 'Edit Distance (Levenshtein)', category: 'Dynamic Programming', view: 'table', time: 'O(nm)', space: 'O(nm)' }),
  Object.freeze({ id: 'lis', name: 'Longest Increasing Subsequence', category: 'Dynamic Programming', view: 'table', time: 'O(n²)', space: 'O(n)' }),
  Object.freeze({ id: 'lpsDP', name: 'Longest Palindromic Subsequence', category: 'Dynamic Programming', view: 'table', time: 'O(n²)', space: 'O(n²)' }),
  Object.freeze({ id: 'rodCutting', name: 'Rod Cutting', category: 'Dynamic Programming', view: 'table', time: 'O(n²)', space: 'O(n)' }),
  Object.freeze({ id: 'topologicalSort', name: 'Topological Sort (Kahn)', category: 'Graphs', view: 'graph', time: 'O(V+E)', space: 'O(V)' }),
  Object.freeze({ id: 'bellmanFord', name: 'Bellman-Ford', category: 'Shortest Path', view: 'graph', time: 'O(VE)', space: 'O(V)' }),
  Object.freeze({ id: 'primMST', name: 'Prim\'s MST', category: 'Graphs', view: 'graph', time: 'O(V²)', space: 'O(V)' }),
  Object.freeze({ id: 'kruskalMST', name: 'Kruskal\'s MST', category: 'Graphs', view: 'graph', time: 'O(E log E)', space: 'O(V)' }),
  Object.freeze({ id: 'bfs', name: 'Breadth-First Search', category: 'Graphs', view: 'graph', time: 'O(V+E)', space: 'O(V)' }),
  Object.freeze({ id: 'dfs', name: 'Depth-First Search', category: 'Graphs', view: 'graph', time: 'O(V+E)', space: 'O(V)' }),
  Object.freeze({ id: 'dijkstra', name: 'Dijkstra\'s Algorithm', category: 'Shortest Path', view: 'graph', time: 'O(E log V)', space: 'O(V)' }),
  Object.freeze({ id: 'activitySelection', name: 'Activity Selection', category: 'Greedy', view: 'greedy', time: 'O(n log n)', space: 'O(1)' }),
  Object.freeze({ id: 'fractionalKnapsack', name: 'Fractional Knapsack', category: 'Greedy', view: 'greedy', time: 'O(n log n)', space: 'O(1)' }),
  Object.freeze({ id: 'hashChaining', name: 'Hash Table (chaining)', category: 'Hashing', view: 'buckets', time: 'O(1)', space: 'O(n)' }),
  Object.freeze({ id: 'hashProbing', name: 'Hash Table (linear probing)', category: 'Hashing', view: 'buckets', time: 'O(1)', space: 'O(n)' }),
  Object.freeze({ id: 'listReverse', name: 'Linked List Reverse', category: 'Linked Lists', view: 'list', time: 'O(n)', space: 'O(1)' }),
  Object.freeze({ id: 'listMiddle', name: 'Find Middle (slow/fast)', category: 'Linked Lists', view: 'list', time: 'O(n)', space: 'O(1)' }),
  Object.freeze({ id: 'listCycleDetect', name: 'Detect Cycle (Floyd)', category: 'Linked Lists', view: 'list', time: 'O(n)', space: 'O(1)' }),
  Object.freeze({ id: 'listSearch', name: 'Linked List Search', category: 'Linked Lists', view: 'list', time: 'O(n)', space: 'O(1)' }),
  Object.freeze({ id: 'gridDijkstra', name: 'Dijkstra (Grid)', category: 'Shortest Path', view: 'pathgrid', time: 'O(E log V)', space: 'O(V)' }),
  Object.freeze({ id: 'gridAStar', name: 'A* Search (Grid)', category: 'Shortest Path', view: 'pathgrid', time: 'O(E log V)', space: 'O(V)' }),
  Object.freeze({ id: 'gridGreedy', name: 'Greedy Best-First (Grid)', category: 'Shortest Path', view: 'pathgrid', time: 'O(E log V)', space: 'O(V)' }),
  Object.freeze({ id: 'gridBidirectional', name: 'Bidirectional BFS (Grid)', category: 'Shortest Path', view: 'pathgrid', time: 'O(V)', space: 'O(V)' }),
  Object.freeze({ id: 'gridDFS', name: 'DFS Maze Walk (Grid)', category: 'Shortest Path', view: 'pathgrid', time: 'O(V+E)', space: 'O(V)' }),
  Object.freeze({ id: 'bfsQueue', name: 'BFS Queue Demo', category: 'Queues', view: 'queue', time: 'O(V+E)', space: 'O(V)' }),
  Object.freeze({ id: 'circularQueue', name: 'Circular Queue', category: 'Queues', view: 'queue', time: 'O(1)', space: 'O(k)' }),
  Object.freeze({ id: 'factorial', name: 'Factorial (recursion)', category: 'Recursion', view: 'tree', time: 'O(n)', space: 'O(n)' }),
  Object.freeze({ id: 'fibRec', name: 'Fibonacci (recursion)', category: 'Recursion', view: 'tree', time: 'O(2^n)', space: 'O(n)' }),
  Object.freeze({ id: 'hanoi', name: 'Tower of Hanoi', category: 'Recursion', view: 'hanoi', time: 'O(2^n)', space: 'O(n)' }),
  Object.freeze({ id: 'linearSearch', name: 'Linear Search', category: 'Searching', view: 'bar', time: 'O(n)', space: 'O(1)' }),
  Object.freeze({ id: 'binarySearch', name: 'Binary Search', category: 'Searching', view: 'bar', time: 'O(log n)', space: 'O(1)' }),
  Object.freeze({ id: 'jumpSearch', name: 'Jump Search', category: 'Searching', view: 'bar', time: 'O(√n)', space: 'O(1)' }),
  Object.freeze({ id: 'interpolationSearch', name: 'Interpolation Search', category: 'Searching', view: 'bar', time: 'O(log log n)', space: 'O(1)' }),
  Object.freeze({ id: 'exponentialSearch', name: 'Exponential Search', category: 'Searching', view: 'bar', time: 'O(log n)', space: 'O(1)' }),
  Object.freeze({ id: 'fibonacciSearch', name: 'Fibonacci Search', category: 'Searching', view: 'bar', time: 'O(log n)', space: 'O(1)' }),
  Object.freeze({ id: 'ternarySearch', name: 'Ternary Search', category: 'Searching', view: 'bar', time: 'O(log₃ n)', space: 'O(1)' }),
  Object.freeze({ id: 'bubbleSort', name: 'Bubble Sort', category: 'Sorting', view: 'bar', time: 'O(n²)', space: 'O(1)' }),
  Object.freeze({ id: 'selectionSort', name: 'Selection Sort', category: 'Sorting', view: 'bar', time: 'O(n²)', space: 'O(1)' }),
  Object.freeze({ id: 'insertionSort', name: 'Insertion Sort', category: 'Sorting', view: 'bar', time: 'O(n²)', space: 'O(1)' }),
  Object.freeze({ id: 'quickSort', name: 'Quick Sort', category: 'Sorting', view: 'bar', time: 'O(n log n)', space: 'O(log n)' }),
  Object.freeze({ id: 'randomizedQuickSort', name: 'Randomized Quick Sort', category: 'Sorting', view: 'bar', time: 'O(n log n)', space: 'O(log n)' }),
  Object.freeze({ id: 'threeWayQuickSort', name: '3-Way Quick Sort', category: 'Sorting', view: 'bar', time: 'O(n log n)', space: 'O(log n)' }),
  Object.freeze({ id: 'mergeSort', name: 'Merge Sort (top-down)', category: 'Sorting', view: 'bar', time: 'O(n log n)', space: 'O(n)' }),
  Object.freeze({ id: 'mergeSortBottomUp', name: 'Merge Sort (bottom-up)', category: 'Sorting', view: 'bar', time: 'O(n log n)', space: 'O(n)' }),
  Object.freeze({ id: 'heapSort', name: 'Heap Sort', category: 'Sorting', view: 'bar', time: 'O(n log n)', space: 'O(1)' }),
  Object.freeze({ id: 'countingSort', name: 'Counting Sort', category: 'Sorting', view: 'bar', time: 'O(n+k)', space: 'O(n+k)' }),
  Object.freeze({ id: 'radixSort', name: 'Radix Sort (LSD)', category: 'Sorting', view: 'bar', time: 'O(nk)', space: 'O(n+k)' }),
  Object.freeze({ id: 'bucketSort', name: 'Bucket Sort', category: 'Sorting', view: 'bar', time: 'O(n+k)', space: 'O(n+k)' }),
  Object.freeze({ id: 'shellSort', name: 'Shell Sort', category: 'Sorting', view: 'bar', time: 'O(n^1.25)', space: 'O(1)' }),
  Object.freeze({ id: 'cocktailSort', name: 'Cocktail Shaker Sort', category: 'Sorting', view: 'bar', time: 'O(n²)', space: 'O(1)' }),
  Object.freeze({ id: 'combSort', name: 'Comb Sort', category: 'Sorting', view: 'bar', time: 'O(n²/2^p)', space: 'O(1)' }),
  Object.freeze({ id: 'gnomeSort', name: 'Gnome Sort', category: 'Sorting', view: 'bar', time: 'O(n²)', space: 'O(1)' }),
  Object.freeze({ id: 'cycleSort', name: 'Cycle Sort', category: 'Sorting', view: 'bar', time: 'O(n²)', space: 'O(1)' }),
  Object.freeze({ id: 'oddEvenSort', name: 'Odd-Even Sort', category: 'Sorting', view: 'bar', time: 'O(n²)', space: 'O(1)' }),
  Object.freeze({ id: 'pancakeSort', name: 'Pancake Sort', category: 'Sorting', view: 'bar', time: 'O(n²)', space: 'O(1)' }),
  Object.freeze({ id: 'timSort', name: 'Tim Sort (simplified)', category: 'Sorting', view: 'bar', time: 'O(n log n)', space: 'O(n)' }),
  Object.freeze({ id: 'treeSort', name: 'Tree Sort', category: 'Sorting', view: 'tree', time: 'O(n log n)', space: 'O(n)' }),
  Object.freeze({ id: 'bitonicSort', name: 'Bitonic Sort', category: 'Sorting', view: 'bar', time: 'O(log²n)', space: 'O(n log n)' }),
  Object.freeze({ id: 'introSort', name: 'IntroSort', category: 'Sorting', view: 'bar', time: 'O(n log n)', space: 'O(log n)' }),
  Object.freeze({ id: 'stoogeSort', name: 'Stooge Sort', category: 'Sorting', view: 'bar', time: 'O(n^2.71)', space: 'O(n)' }),
  Object.freeze({ id: 'bogoSort', name: 'Bogo Sort', category: 'Sorting', view: 'bar', time: 'O(n·n!)', space: 'O(1)' }),
  Object.freeze({ id: 'balancedParens', name: 'Balanced Parentheses', category: 'Stacks', view: 'stack', time: 'O(n)', space: 'O(n)' }),
  Object.freeze({ id: 'infixToPostfix', name: 'Infix → Postfix', category: 'Stacks', view: 'stack', time: 'O(n)', space: 'O(n)' }),
  Object.freeze({ id: 'postfixEval', name: 'Postfix Evaluation', category: 'Stacks', view: 'stack', time: 'O(n)', space: 'O(n)' }),
  Object.freeze({ id: 'naiveSearch', name: 'Naive String Search', category: 'Strings', view: 'string', time: 'O(nm)', space: 'O(1)' }),
  Object.freeze({ id: 'kmp', name: 'KMP', category: 'Strings', view: 'string', time: 'O(n+m)', space: 'O(m)' }),
  Object.freeze({ id: 'rabinKarp', name: 'Rabin-Karp', category: 'Strings', view: 'string', time: 'O(n+m)', space: 'O(1)' }),
  Object.freeze({ id: 'bstInsert', name: 'BST Insert', category: 'Trees', view: 'tree', time: 'O(log n)', space: 'O(n)' }),
  Object.freeze({ id: 'bstSearch', name: 'BST Search', category: 'Trees', view: 'tree', time: 'O(log n)', space: 'O(1)' }),
  Object.freeze({ id: 'inorder', name: 'In-order Traversal', category: 'Trees', view: 'tree', time: 'O(n)', space: 'O(h)' }),
  Object.freeze({ id: 'preorder', name: 'Pre-order Traversal', category: 'Trees', view: 'tree', time: 'O(n)', space: 'O(h)' }),
  Object.freeze({ id: 'postorder', name: 'Post-order Traversal', category: 'Trees', view: 'tree', time: 'O(n)', space: 'O(h)' }),
  Object.freeze({ id: 'levelorder', name: 'Level-order Traversal (BFS)', category: 'Trees', view: 'tree', time: 'O(n)', space: 'O(w)' }),
])

export const CS_CATEGORIES: readonly string[] = Object.freeze([
  ...new Set(CS_ALGORITHMS.map((one) => one.category))
])

/**
 * Which section somebody meant.
 *
 * Returns the one match, the several it could be, or null. Several is never narrowed by guessing: "data" matches
 * both Data Science and Databases, and picking one would open the wrong screen with no sign that it had.
 */
export function findCSSection(asked: string): CSSectionRow | readonly CSSectionRow[] | null {
  const tidy = (text: string): string => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const want = tidy(asked)
  if (want === '') return null
  const exact = CS_SECTIONS.filter((one) => tidy(one.label) === want)
  if (exact.length === 1) return exact[0]
  const inside = CS_SECTIONS.filter((one) => tidy(one.label).includes(want))
  if (inside.length === 1) return inside[0]
  return inside.length > 1 ? Object.freeze(inside) : null
}

/** Which algorithm somebody meant, by id or by name. */
export function findCSAlgorithm(asked: string): CSAlgorithmRow | readonly CSAlgorithmRow[] | null {
  const tidy = (text: string): string => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const want = tidy(asked)
  if (want === '') return null
  const byId = CS_ALGORITHMS.filter((one) => one.id.toLowerCase() === want.replace(/ /g, ''))
  if (byId.length === 1) return byId[0]
  const exact = CS_ALGORITHMS.filter((one) => tidy(one.name) === want)
  if (exact.length === 1) return exact[0]
  const inside = CS_ALGORITHMS.filter((one) => tidy(one.name).includes(want))
  if (inside.length === 1) return inside[0]
  return inside.length > 1 ? Object.freeze(inside) : null
}

export const CS_COUNTS = Object.freeze({
  sections: CS_SECTIONS.length,
  algorithms: CS_ALGORITHMS.length,
  categories: CS_CATEGORIES.length
})
