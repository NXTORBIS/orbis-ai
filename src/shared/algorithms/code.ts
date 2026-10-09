/**
 * The pseudocode each algorithm is followed against.
 *
 * ## Why this is not the real source
 *
 * The implementations in `sorting.ts` and the rest are instrumented, bounded and recording as they go — showing
 * that on screen would mean showing the recorder calls, and somebody trying to learn quicksort would be reading
 * `rec.where(7, { lo, hi })`. So these are the algorithms written the way a textbook writes them, and the
 * implementation names a line of *this* through `rec.where(n, …)`.
 *
 * ## That makes the two able to disagree, so a test holds them together
 *
 * `algorithmCode.test.ts` runs every instrumented algorithm and asserts that no step names a line past the end of
 * its pseudocode, that line 1 is reached, and that every algorithm with a `line` has code here. A highlight on the
 * wrong line is worse than no highlight at all: it teaches the wrong shape of the algorithm, confidently.
 *
 * Lines are 1-based, matching what `rec.where()` is given. Indentation is two spaces per level and is meaningful
 * on screen, so it is not reflowed.
 */

export interface Code {
  /** The algorithm this belongs to, by catalogue id. */
  id: string
  /** One line per line, 1-based once displayed. Plain text, no syntax to parse. */
  lines: readonly string[]
  /** What the variables in it are called, and what each one holds. Shown beside the variables panel. */
  names: Readonly<Record<string, string>>
}

const code = (id: string, lines: readonly string[], names: Readonly<Record<string, string>>): Code => ({ id, lines, names })

export const ALGORITHM_CODE: readonly Code[] = Object.freeze([
  // ------------------------------------------------ sorting
  code(
    'bubble',
    [
      'for pass = 0 to n - 2',
      '  swapped = false',
      '  for at = 0 to n - 2 - pass',
      '    if values[at] > values[at + 1]',
      '      swap values[at], values[at + 1]',
      '      swapped = true',
      '  values[n - 1 - pass] is in place',
      '  if not swapped',
      '    the list is in order — stop'
    ],
    {
      pass: 'which sweep through the list this is',
      at: 'the left of the pair being compared',
      swapped: 'whether anything moved in this pass — how the early exit knows',
      n: 'how many values there are'
    }
  ),
  code(
    'insertion',
    [
      'values[0] is a sorted list of one',
      'for at = 1 to n - 1',
      '  held = values[at]',
      '  into = at - 1',
      '  while into >= 0 and values[into] > held',
      '    values[into + 1] = values[into]',
      '    into = into - 1',
      '  values[into + 1] = held'
    ],
    {
      at: 'the value being inserted',
      held: 'the value taken out, held while the gap is made',
      into: 'where in the sorted part the search has reached',
      n: 'how many values there are'
    }
  ),
  code(
    'selection',
    [
      'for at = 0 to n - 2',
      '  least = at',
      '  for look = at + 1 to n - 1',
      '    if values[look] < values[least]',
      '      least = look',
      '  if least != at',
      '    swap values[at], values[least]',
      '  values[at] is in place'
    ],
    {
      at: 'the position being filled',
      least: 'where the smallest value found so far is',
      look: 'the position being examined',
      n: 'how many values there are'
    }
  ),
  code(
    'merge',
    [
      'sort(lo, hi):',
      '  if hi - lo < 2: return',
      '  mid = (lo + hi) / 2',
      '  sort(lo, mid)',
      '  sort(mid, hi)',
      '  merge(lo, mid, hi)',
      '',
      'merge(lo, mid, hi):',
      '  left = values[lo..mid], right = values[mid..hi]',
      '  while both have values left',
      '    take the smaller of the two fronts',
      '  take whatever remains'
    ],
    {
      lo: 'the start of the part being sorted',
      mid: 'where it is split',
      hi: 'one past the end of the part being sorted',
      into: 'where the merged value is being written'
    }
  ),
  code(
    'quick',
    [
      'sort(lo, hi):',
      '  if lo >= hi: return',
      '  pivot = choose a pivot in values[lo..hi]',
      '  split = partition(lo, hi, pivot)',
      '  sort(lo, split - 1)',
      '  sort(split + 1, hi)',
      '',
      'partition(lo, hi, pivot):',
      '  smaller = lo',
      '  for at = lo to hi - 1',
      '    if values[at] < pivot',
      '      swap values[at], values[smaller]',
      '      smaller = smaller + 1',
      '  put the pivot at smaller',
      '  return smaller'
    ],
    {
      lo: 'the start of the part being sorted',
      hi: 'the end of the part being sorted',
      pivot: 'the value everything is compared against',
      at: 'the value being examined',
      smaller: 'the boundary: everything left of this is below the pivot'
    }
  ),
  code(
    'heap',
    [
      'for each parent, from the last down to the root',
      '  sift down',
      'for end = n - 1 down to 1',
      '  swap values[0], values[end]',
      '  values[end] is in place',
      '  sift down from the root, over values[0..end)',
      '',
      'sift down(root, limit):',
      '  while root has a child inside limit',
      '    biggest = the larger child, or root',
      '    if biggest is root: stop',
      '    swap values[root], values[biggest]',
      '    root = biggest'
    ],
    {
      end: 'the back of the unsorted part — where the largest value goes next',
      root: 'the node being sifted down',
      biggest: 'the larger of a node and its children',
      n: 'how many values there are'
    }
  ),
  code(
    'counting',
    [
      'find the smallest and largest value',
      'counts = how many of each value',
      'for each value in order',
      '  write it out as many times as it was counted'
    ],
    {
      least: 'the smallest value present',
      most: 'the largest value present',
      value: 'the value being counted or written',
      into: 'where the next value is written'
    }
  ),
  code(
    'radix',
    [
      'for each digit position, least significant first',
      '  counting-sort the values by that digit alone',
      '  the list is now sorted by every digit up to here'
    ],
    { place: 'which digit position this pass sorts by', digit: 'the digit of the value being placed' }
  ),

  // ------------------------------------------------ the other sixteen sorts
  code(
    'shell',
    [
      'for gap = large, shrinking to 1',
      '  for at = gap to n - 1',
      '    held = values[at]',
      '    into = at',
      '    while into >= gap and values[into - gap] > held',
      '      values[into] = values[into - gap]',
      '      into = into - gap',
      '    values[into] = held'
    ],
    { gap: 'how far apart the values being compared are', i: 'the value being inserted', j: 'how far back the search has reached', held: 'the value taken out' }
  ),
  code(
    'comb',
    [
      'gap = n',
      'repeat until gap is 1 and nothing swapped',
      '  gap = max(1, gap / 1.3)',
      '  for at = 0 to n - 1 - gap',
      '    if values[at] > values[at + gap]',
      '      swap them'
    ],
    { gap: 'the distance between the pair being compared', i: 'the left of the pair', swapped: 'whether anything moved this pass' }
  ),
  code(
    'cocktail',
    [
      'repeat until a full round makes no swaps',
      '  sweep forwards, swapping any pair out of order',
      '  the largest value is now at the back',
      '  sweep backwards, swapping any pair out of order',
      '  the smallest value is now at the front'
    ],
    { lo: 'the front of the unsorted part', hi: 'the back of it', i: 'the left of the pair being compared', going: 'which way the sweep is running', swapped: 'whether anything moved' }
  ),
  code(
    'gnome',
    [
      'at = 0',
      'while at < n',
      '  if at == 0 or values[at - 1] <= values[at]',
      '    at = at + 1',
      '  else',
      '    swap values[at - 1], values[at]',
      '    at = at - 1'
    ],
    { i: 'where the walk is' }
  ),
  code(
    'odd-even',
    [
      'repeat until a round makes no swaps',
      '  for every odd position, compare it with the next',
      '    swap if out of order',
      '  for every even position, compare it with the next',
      '    swap if out of order'
    ],
    { phase: 'whether this is the odd or the even half of the round', i: 'the left of the pair', swapped: 'whether anything moved' }
  ),
  code(
    'cycle',
    [
      'for start = 0 to n - 2',
      '  held = values[start]',
      '  into = where held belongs: count how many values are below it',
      '  if into == start: it is already home, move on',
      '  skip past any value equal to held',
      '  swap held with whatever is at `into`',
      '  repeat until held comes back to `start`'
    ],
    { start: 'the beginning of the cycle', held: 'the value being carried', into: 'where it belongs' }
  ),
  code(
    'pancake',
    [
      'for size = n down to 2',
      '  find the largest value in values[0..size)',
      '  flip values[0..that] so it is at the front',
      '  flip values[0..size) so it is at the back',
      '  values[size - 1] is in place'
    ],
    { size: 'how much of the stack is still unsorted', biggest: 'where the largest value in it is', k: 'how many are being flipped' }
  ),
  code(
    'three-way-quick',
    [
      'sort(lo, hi):',
      '  if lo >= hi: return',
      '  pivot = a random value in values[lo..hi]',
      '  partition into three: below, equal, above',
      '  sort(lo, start of equal - 1)',
      '  sort(end of equal + 1, hi)',
      '',
      'the equal block is already finished and is never recursed into'
    ],
    { lo: 'the start of the part being sorted', hi: 'the end of it', pivot: 'the value being partitioned around', equal: 'how many values equal the pivot', lt: 'the end of the below-pivot block', gt: 'the start of the above-pivot block', i: 'the value being placed' }
  ),
  code(
    'bottom-up-merge',
    [
      'for width = 1, doubling to n',
      '  for lo = 0 to n - 1 step 2 * width',
      '    merge values[lo..lo+width) with values[lo+width..lo+2*width)',
      'no recursion: the runs are merged in widening passes'
    ],
    { width: 'the length of the runs being merged', lo: 'where this merge starts', mid: 'where the two runs meet', hi: 'the end of the pair', a: 'how far into the left run', b: 'how far into the right run', into: 'where the merged value is written' }
  ),
  code(
    'tim',
    [
      'minrun = a length chosen from n',
      'walk the list finding runs already in order',
      '  if a run is shorter than minrun, extend it by insertion sort',
      '  push the run onto the stack',
      'merge the runs until one remains',
      'already-sorted input is one run, which is why this is O(n) on it'
    ],
    { minrun: 'the shortest run worth keeping', runs: 'how many runs have been found', lo: 'the start of the current run', hi: 'its end', i: 'how far the run check has got', runFrom: 'the start of the run being measured', runTo: 'its end' }
  ),
  code(
    'intro',
    [
      'sort(lo, hi, depth):',
      '  if the part is small: insertion sort it and return',
      '  if depth == 0: heapsort it and return',
      '  pivot = a random value; partition around it',
      '  sort(lo, split - 1, depth - 1)',
      '  sort(split + 1, hi, depth - 1)',
      '',
      'depth starts at 2 * log2(n), which is what rules the quadratic case out'
    ],
    { lo: 'the start of the part being sorted', hi: 'the end of it', depth: 'how much recursion is left before it switches to heapsort', pivot: 'the value being partitioned around' }
  ),
  code(
    'tree',
    [
      'for each value',
      '  insert it into a binary search tree',
      '    go left if smaller, right if larger',
      'walk the tree in order, left then node then right',
      'the walk comes out sorted'
    ],
    { value: 'the value being inserted', depth: 'how deep in the tree the insertion went', nodes: 'how many values are in the tree', i: 'which value is being inserted', at: 'the value at the node being compared with', read: 'how many have been read back out' }
  ),
  code(
    'bitonic',
    [
      'for size = 2, doubling to n',
      '  for stride = size / 2, halving to 1',
      '    for each position at',
      '      partner = at XOR stride',
      '      compare-and-swap, ascending or descending by which block it is in',
      'the same comparisons happen whatever the data'
    ],
    { size: 'the length of the bitonic sequence being merged', stride: 'the distance to the partner', i: 'the position being compared', partner: 'what it is compared with', j: 'the partner position', direction: 'whether this block sorts up or down', padding: 'how many placeholders were added to reach a power of two' }
  ),
  code(
    'bucket',
    [
      'find the smallest and largest value',
      'for each value',
      '  put it in the bucket its range falls in',
      'sort each bucket',
      'read the buckets out in order'
    ],
    { value: 'the value being placed', bucket: 'which bucket it went in', filled: 'how many buckets have anything in them', buckets: 'how many buckets there are', low: 'the smallest value', high: 'the largest', i: 'which value is being placed', size: 'how many are in this bucket' }
  ),
  code(
    'stooge',
    [
      'sort(lo, hi):',
      '  if values[lo] > values[hi]: swap them',
      '  if hi - lo + 1 < 3: return',
      '  third = (hi - lo + 1) / 3',
      '  sort(lo, hi - third)',
      '  sort(lo + third, hi)',
      '  sort(lo, hi - third)'
    ],
    { lo: 'the start of the part being sorted', hi: 'the end of it', third: 'a third of its length', depth: 'how deep the recursion has gone' }
  ),
  code(
    'bogo',
    [
      'while the list is not in order',
      '  check it, left to right',
      '  shuffle the whole list',
      'eventually, by chance, it is sorted'
    ],
    { tries: 'how many shuffles so far', at: 'how far the order check got before it failed', shuffles: 'how many shuffles so far' }
  ),

  // ------------------------------------------------ searching
  code(
    'linear',
    [
      'for at = 0 to n - 1',
      '  if values[at] == target',
      '    found at `at` — stop',
      'not present'
    ],
    { at: 'the position being examined', target: 'what is being looked for' }
  ),
  code(
    'binary',
    [
      'lo = 0, hi = n - 1',
      'while lo <= hi',
      '  mid = (lo + hi) / 2',
      '  if values[mid] == target',
      '    found at mid — stop',
      '  if values[mid] < target',
      '    lo = mid + 1',
      '  else',
      '    hi = mid - 1',
      'not present'
    ],
    {
      lo: 'the low end of the window still being searched',
      hi: 'the high end of the window still being searched',
      mid: 'the middle of the window, the value being tested',
      target: 'what is being looked for'
    }
  ),
  code(
    'interpolation',
    [
      'lo = 0, hi = n - 1',
      'while lo <= hi and target is within values[lo..hi]',
      '  guess where the target should be, by how far along its value is',
      '  if values[guess] == target: found — stop',
      '  if values[guess] < target: lo = guess + 1',
      '  else: hi = guess - 1',
      'not present'
    ],
    { lo: 'the low end of the window', hi: 'the high end of the window', guess: 'the estimated position of the target' }
  ),
  code(
    'jump',
    [
      'step = sqrt(n)',
      'jump forward by step until the value passes the target',
      'then walk back one block, linearly',
      'if the value is there, that is the answer',
      'not present'
    ],
    { step: 'how far each jump goes', at: 'where the search has jumped to' }
  ),

  code(
    'exponential',
    [
      'if values[0] is the target: found',
      'bound = 1',
      'while values[bound] < target: bound = bound * 2',
      'the answer is in [bound / 2 .. bound]',
      'binary search that block',
      '  move lo or hi by which side the middle fell',
      'not present'
    ],
    { bound: 'how far the doubling has reached', lo: 'the low end of the block being searched', hi: 'its high end', mid: 'the middle being tested', target: 'what is being looked for' }
  ),
  code(
    'fibonacci-search',
    [
      'fib = the first Fibonacci number at or above n',
      'offset = -1',
      'while fib > 1',
      '  look at offset + the Fibonacci number two back',
      '  if the value is below the target: move the offset forward, step fib down one',
      '  else: step fib down two',
      'check the one value that may be left',
      'not present'
    ],
    { fib: 'the Fibonacci number the window is sized by', offset: 'how far into the list the window starts', at: 'the position being tested', target: 'what is being looked for' }
  ),
  code(
    'ternary',
    [
      'lo = 0, hi = n - 1',
      'while lo <= hi',
      '  first = lo + (hi - lo) / 3, second = hi - (hi - lo) / 3',
      '  if values[first] == target: found',
      '  if values[second] == target: found',
      '  if target < values[first]: hi = first - 1',
      '  else if target > values[second]: lo = second + 1',
      '  else: search between them',
      'not present'
    ],
    { lo: 'the low end of the window', hi: 'the high end of the window', first: 'the first cut', second: 'the second cut', target: 'what is being looked for' }
  ),

  // ------------------------------------------------ graphs
  code(
    'bfs',
    [
      'queue = [start], seen = {start}',
      'while the queue is not empty',
      '  node = take the front of the queue',
      '  if node is the target: stop',
      '  for each neighbour of node',
      '    if neighbour not seen',
      '      mark it seen, note where it came from',
      '      put it at the back of the queue'
    ],
    { node: 'the node being expanded', neighbour: 'the neighbour being considered', queued: 'how many are waiting' }
  ),
  code(
    'dfs',
    [
      'stack = [start]',
      'while the stack is not empty',
      '  node = take the top of the stack',
      '  if already seen: skip it',
      '  mark it seen',
      '  if node is the target: stop',
      '  push every unseen neighbour'
    ],
    {
      node: 'the node being expanded',
      neighbour: 'the neighbour being considered',
      depth: 'how deep the walk has gone',
      stacked: 'how many are on the stack'
    }
  ),
  code(
    'dijkstra',
    [
      'distance[start] = 0, everything else = infinity',
      'while there are unsettled nodes',
      '  node = the unsettled node with the smallest distance',
      '  settle it — its distance is now final',
      '  for each neighbour',
      '    through = distance[node] + weight(node, neighbour)',
      '    if through < distance[neighbour]',
      '      distance[neighbour] = through, came-from = node'
    ],
    {
      node: 'the node being settled',
      neighbour: 'the neighbour being relaxed',
      through: 'the distance to the neighbour by way of this node',
      settled: 'how many distances are final'
    }
  ),
  code(
    'bellman-ford',
    [
      'distance[start] = 0, everything else = infinity',
      'repeat n - 1 times',
      '  for every edge (from, to, weight)',
      '    if distance[from] + weight < distance[to]',
      '      distance[to] = distance[from] + weight',
      'one more pass: any further improvement means a negative cycle'
    ],
    { round: 'which pass over the edges this is', from: 'the edge being relaxed, from', to: 'the edge being relaxed, to' }
  ),
  code(
    'a-star',
    [
      'open = {start}, g[start] = 0, f[start] = h(start)',
      'while open is not empty',
      '  node = the open node with the smallest f',
      '  if node is the target: stop',
      '  for each neighbour',
      '    through = g[node] + weight',
      '    if through < g[neighbour]',
      '      g = through, f = through + h(neighbour)'
    ],
    { node: 'the node being expanded', neighbour: 'the neighbour being considered', g: 'the cost to get here', h: 'the estimate of the cost remaining', f: 'g + h, the ordering key' }
  ),
  code(
    'kruskal',
    [
      'sort every edge by weight',
      'for each edge, lightest first',
      '  if its two ends are in different components',
      '    take the edge, and join the components',
      '  else skip it — it would make a cycle'
    ],
    { weight: 'the weight of the edge being considered', taken: 'how many edges are in the tree so far' }
  ),
  code(
    'topological',
    [
      'count how many edges arrive at each node',
      'ready = every node with none',
      'while ready is not empty',
      '  node = take one from ready',
      '  put it next in the order',
      '  for each node it points at',
      '    one fewer arriving edge; if none left, it is ready',
      'if any node is left over, there is a cycle'
    ],
    { node: 'the node being placed', placed: 'how many are in the order so far', ready: 'how many are ready to place' }
  ),

  // ------------------------------------------------ arrays
  code('traversal', ['for at = 0 to n - 1', '  read A[at]', '  add it to the running total', 'the total is the answer'],
    { n: 'how many values there are', at: 'the position being read', value: 'what is there', total: 'the running total' }),
  code('reversal', ['left = 0, right = n - 1', 'while left < right', '  swap A[left] and A[right]', '  left = left + 1, right = right - 1'],
    { left: 'the pointer coming from the front', right: 'the pointer coming from the back' }),
  code('rotation', ['k = by mod n', 'reverse A[0 .. k-1]', 'reverse A[k .. n-1]', 'reverse the whole array', 'it is now rotated left by k'],
    { n: 'how many values there are', k: 'how far it really rotates, after the remainder' }),
  code('prefix-sum', ['P[0] = 0', 'for at = 0 to n - 1', '  P[at + 1] = P[at] + A[at]', 'any range A[i..j] is now P[j+1] - P[i]'],
    { n: 'how many values there are', at: 'the position being added', running: 'the total so far' }),
  code('kadane', ['best = A[0], here = A[0]', 'for at = 1 to n - 1', '  if here + A[at] < A[at]: here = A[at], the run restarts', '  else: here = here + A[at]', '  if here > best: best = here', 'best is the largest run'],
    { at: 'the position being considered', value: 'what is there', best: 'the largest run found so far', here: 'the run ending at this position', from: 'where the current run started' }),
  code('two-pointer', ['left = 0, right = n - 1', 'while left < right', '  if A[left] + A[right] == target: found', '  if the sum is too small: left = left + 1', '  else: right = right - 1', 'no pair'],
    { left: 'the pointer coming from the front', right: 'the pointer coming from the back', sum: 'what the pair adds to', target: 'what is being looked for' }),
  code('sliding-window', ['add the first k values', 'best = that sum', 'for at = k to n - 1', '  sum = sum + A[at] - A[at - k]', '  if sum > best: best = sum', 'best is the largest window'],
    { k: 'how wide the window is', at: 'the value joining the window', sum: 'what the window adds to', best: 'the largest window so far' }),
  code('dutch-flag', ['low = 0, at = 0, high = n - 1', 'while at <= high', '  below the pivot: swap to the front, both pointers move', '  above the pivot: swap to the back, only high moves', '  equal: leave it and move on', 'three groups, one pass'],
    { low: 'the end of the below group', at: 'the value being examined', high: 'the start of the above group', pivot: 'the value being compared against' }),
  code('move-zeros', ['into = 0', 'for at = 0 to n - 1', '  if A[at] is not zero', '    swap it to position `into`, into = into + 1', 'the zeros are now at the end'],
    { at: 'the value being examined', value: 'what is there', into: 'where the next non-zero goes' }),
  code('remove-duplicates', ['into = 1', 'for at = 1 to n - 1', '  if A[at] differs from the last kept', '    A[into] = A[at], into = into + 1', 'the first `into` values are the different ones'],
    { at: 'the value being examined', into: 'how many have been kept', kept: 'how many different values so far' }),
  code('two-sum', ['seen = empty map', 'for at = 0 to n - 1', '  wanted = target - A[at]', '  if wanted is in seen: found', '  remember A[at] at position at', 'no pair'],
    { at: 'the position being examined', value: 'what is there', wanted: 'the other half of the pair', target: 'what the pair must add to', stored: 'how many have been remembered' }),
  code('missing-number', ['should = n * (n + 1) / 2', 'total = the sum of everything present', 'the missing value is should - total'],
    { n: 'how many values there are', should: 'what 0 to n adds to', at: 'the position being read', total: 'what is actually there', missing: 'the difference' }),
  code('majority-element', ['candidate = A[0], count = 0', 'for each value', '  if count is 0: this value becomes the candidate', '  else if it agrees: count = count + 1', '  else: count = count - 1', 'count the candidate properly', 'a candidate is not a majority until that check passes'],
    { at: 'the position being examined', value: 'what is there', candidate: 'the value currently surviving the vote', count: 'the vote balance', seen: 'how many times the candidate really appears' }),
  // ------------------------------------------------ linked lists
  code('list-reverse', ['previous = nothing, current = head', 'while current exists', '  remember what comes after current', '  point current back at previous', '  previous = current, current = what came after', 'previous is the new head'],
    { previous: 'the node already turned round', current: 'the node being turned', after: 'what came next, saved before the link broke' }),
  code('list-middle', ['slow = head, fast = head', 'while fast and fast.next exist', '  slow moves one, fast moves two', 'slow is the middle'],
    { slow: 'the pointer moving one at a time', fast: 'the pointer moving two at a time', middle: 'where slow ended' }),
  code('list-cycle', ['slow = head, fast = head', 'while fast and fast.next exist', '  slow moves one, fast moves two', '  if they meet, there is a loop', 'fast ran off the end, so there is none'],
    { slow: 'the slow pointer', fast: 'the fast pointer', steps: 'how many moves so far' }),
  code('list-search', ['at = head', 'while at exists', '  if at.value is the target: found', '  at = at.next', 'not in the list'],
    { at: 'the node being looked at', value: 'what it holds', target: 'what is being looked for' }),
  code('balanced-parens', ['for each character', '  an opening bracket: push it', '  a closing bracket:', '    nothing on the stack: unbalanced', '    the top does not match: unbalanced', 'balanced only if the stack is empty at the end'],
    { at: 'the character being read', depth: 'how many brackets are open' }),
  code('infix-to-postfix', ['for each token', '  a value: straight to the output', '  "(": push it', '  ")": pop until the matching "("', '  an operator:', '    pop anything binding at least as tightly', '    then push it', 'pop whatever is left'],
    { tokens: 'how many pieces the expression has', at: 'the token being read', operator: 'the operator being placed', precedence: 'how tightly it binds' }),
  code('postfix-eval', ['for each token', '  a number: push it', '  an operator: pop two, apply, push the answer', '  two off and one on, every time', 'one value left is the answer'],
    { tokens: 'how many pieces there are', at: 'the token being read', depth: 'how many values are on the stack', operator: 'the operator being applied', result: 'what it produced' }),
  code('circular-queue', ['head = 0, tail = 0, count = 0', 'take:', '  empty if count is 0, else read head and move it on', 'put:', '  full if count is capacity, else write at tail and move it on', 'both pointers wrap round to 0 at the end'],
    { capacity: 'how many slots there are', head: 'where the next value is taken from', tail: 'where the next value goes', count: 'how many are in it' }),
  code('queue-bfs', ['put the root on the queue', 'while the queue is not empty', '  take one off the front and visit it', '  put its children on the back', 'a queue gives level order; a stack would give depth'],
    { at: 'the node being visited', queued: 'how many are waiting' }),
  // ------------------------------------------------ trees
  code('bst-insert', ['for each value', '  if the tree is empty: it is the root', '  walk down from the root', '    smaller: go left', '    larger: go right', '  hang it where the walk runs out', 'nothing rebalances, so the insertion order decides the shape'],
    { value: 'the value being inserted', nodes: 'how many are in the tree', depth: 'how deep this insertion went', at: 'the value at the node being compared' }),
  code('bst-search', ['at = root', 'while at exists', '  equal: found', '  smaller: go left, ignoring everything right', '  larger: go right, ignoring everything left', 'not in the tree'],
    { at: 'the value at the node being compared', target: 'what is being looked for', steps: 'how many comparisons so far' }),
  code('in-order', ['visit(node):', '  go left', '  visit the node here', '  go right', 'on a search tree this comes out sorted'],
    { at: 'the node being visited', depth: 'how deep the walk is', visited: 'how many have been visited' }),
  code('pre-order', ['visit(node):', '  visit the node first', '  go left', '  go right', 'the root comes out first'],
    { at: 'the node being visited', depth: 'how deep the walk is', visited: 'how many have been visited' }),
  code('post-order', ['visit(node):', '  go left', '  go right', '  visit the node last', 'the root comes out last, which is the order to delete in'],
    { at: 'the node being visited', depth: 'how deep the walk is', visited: 'how many have been visited' }),
  code('level-order', ['put the root on a queue', 'while the queue is not empty', '  take one off, visit it', '  put its children on the back', 'a queue, not recursion \u2014 that is what makes it level by level'],
    { at: 'the node being visited', depth: 'which level it is on', queued: 'how many are waiting' }),
  // ------------------------------------------------ hashing
  code('hash-chaining', ['for each value', '  bucket = hash(value) mod buckets', '  if the bucket already has something, that is a collision', '  add it to that bucket\u2019s list', 'a lookup is one hash plus the length of one chain'],
    { buckets: 'how many buckets there are', value: 'the value being stored', bucket: 'where it hashed to', collisions: 'how many landed on something', chain: 'how long that chain became', longest: 'the longest chain in the table', stored: 'how many are in the table' }),
  code('hash-probing', ['for each value', '  bucket = hash(value) mod buckets', '  while that slot is taken, try the next one', '  put it in the first free slot', 'the probe runs grow sharply once the table is about 70% full'],
    { buckets: 'how many slots there are', value: 'the value being stored', bucket: 'where it hashed to', probing: 'the slot being tried now', tried: 'how many probes this value took', probes: 'how many probes in total', longest: 'the longest run of probes', stored: 'how many are in the table' }),
  // ------------------------------------------------ greedy
  code('activity-selection', ['sort everything by when it finishes', 'for each in that order', '  if it starts at or after the last one taken finished', '    take it', '  else skip it', 'finishing soonest leaves the most room for what follows'],
    { n: 'how many activities there are', at: 'the one being considered', considering: 'its name', lastFinish: 'when the last one taken finished', taken: 'how many have been taken' }),
  code('fractional-knapsack', ['work out value per unit of weight for each item', 'sort by that, best first', 'for each item', '  it fits whole: take all of it', '  it does not: take the fraction that fits, and stop', 'cutting the last item is why greedy is right here'],
    { capacity: 'how much the bag holds', at: 'the item being considered', item: 'its name', left: 'how much room is left', fraction: 'how much of the last item fitted', total: 'the value taken so far' }),
  code('coin-change-greedy', ['sort the coins, largest first', 'for each coin', '  take as many as fit', '  subtract them from what is left', 'check the answer against the true fewest', 'greedy is right for ordinary money and wrong for some coin sets'],
    { amount: 'what is being made', coins: 'how many different coins there are', coin: 'the coin being used', left: 'how much is still to make', taken: 'how many of this coin', right: 'whether greedy matched the true fewest' }),

  // ------------------------------------------------ recursion and backtracking
  code(
    'hanoi',
    [
      'move(n, from, to, spare):',
      '  if n is 0: nothing to do',
      '  move(n - 1, from, spare, to)',
      '  move disc n from `from` to `to`',
      '  move(n - 1, spare, to, from)'
    ],
    { n: 'how many discs this call is moving', disc: 'the disc just moved', from: 'the peg it came off', to: 'the peg it went on', moves: 'how many moves so far' }
  ),
  code(
    'permutations',
    [
      'arrange():',
      '  if everything is used: record this arrangement',
      '  for each unused item',
      '    take it',
      '    arrange()',
      '    put it back and try the next'
    ],
    { n: 'how many items there are', depth: 'how many are chosen so far', taking: 'the item being tried', found: 'how many arrangements so far' }
  ),
  code(
    'subsets',
    [
      'choose(at):',
      '  if at is past the end: record this subset',
      '  leave item `at` out, choose(at + 1)',
      '  put item `at` in, choose(at + 1)',
      '  take it back out'
    ],
    { n: 'how many items there are', at: 'which item is being decided', depth: 'how many are in the subset so far', taking: 'whether this item is going in', found: 'how many subsets so far' }
  ),
  code(
    'n-queens',
    [
      'place(row):',
      '  if row is past the last: record this solution',
      '  for each column',
      '    is it attacked by a queen already placed?',
      '    no: put a queen there and place(row + 1)',
      '    then take it back out and try the next column'
    ],
    { n: 'the size of the board', row: 'the row being filled', col: 'the column being tried', against: 'which earlier queen is being checked', solutions: 'how many complete boards found', removals: 'how many times a queen was taken back' }
  ),

  // ------------------------------------------------ strings
  code(
    'naive-match',
    [
      'for start = 0 to n - m',
      '  compare the pattern against the text from `start`',
      '  on the first difference, give up and try start + 1',
      '  if every character matched, record a match at `start`'
    ],
    { start: 'where this attempt begins', at: 'how far into the pattern the comparison has got', n: 'the length of the text', m: 'the length of the pattern', found: 'how many matches so far' }
  ),
  code(
    'kmp',
    [
      'build the table:',
      '  for at = 1 to m - 1',
      '    if pattern[at] continues the prefix: table[at] = length + 1',
      '    else if length > 0: fall back to table[length - 1]',
      '    else: table[at] = 0',
      'then walk the text once:',
      '  compare text[i] with pattern[j]',
      '  same: i and j both move forward',
      '    j reached m \u2014 a match, then fall back by the table',
      '  different and j > 0: only j moves, by the table',
      '  different and j = 0: only i moves'
    ],
    { at: 'the position in the pattern the table is being built for', length: 'how long the matching prefix is', i: 'where the walk is in the text', j: 'how much of the pattern matches', m: 'the length of the pattern', n: 'the length of the text', found: 'how many matches so far' }
  ),
  code(
    'rabin-karp',
    [
      'hash the pattern, and the first window of the text',
      'for each window',
      '  if the hashes agree',
      '    compare the characters \u2014 a real match, or',
      '    a spurious hit: the hashes agreed and the characters did not',
      '  roll the hash: drop the character leaving, add the one arriving'
    ],
    { wanted: "the pattern's hash", window: "the current window's hash", start: 'where the window begins', spurious: 'how many hash matches turned out to be false', found: 'how many real matches so far' }
  ),

  // ------------------------------------------------ dynamic programming
  code(
    'knapsack',
    [
      'for each item',
      '  for each capacity from 0 up',
      '    without = best without this item',
      '    with = value(item) + best for (capacity - weight(item))',
      '    best[item][capacity] = the larger of the two'
    ],
    { item: 'which item this row is for', capacity: 'the capacity this column is for', without: 'the best ignoring this item', with: 'the best taking this item' }
  ),
  code(
    'lcs',
    [
      'for i = 1 to length(a)',
      '  for j = 1 to length(b)',
      '    if a[i] == b[j]',
      '      table[i][j] = table[i-1][j-1] + 1',
      '    else',
      '      table[i][j] = max(table[i-1][j], table[i][j-1])',
      'read the subsequence back by walking the table'
    ],
    { i: 'how far into the first string', j: 'how far into the second string', match: 'whether the two characters are the same' }
  ),
  code(
    'lis',
    [
      'best[at] = 1 for every position',
      'for at = 1 to n - 1',
      '  for before = 0 to at - 1',
      '    if values[before] < values[at]',
      '      best[at] = max(best[at], best[before] + 1)',
      'the answer is the largest entry in best'
    ],
    { at: 'the position being extended', before: 'the earlier position being tried', best: 'the longest run ending at `at`' }
  ),
  code(
    'fibonacci',
    [
      'known = {0: 0, 1: 1}',
      'fib(n):',
      '  if n is in known: return it',
      '  answer = fib(n - 1) + fib(n - 2)',
      '  known[n] = answer',
      '  return answer'
    ],
    { n: 'which Fibonacci number is being worked out', hits: 'how many calls the recursion has made' }
  )
])

const BY_ID: Readonly<Record<string, Code>> = Object.freeze(Object.fromEntries(ALGORITHM_CODE.map((one) => [one.id, one])))

/** The pseudocode for an algorithm, or null when there is none — in which case nothing is highlighted. */
export function codeFor(id: string): Code | null {
  return BY_ID[id] ?? null
}
