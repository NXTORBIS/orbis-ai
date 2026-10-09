// Real problem library for the Computer Science Studio.
// Each problem carries genuine descriptions, examples, constraints, per-language
// starter code, sample + hidden test cases, complexity, and hints.
// Judging is performed server-side against test cases (hidden ones never reach the browser).

export const DIFFICULTY_XP = { Easy: 25, Medium: 50, Hard: 100, Expert: 200 };

export const PROBLEMS = [
  {
    id: '0001', number: 1, slug: 'two-sum', title: 'Two Sum', difficulty: 'Easy',
    topics: ['Array', 'Hash Table'], acceptance: 54.2,
    description: 'Given an array of integers `nums` and an integer `target`, return the indices of the two numbers such that they add up to `target`.\n\nYou may assume that each input has exactly one solution, and you may not use the same element twice. You can return the answer in any order.',
    examples: [
      { input: 'nums = [2,7,11,15], target = 9', output: '[0,1]', explanation: 'Because nums[0] + nums[1] == 9, we return [0,1].' },
      { input: 'nums = [3,2,4], target = 6', output: '[1,2]' },
      { input: 'nums = [3,3], target = 6', output: '[0,1]' },
    ],
    constraints: ['2 <= nums.length <= 10^4', '-10^9 <= nums[i] <= 10^9', '-10^9 <= target <= 10^9', 'Only one valid answer exists.'],
    starter: {
      python: 'class Solution:\n    def twoSum(self, nums, target):\n        pass\n',
      cpp: 'class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        \n    }\n};\n',
      java: 'class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        \n    }\n}\n',
      javascript: 'function twoSum(nums, target) {\n    \n}\n',
      c: 'int* twoSum(int* nums, int numsSize, int target, int* returnSize) {\n    \n}\n',
      typescript: 'function twoSum(nums: number[], target: number): number[] {\n    \n}\n',
    },
    tests: [
      { input: '4\n2 7 11 15\n9', expected: '0 1' },
      { input: '3\n3 2 4\n6', expected: '1 2' },
      { input: '2\n3 3\n6', expected: '0 1' },
      { input: '5\n1 5 8 3 4\n9', expected: '1 3', hidden: true },
    ],
    complexity: { time: 'O(n)', space: 'O(n)' },
    hints: ['A hash table can reduce the lookup from O(n) to O(1).', 'For each element, check if its complement has been seen before.'],
    xp: DIFFICULTY_XP.Easy,
  },
  {
    id: '0002', number: 2, slug: 'reverse-linked-list', title: 'Reverse Linked List', difficulty: 'Easy',
    topics: ['Linked List', 'Pointers'], acceptance: 72.5,
    description: 'Given the head of a singly linked list, reverse the list and return the new head.',
    examples: [
      { input: 'head = [1,2,3,4,5]', output: '[5,4,3,2,1]' },
      { input: 'head = [1,2]', output: '[2,1]' },
    ],
    constraints: ['The number of nodes is in the range [0, 5000].', '-5000 <= Node.val <= 5000'],
    starter: {
      python: 'class ListNode:\n    def __init__(self, val=0, next=None):\n        self.val = val\n        self.next = next\nclass Solution:\n    def reverseList(self, head):\n        pass\n',
      cpp: 'struct ListNode { int val; ListNode *next; ListNode(int x): val(x), next(nullptr) {} };\nclass Solution {\npublic:\n    ListNode* reverseList(ListNode* head) {\n        \n    }\n};\n',
      java: 'class ListNode { int val; ListNode next; ListNode(int x){val=x;} }\nclass Solution {\n    public ListNode reverseList(ListNode head) {\n        \n    }\n}\n',
    },
    tests: [
      { input: '5\n1 2 3 4 5', expected: '5 4 3 2 1' },
      { input: '2\n1 2', expected: '2 1' },
      { input: '0', expected: '', hidden: true },
    ],
    complexity: { time: 'O(n)', space: 'O(1)' },
    hints: ['Use three pointers: prev, curr, next.', 'Iteratively flip each next pointer.'],
    xp: DIFFICULTY_XP.Easy,
  },
  {
    id: '0003', number: 3, slug: 'valid-parentheses', title: 'Valid Parentheses', difficulty: 'Easy',
    topics: ['Stack', 'String'], acceptance: 61.0,
    description: 'Given a string `s` containing just the characters `(`, `)`, `{`, `}`, `[` and `]`, determine if the input string is valid.\n\nA string is valid if open brackets are closed by the same type of brackets and in the correct order.',
    examples: [
      { input: 's = "()"', output: 'true' },
      { input: 's = "()[]{}"', output: 'true' },
      { input: 's = "(]"', output: 'false' },
    ],
    constraints: ['1 <= s.length <= 10^4', 's consists of parentheses only.'],
    starter: {
      python: 'class Solution:\n    def isValid(self, s: str) -> bool:\n        pass\n',
      cpp: 'class Solution {\npublic:\n    bool isValid(string s) {\n        \n    }\n};\n',
      java: 'class Solution {\n    public boolean isValid(String s) {\n        \n    }\n}\n',
      javascript: 'function isValid(s) {\n    \n}\n',
    },
    tests: [
      { input: '()', expected: 'true' },
      { input: '()[]{}', expected: 'true' },
      { input: '(]', expected: 'false' },
      { input: '([)]', expected: 'false', hidden: true },
      { input: '{[]}', expected: 'true', hidden: true },
    ],
    complexity: { time: 'O(n)', space: 'O(n)' },
    hints: ['Use a stack.', 'A closing bracket must match the most recent opening one.'],
    xp: DIFFICULTY_XP.Easy,
  },
  {
    id: '0004', number: 4, slug: 'binary-search', title: 'Binary Search', difficulty: 'Easy',
    topics: ['Array', 'Binary Search'], acceptance: 55.3,
    description: 'Given a sorted array of integers `nums` and an integer `target`, write a function to search `target` in `nums`. If `target` exists, return its index. Otherwise, return -1.\n\nYou must write an algorithm with O(log n) runtime complexity.',
    examples: [
      { input: 'nums = [-1,0,3,5,9,12], target = 9', output: '4' },
      { input: 'nums = [-1,0,3,5,9,12], target = 2', output: '-1' },
    ],
    constraints: ['All values are distinct.', 'nums is sorted in ascending order.'],
    starter: {
      python: 'class Solution:\n    def search(self, nums, target):\n        pass\n',
      cpp: 'class Solution {\npublic:\n    int search(vector<int>& nums, int target) {\n        \n    }\n};\n',
      java: 'class Solution {\n    public int search(int[] nums, int target) {\n        \n    }\n}\n',
    },
    tests: [
      { input: '6\n-1 0 3 5 9 12\n9', expected: '4' },
      { input: '6\n-1 0 3 5 9 12\n2', expected: '-1' },
      { input: '1\n5\n5', expected: '0', hidden: true },
    ],
    complexity: { time: 'O(log n)', space: 'O(1)' },
    hints: ['Maintain lo and hi bounds.', 'Compare the middle element to decide which half to keep.'],
    xp: DIFFICULTY_XP.Easy,
  },
  {
    id: '0005', number: 5, slug: 'maximum-subarray', title: 'Maximum Subarray', difficulty: 'Medium',
    topics: ['Array', 'Dynamic Programming', 'Divide and Conquer'], acceptance: 50.1,
    description: 'Given an integer array `nums`, find the subarray with the largest sum and return its sum.',
    examples: [
      { input: 'nums = [-2,1,-3,4,-1,2,1,-5,4]', output: '6', explanation: 'The subarray [4,-1,2,1] has the largest sum 6.' },
      { input: 'nums = [1]', output: '1' },
      { input: 'nums = [5,4,-1,7,8]', output: '23' },
    ],
    constraints: ['1 <= nums.length <= 10^5', '-10^4 <= nums[i] <= 10^4'],
    starter: {
      python: 'class Solution:\n    def maxSubArray(self, nums):\n        pass\n',
      cpp: 'class Solution {\npublic:\n    int maxSubArray(vector<int>& nums) {\n        \n    }\n};\n',
      java: 'class Solution {\n    public int maxSubArray(int[] nums) {\n        \n    }\n}\n',
    },
    tests: [
      { input: '9\n-2 1 -3 4 -1 2 1 -5 4', expected: '6' },
      { input: '1\n1', expected: '1' },
      { input: '5\n5 4 -1 7 8', expected: '23' },
      { input: '3\n-1 -2 -3', expected: '-1', hidden: true },
    ],
    complexity: { time: 'O(n)', space: 'O(1)' },
    hints: ['Kadane\'s algorithm: keep a running sum, reset to 0 when negative.', 'Track the best sum seen.'],
    xp: DIFFICULTY_XP.Medium,
  },
  {
    id: '0006', number: 6, slug: 'longest-substring-without-repeating', title: 'Longest Substring Without Repeating Characters', difficulty: 'Medium',
    topics: ['String', 'Sliding Window', 'Hash Table'], acceptance: 33.8,
    description: 'Given a string `s`, find the length of the longest substring without repeating characters.',
    examples: [
      { input: 's = "abcabcbb"', output: '3', explanation: 'The answer is "abc", length 3.' },
      { input: 's = "bbbbb"', output: '1' },
      { input: 's = "pwwkew"', output: '3', explanation: 'The answer is "wke", length 3.' },
    ],
    constraints: ['0 <= s.length <= 5 * 10^4', 's consists of English letters, digits, symbols and spaces.'],
    starter: {
      python: 'class Solution:\n    def lengthOfLongestSubstring(self, s: str) -> int:\n        pass\n',
      cpp: 'class Solution {\npublic:\n    int lengthOfLongestSubstring(string s) {\n        \n    }\n};\n',
      java: 'class Solution {\n    public int lengthOfLongestSubstring(String s) {\n        \n    }\n}\n',
    },
    tests: [
      { input: 'abcabcbb', expected: '3' },
      { input: 'bbbbb', expected: '1' },
      { input: 'pwwkew', expected: '3' },
      { input: ' ', expected: '1', hidden: true },
      { input: 'dvdf', expected: '3', hidden: true },
    ],
    complexity: { time: 'O(n)', space: 'O(min(n, alphabet))' },
    hints: ['Use a sliding window with two pointers.', 'Track the last seen index of each character.'],
    xp: DIFFICULTY_XP.Medium,
  },
  {
    id: '0007', number: 7, slug: 'merge-two-sorted-lists', title: 'Merge Two Sorted Lists', difficulty: 'Easy',
    topics: ['Linked List', 'Recursion'], acceptance: 68.2,
    description: 'Merge two sorted linked lists and return it as a sorted list. The list should be made by splicing together the nodes of the first two lists.',
    examples: [
      { input: 'l1 = [1,2,4], l2 = [1,3,4]', output: '[1,1,2,3,4,4]' },
      { input: 'l1 = [], l2 = []', output: '[]' },
    ],
    constraints: ['The number of nodes in both lists is in the range [0, 50].', 'Lists are sorted in non-decreasing order.'],
    starter: {
      python: 'class ListNode:\n    def __init__(self, val=0, next=None):\n        self.val = val; self.next = next\nclass Solution:\n    def mergeTwoLists(self, l1, l2):\n        pass\n',
      cpp: 'struct ListNode { int val; ListNode *next; ListNode(int x): val(x), next(nullptr) {} };\nclass Solution {\npublic:\n    ListNode* mergeTwoLists(ListNode* l1, ListNode* l2) {\n        \n    }\n};\n',
    },
    tests: [
      { input: '3\n1 2 4\n3\n1 3 4', expected: '1 1 2 3 4 4' },
      { input: '0\n0', expected: '' },
    ],
    complexity: { time: 'O(n+m)', space: 'O(1)' },
    hints: ['Use a dummy head node.', 'Repeatedly attach the smaller front node.'],
    xp: DIFFICULTY_XP.Easy,
  },
  {
    id: '0008', number: 8, slug: 'climbing-stairs', title: 'Climbing Stairs', difficulty: 'Easy',
    topics: ['Dynamic Programming', 'Math'], acceptance: 52.4,
    description: 'You are climbing a staircase. It takes `n` steps to reach the top. Each time you can climb 1 or 2 steps. In how many distinct ways can you climb to the top?',
    examples: [
      { input: 'n = 2', output: '2', explanation: '1+1 or 2.' },
      { input: 'n = 3', output: '3', explanation: '1+1+1, 1+2, 2+1.' },
    ],
    constraints: ['1 <= n <= 45'],
    starter: {
      python: 'class Solution:\n    def climbStairs(self, n: int) -> int:\n        pass\n',
      cpp: 'class Solution {\npublic:\n    int climbStairs(int n) {\n        \n    }\n};\n',
      java: 'class Solution {\n    public int climbStairs(int n) {\n        \n    }\n}\n',
    },
    tests: [
      { input: '2', expected: '2' },
      { input: '3', expected: '3' },
      { input: '5', expected: '8', hidden: true },
      { input: '45', expected: '1836311903', hidden: true },
    ],
    complexity: { time: 'O(n)', space: 'O(1)' },
    hints: ['This is the Fibonacci sequence.', 'dp[i] = dp[i-1] + dp[i-2].'],
    xp: DIFFICULTY_XP.Easy,
  },
  {
    id: '0009', number: 9, slug: 'dijkstra-shortest-path', title: 'Shortest Path (Dijkstra)', difficulty: 'Medium',
    topics: ['Graph', 'Heap', 'Shortest Path'], acceptance: 41.7,
    description: 'Given a weighted directed graph with non-negative edge weights, the source node index `S`, and the number of nodes `n` (labeled 0..n-1), output the shortest distance from `S` to every node. Use -1 for unreachable nodes.\n\nInput format: first line `n m S`, then `m` lines `u v w`.',
    examples: [
      { input: '4 4 0\n0 1 1\n0 2 4\n1 2 2\n2 3 1', output: '0 1 3 4' },
    ],
    constraints: ['1 <= n <= 10^5', '0 <= m <= 2*10^5', '0 <= w <= 10^4'],
    starter: {
      python: 'import heapq\ndef solve(n, m, s, edges):\n    pass\n',
      cpp: 'class Solution {\npublic:\n    vector<long long> dijkstra(int n, int s, vector<vector<array<int,2>>>& g) {\n        \n    }\n};\n',
    },
    tests: [
      { input: '4 4 0\n0 1 1\n0 2 4\n1 2 2\n2 3 1', expected: '0 1 3 4' },
      { input: '3 1 0\n0 1 5', expected: '0 5 -1', hidden: true },
    ],
    complexity: { time: 'O((n+m) log n)', space: 'O(n+m)' },
    hints: ['Use a min-heap keyed by distance.', 'Relax edges when a shorter distance is found.'],
    xp: DIFFICULTY_XP.Medium,
  },
  {
    id: '0010', number: 10, slug: 'lru-cache', title: 'LRU Cache', difficulty: 'Medium',
    topics: ['Hash Table', 'Linked List', 'Design'], acceptance: 39.6,
    description: 'Design a data structure that follows the constraints of a Least Recently Used (LRU) cache. Implement `get(key)` returning the value or -1 if absent, and `put(key, value)` updating/inserting. When the cache reaches capacity, evict the least recently used item. Both operations must run in O(1) average time.',
    examples: [
      { input: 'capacity = 2; put(1,1); put(2,2); get(1); put(3,3); get(2); put(4,4); get(1); get(3); get(4)', output: '1 -1 -1 3 4' },
    ],
    constraints: ['1 <= capacity <= 3000', '0 <= key <= 10^4'],
    starter: {
      python: 'class LRUCache:\n    def __init__(self, capacity: int):\n        pass\n    def get(self, key: int) -> int:\n        pass\n    def put(self, key: int, value: int) -> None:\n        pass\n',
      cpp: 'class LRUCache {\npublic:\n    LRUCache(int capacity) {}\n    int get(int key) {}\n    void put(int key, int value) {}\n};\n',
    },
    tests: [
      { input: '2\nput 1 1\nput 2 2\nget 1\nput 3 3\nget 2\nput 4 4\nget 1\nget 3\nget 4', expected: '1 -1 -1 3 4' },
    ],
    complexity: { time: 'O(1) per op', space: 'O(capacity)' },
    hints: ['Combine a hash map with a doubly linked list.', 'Move a node to the head on access.'],
    xp: DIFFICULTY_XP.Medium,
  },
  {
    id: '0011', number: 11, slug: 'word-ladder', title: 'Word Ladder', difficulty: 'Hard',
    topics: ['BFS', 'Graph', 'Hash Table'], acceptance: 36.2,
    description: 'Given two words `beginWord` and `endWord`, and a dictionary `wordList`, return the number of words in the shortest transformation sequence from `beginWord` to `endWord`, where each transformed word differs by exactly one letter and must be in `wordList`. Return 0 if no such sequence exists.',
    examples: [
      { input: 'beginWord = "hit", endWord = "cog", wordList = ["hot","dot","dog","lot","log","cog"]', output: '5' },
    ],
    constraints: ['1 <= beginWord.length <= 10', 'wordList[i] has the same length as beginWord', 'All words are unique.'],
    starter: {
      python: 'class Solution:\n    def ladderLength(self, beginWord: str, endWord: str, wordList) -> int:\n        pass\n',
      cpp: 'class Solution {\npublic:\n    int ladderLength(string beginWord, string endWord, vector<string>& wordList) {\n        \n    }\n};\n',
    },
    tests: [
      { input: 'hit cog 6 hot dot dog lot log cog', expected: '5' },
      { input: 'hit cog 4 hot dot dog lot', expected: '0', hidden: true },
    ],
    complexity: { time: 'O(n * L^2)', space: 'O(n * L)' },
    hints: ['BFS over words as nodes.', 'Generate all one-letter wildcard patterns as adjacency keys.'],
    xp: DIFFICULTY_XP.Hard,
  },
  {
    id: '0012', number: 12, slug: 'trapping-rain-water', title: 'Trapping Rain Water', difficulty: 'Hard',
    topics: ['Array', 'Two Pointers', 'Stack'], acceptance: 58.9,
    description: 'Given `n` non-negative integers representing an elevation map where the width of each bar is 1, compute how much water it can trap after raining.',
    examples: [
      { input: 'height = [0,1,0,2,1,0,1,3,2,1,2,1]', output: '6' },
      { input: 'height = [4,2,0,3,2,5]', output: '9' },
    ],
    constraints: ['n == height.length', '1 <= n <= 3 * 10^4', '0 <= height[i] <= 10^4'],
    starter: {
      python: 'class Solution:\n    def trap(self, height) -> int:\n        pass\n',
      cpp: 'class Solution {\npublic:\n    int trap(vector<int>& height) {\n        \n    }\n};\n',
      java: 'class Solution {\n    public int trap(int[] height) {\n        \n    }\n}\n',
    },
    tests: [
      { input: '12\n0 1 0 2 1 0 1 3 2 1 2 1', expected: '6' },
      { input: '6\n4 2 0 3 2 5', expected: '9' },
      { input: '1\n0', expected: '0', hidden: true },
    ],
    complexity: { time: 'O(n)', space: 'O(1)' },
    hints: ['Two pointers from both ends.', 'Water at i = min(maxLeft, maxRight) - height[i].'],
    xp: DIFFICULTY_XP.Hard,
  },
  {
    id: '0013', number: 13, slug: 'number-of-islands', title: 'Number of Islands', difficulty: 'Medium',
    topics: ['Graph', 'DFS', 'BFS', 'Matrix'], acceptance: 57.4,
    description: 'Given an `m x n` 2D binary grid which represents a map of \'1\' (land) and \'0\' (water), return the number of islands. An island is surrounded by water and formed by connecting adjacent lands horizontally or vertically.',
    examples: [
      { input: 'grid = [["1","1","0"],["1","0","0"],["0","0","1"]]', output: '2' },
    ],
    constraints: ['m == grid.length', 'n == grid[i].length', '1 <= m, n <= 300'],
    starter: {
      python: 'class Solution:\n    def numIslands(self, grid) -> int:\n        pass\n',
      cpp: 'class Solution {\npublic:\n    int numIslands(vector<vector<char>>& grid) {\n        \n    }\n};\n',
    },
    tests: [
      { input: '3 3\n1 1 0\n1 0 0\n0 0 1', expected: '2' },
      { input: '1 1\n1', expected: '1', hidden: true },
    ],
    complexity: { time: 'O(m*n)', space: 'O(m*n)' },
    hints: ['Traverse and sink visited land.', 'Count components via DFS/BFS.'],
    xp: DIFFICULTY_XP.Medium,
  },
  {
    id: '0014', number: 14, slug: 'median-of-two-sorted-arrays', title: 'Median of Two Sorted Arrays', difficulty: 'Hard',
    topics: ['Array', 'Binary Search', 'Divide and Conquer'], acceptance: 38.1,
    description: 'Given two sorted arrays `nums1` and `nums2` of sizes `m` and `n`, return the median of the two sorted arrays. The overall run time complexity must be O(log (m+n)).',
    examples: [
      { input: 'nums1 = [1,3], nums2 = [2]', output: '2.00000' },
      { input: 'nums1 = [1,2], nums2 = [3,4]', output: '2.50000' },
    ],
    constraints: ['nums1.length == m', 'nums2.length == n', '0 <= m, n <= 1000', '1 <= m + n <= 2000'],
    starter: {
      python: 'class Solution:\n    def findMedianSortedArrays(self, nums1, nums2) -> float:\n        pass\n',
      cpp: 'class Solution {\npublic:\n    double findMedianSortedArrays(vector<int>& nums1, vector<int>& nums2) {\n        \n    }\n};\n',
    },
    tests: [
      { input: '2\n1 3\n1\n2', expected: '2.0' },
      { input: '2\n1 2\n2\n3 4', expected: '2.5' },
      { input: '0\n1\n1', expected: '1.0', hidden: true },
    ],
    complexity: { time: 'O(log(min(m,n)))', space: 'O(1)' },
    hints: ['Binary search on the smaller array.', 'Partition so that left halves contain the lower half of merged values.'],
    xp: DIFFICULTY_XP.Hard,
  },
  {
    id: '0015', number: 15, slug: 'regular-expression-matching', title: 'Regular Expression Matching', difficulty: 'Hard',
    topics: ['Dynamic Programming', 'String', 'Recursion'], acceptance: 28.9,
    description: 'Given an input string `s` and a pattern `p`, implement regular expression matching with support for `.` and `*` where `*` matches zero or more of the preceding element. The matching should cover the entire input string (not partial).',
    examples: [
      { input: 's = "aa", p = "a"', output: 'false' },
      { input: 's = "aa", p = "a*"', output: 'true' },
      { input: 's = "ab", p = ".*"', output: 'true' },
    ],
    constraints: ['1 <= s.length <= 20', '1 <= p.length <= 20', 's contains only lowercase letters.', 'p contains lowercase letters, . and *.'],
    starter: {
      python: 'class Solution:\n    def isMatch(self, s: str, p: str) -> bool:\n        pass\n',
      cpp: 'class Solution {\npublic:\n    bool isMatch(string s, string p) {\n        \n    }\n};\n',
    },
    tests: [
      { input: 'aa a', expected: 'false' },
      { input: 'aa a*', expected: 'true' },
      { input: 'ab .*', expected: 'true' },
      { input: 'aab c*a*b', expected: 'true', hidden: true },
    ],
    complexity: { time: 'O(m*n)', space: 'O(m*n)' },
    hints: ['Use DP where dp[i][j] means s[:i] matches p[:j].', 'Handle "*" as zero or more of the previous char.'],
    xp: DIFFICULTY_XP.Hard,
  },
  {
    id: '0016', number: 16, slug: 'n-queens', title: 'N-Queens', difficulty: 'Expert',
    topics: ['Backtracking', 'Recursion'], acceptance: 64.0,
    description: 'Place `n` queens on an `n x n` chessboard such that no two queens attack each other. Return the number of distinct solutions.',
    examples: [
      { input: 'n = 4', output: '2' },
      { input: 'n = 1', output: '1' },
    ],
    constraints: ['1 <= n <= 9'],
    starter: {
      python: 'class Solution:\n    def totalNQueens(self, n: int) -> int:\n        pass\n',
      cpp: 'class Solution {\npublic:\n    int totalNQueens(int n) {\n        \n    }\n};\n',
    },
    tests: [
      { input: '4', expected: '2' },
      { input: '1', expected: '1' },
      { input: '8', expected: '92', hidden: true },
    ],
    complexity: { time: 'O(n!)', space: 'O(n)' },
    hints: ['Track occupied columns and diagonals.', 'Backtrack row by row.'],
    xp: DIFFICULTY_XP.Expert,
  },
];

export const ALL_TOPICS = Array.from(new Set(PROBLEMS.flatMap((p) => p.topics))).sort();

export function getProblem(slug) {
  return PROBLEMS.find((p) => p.slug === slug);
}

export function getProblemById(id) {
  return PROBLEMS.find((p) => p.id === id);
}

export function filterProblems(opts) {
  const q = (opts.q || '').trim().toLowerCase();
  return PROBLEMS.filter((p) => {
    if (q && !(`${p.title} ${p.id} ${p.topics.join(' ')}`.toLowerCase().includes(q))) return false;
    if (opts.difficulty && opts.difficulty !== 'All' && p.difficulty !== opts.difficulty) return false;
    if (opts.topic && opts.topic !== 'All' && !p.topics.includes(opts.topic)) return false;
    return true;
  });
}