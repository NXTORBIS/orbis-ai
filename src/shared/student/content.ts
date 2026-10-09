import type { AgeBand, LearningItem } from './types.ts'

/**
 * The learning content Orbis ships with.
 *
 * Curated rather than generated, and written out here rather than fetched, because the first thing a student sees has
 * to be right and has to work with no network. Everything has metadata: what kind it is, how hard it is, which age
 * bands it suits, and where it came from. Nothing here is filler -- a "fact of the day" that is wrong is worse than
 * no fact of the day, and a student who catches one stops trusting the rest.
 *
 * Content Orion generates is not added to this list. It is stored separately with `origin: 'orion'` and labelled as
 * such wherever it is shown, so a student always knows whether they are reading something checked or something
 * written for them a moment ago.
 */

const EVERYONE: readonly AgeBand[] = ['child', 'preteen', 'teen', 'older-teen', 'adult', 'unknown']
const TEEN_UP: readonly AgeBand[] = ['teen', 'older-teen', 'adult', 'unknown']

const word = (
  id: string,
  title: string,
  pronunciation: string,
  partOfSpeech: string,
  definition: string,
  example: string,
  synonyms: string[],
  antonyms: string[],
  difficulty: LearningItem['difficulty'],
  bands: readonly AgeBand[] = EVERYONE
): LearningItem => ({
  id: `word-${id}`,
  kind: 'word',
  title,
  difficulty,
  subject: 'English',
  origin: 'orbis',
  bands,
  tags: ['vocabulary'],
  body: { pronunciation, partOfSpeech, definition, example, synonyms, antonyms }
})

export const WORDS: readonly LearningItem[] = [
  word('lucid', 'Lucid', 'LOO-sid', 'adjective', 'Clear and easy to understand; also, thinking clearly.', 'Her explanation of gravity was so lucid that the whole class followed it.', ['clear', 'coherent', 'intelligible'], ['confused', 'muddled'], 'intermediate'),
  word('tenacious', 'Tenacious', 'tuh-NAY-shus', 'adjective', 'Holding on firmly; not giving up easily.', 'He was tenacious about the proof and found the error on the ninth attempt.', ['persistent', 'determined', 'dogged'], ['irresolute', 'yielding'], 'intermediate'),
  word('candid', 'Candid', 'KAN-did', 'adjective', 'Honest and direct, even when it is uncomfortable.', 'She was candid about how little she had revised.', ['frank', 'forthright', 'open'], ['evasive', 'guarded'], 'beginner'),
  word('meticulous', 'Meticulous', 'muh-TIK-yuh-lus', 'adjective', 'Showing great care over small details.', 'His lab notes were meticulous, down to the room temperature.', ['thorough', 'painstaking', 'scrupulous'], ['careless', 'slapdash'], 'intermediate'),
  word('ephemeral', 'Ephemeral', 'ih-FEM-er-ul', 'adjective', 'Lasting a very short time.', 'The ephemeral snow melted before the morning bell.', ['fleeting', 'transient', 'short-lived'], ['enduring', 'permanent'], 'advanced'),
  word('pragmatic', 'Pragmatic', 'prag-MAT-ik', 'adjective', 'Dealing with things in a practical way rather than a theoretical one.', 'A pragmatic plan: finish the past papers first, then read the chapter.', ['practical', 'realistic', 'sensible'], ['idealistic', 'impractical'], 'intermediate'),
  word('ubiquitous', 'Ubiquitous', 'yoo-BIK-wih-tus', 'adjective', 'Found everywhere.', 'Mobile phones are now ubiquitous in classrooms.', ['omnipresent', 'pervasive', 'universal'], ['rare', 'scarce'], 'advanced'),
  word('succinct', 'Succinct', 'suk-SINKT', 'adjective', 'Said clearly in very few words.', 'Her answer was succinct and still complete.', ['concise', 'terse', 'pithy'], ['rambling', 'verbose'], 'intermediate'),
  word('ambiguous', 'Ambiguous', 'am-BIG-yoo-us', 'adjective', 'Open to more than one meaning.', 'The question was ambiguous, so two different answers were accepted.', ['unclear', 'equivocal'], ['definite', 'unambiguous'], 'intermediate'),
  word('diligent', 'Diligent', 'DIL-ih-junt', 'adjective', 'Working carefully and steadily.', 'Diligent practice beat last-minute panic.', ['industrious', 'assiduous', 'conscientious'], ['lazy', 'negligent'], 'beginner'),
  word('inherent', 'Inherent', 'in-HEER-unt', 'adjective', 'Existing as a natural and inseparable part of something.', 'There is an inherent risk in every experiment with open flame.', ['intrinsic', 'innate', 'built-in'], ['extrinsic', 'acquired'], 'advanced'),
  word('scrutinise', 'Scrutinise', 'SKROO-tin-ize', 'verb', 'To examine something very closely.', 'He scrutinised the graph and found the mislabelled axis.', ['examine', 'inspect', 'study'], ['skim', 'glance'], 'intermediate'),
  word('arbitrary', 'Arbitrary', 'AR-bih-trair-ee', 'adjective', 'Chosen without a particular reason rather than for a good one.', 'The deadline felt arbitrary until he saw the exam timetable.', ['random', 'capricious'], ['reasoned', 'principled'], 'advanced'),
  word('coherent', 'Coherent', 'koh-HEER-unt', 'adjective', 'Logical and consistent; holding together.', 'A coherent essay answers one question from start to finish.', ['logical', 'consistent', 'lucid'], ['incoherent', 'disjointed'], 'intermediate'),
  word('resilient', 'Resilient', 'rih-ZIL-yunt', 'adjective', 'Able to recover quickly from difficulty.', 'A resilient student treats a bad mock as information.', ['tough', 'hardy', 'adaptable'], ['fragile', 'brittle'], 'beginner'),
  word('empirical', 'Empirical', 'em-PEER-ih-kul', 'adjective', 'Based on what has been observed or measured rather than on theory alone.', 'The claim needed empirical support, so they ran the experiment.', ['observed', 'experimental', 'evidence-based'], ['theoretical', 'speculative'], 'advanced', TEEN_UP),
  word('negligible', 'Negligible', 'NEG-lih-jih-bul', 'adjective', 'So small that it can be ignored.', 'Air resistance was negligible at that speed.', ['insignificant', 'trivial', 'minute'], ['significant', 'considerable'], 'intermediate'),
  word('plausible', 'Plausible', 'PLAW-zih-bul', 'adjective', 'Seeming reasonable or likely, though not proven.', 'It was a plausible explanation, so they tested it.', ['believable', 'credible', 'reasonable'], ['implausible', 'far-fetched'], 'intermediate'),
  word('juxtapose', 'Juxtapose', 'JUK-stuh-pohz', 'verb', 'To place two things side by side, usually to compare them.', 'The essay juxtaposes the two revolutions to show what they shared.', ['contrast', 'compare', 'place side by side'], ['separate', 'isolate'], 'advanced', TEEN_UP),
  word('rigorous', 'Rigorous', 'RIG-er-us', 'adjective', 'Thorough, careful and demanding exactness.', 'The proof was rigorous: every step followed from the one before it.', ['thorough', 'exacting', 'strict'], ['sloppy', 'lax'], 'intermediate'),
  word('salient', 'Salient', 'SAY-lee-unt', 'adjective', 'Most noticeable or important.', 'She listed the salient points in the margin.', ['prominent', 'key', 'striking'], ['minor', 'unimportant'], 'advanced', TEEN_UP),
  word('concede', 'Concede', 'kun-SEED', 'verb', 'To admit that something is true, often reluctantly.', 'He conceded that his first method had been slower.', ['admit', 'acknowledge', 'grant'], ['deny', 'dispute'], 'intermediate'),
  word('deter', 'Deter', 'dih-TUR', 'verb', 'To put somebody off doing something.', 'One hard question should not deter you from the paper.', ['discourage', 'dissuade'], ['encourage', 'urge'], 'beginner'),
  word('intricate', 'Intricate', 'IN-trih-kut', 'adjective', 'Having many small parts arranged in a complicated way.', 'The circuit was intricate but followed one simple rule.', ['complex', 'elaborate', 'detailed'], ['simple', 'plain'], 'beginner'),
  word('corroborate', 'Corroborate', 'kuh-ROB-uh-rate', 'verb', 'To support a statement with other evidence.', 'A second measurement corroborated the first.', ['confirm', 'support', 'substantiate'], ['contradict', 'refute'], 'advanced', TEEN_UP),
  word('nuance', 'Nuance', 'NOO-ahns', 'noun', 'A small but meaningful difference.', 'The nuance between the two words changed the whole answer.', ['subtlety', 'shade', 'distinction'], ['crudeness'], 'advanced', TEEN_UP),
  word('obsolete', 'Obsolete', 'OB-suh-leet', 'adjective', 'No longer used, because something better has replaced it.', 'That notation is obsolete, though old textbooks still use it.', ['outdated', 'superseded'], ['current', 'modern'], 'beginner'),
  word('paradox', 'Paradox', 'PAIR-uh-doks', 'noun', 'A statement that seems to contradict itself and may still be true.', "The twin paradox is a paradox only until you account for acceleration.", ['contradiction', 'puzzle'], [], 'intermediate'),
  word('verbose', 'Verbose', 'ver-BOHS', 'adjective', 'Using more words than are needed.', 'The answer was verbose and lost a mark for clarity.', ['wordy', 'long-winded'], ['concise', 'succinct'], 'intermediate'),
  word('astute', 'Astute', 'uh-STOOT', 'adjective', 'Quick to see what matters, especially to one’s advantage.', 'An astute guess about which topic would come up.', ['shrewd', 'perceptive', 'sharp'], ['obtuse', 'naive'], 'advanced', TEEN_UP)
]

const concept = (
  id: string,
  title: string,
  subject: string,
  definition: string,
  keyIdea: string,
  example: string,
  commonMistake: string,
  question: string,
  answer: string,
  difficulty: LearningItem['difficulty'],
  bands: readonly AgeBand[] = EVERYONE
): LearningItem => ({
  id: `concept-${id}`,
  kind: 'concept',
  title,
  difficulty,
  subject,
  origin: 'orbis',
  bands,
  tags: [subject.toLowerCase()],
  body: { definition, keyIdea, example, commonMistake, question, answer }
})

export const CONCEPTS: readonly LearningItem[] = [
  concept(
    'newton-first',
    "Newton's first law",
    'Physics',
    'An object stays at rest, or keeps moving in a straight line at a constant speed, unless a resultant force acts on it.',
    'Motion does not need a cause; a change in motion does.',
    'A book on a table stays put because gravity and the table’s push cancel out.',
    'Thinking that a moving object needs a continuous force to keep moving. It needs one only to change how it moves.',
    'A puck slides across frictionless ice. What force keeps it moving?',
    'None. With no resultant force it keeps its velocity.',
    'beginner'
  ),
  concept(
    'newton-second',
    "Newton's second law",
    'Physics',
    'The resultant force on an object equals its mass times its acceleration: F = ma.',
    'Force causes acceleration, not speed.',
    'A 2 kg trolley pushed with a resultant 6 N accelerates at 3 m/s².',
    'Using the applied force instead of the resultant force. Friction has to be subtracted first.',
    'A 5 kg box is pushed with 20 N while friction opposes it with 5 N. What is its acceleration?',
    '3 m/s², from a resultant force of 15 N.',
    'beginner'
  ),
  concept(
    'newton-third',
    "Newton's third law",
    'Physics',
    'If one object exerts a force on a second, the second exerts an equal and opposite force on the first.',
    'Forces come in pairs, and the two act on different objects.',
    'You push the ground backwards; the ground pushes you forwards. That is how walking works.',
    'Thinking the pair cancels out. It cannot: the two forces act on two different objects.',
    'Why do action and reaction not cancel each other out?',
    'Because they act on different objects, so neither appears in the other’s resultant force.',
    'intermediate'
  ),
  concept(
    'projectile',
    'Projectile motion',
    'Physics',
    'Motion under gravity alone, treated as two independent motions: constant velocity horizontally and constant acceleration vertically.',
    'The two directions do not talk to each other. Time is what they share.',
    'A ball thrown horizontally at 10 m/s from 20 m up lands after about 2.0 s, having travelled about 20 m.',
    'Mixing the directions, or thinking horizontal speed changes the fall time. It does not.',
    'Two balls leave a table at the same instant, one dropped and one rolled off fast. Which lands first?',
    'They land together. Vertical motion is the same for both.',
    'intermediate'
  ),
  concept(
    'momentum',
    'Conservation of momentum',
    'Physics',
    'In a closed system with no external resultant force, total momentum before an interaction equals total momentum after it.',
    'Momentum is conserved in every collision, whether or not kinetic energy is.',
    'A 2 kg ball at 3 m/s hits a stationary 1 kg ball; the total momentum stays 6 kg·m/s.',
    'Assuming kinetic energy is conserved too. Only in an elastic collision is it.',
    'Is momentum conserved in a collision where the objects stick together?',
    'Yes. Kinetic energy is not, but momentum is.',
    'intermediate'
  ),
  concept(
    'moles',
    'The mole',
    'Chemistry',
    'A mole is an amount of substance containing 6.02214076 × 10²³ particles — the Avogadro constant.',
    'The mole turns a mass you can weigh into a number of particles you can count.',
    '18 g of water is about one mole, so about 6.02 × 10²³ molecules.',
    'Confusing molar mass with molecular mass, or forgetting that a formula unit may hold several atoms.',
    'How many moles are in 44 g of carbon dioxide (molar mass 44 g/mol)?',
    'One mole.',
    'intermediate'
  ),
  concept(
    'ph',
    'pH',
    'Chemistry',
    'pH is the negative base-10 logarithm of the hydrogen-ion concentration in moles per litre.',
    'Each whole step in pH is a tenfold change in concentration.',
    'A solution with 1 × 10⁻³ mol/L of hydrogen ions has a pH of 3.',
    'Treating the scale as linear. pH 4 is ten times more acidic than pH 5, not slightly.',
    'How many times more concentrated in hydrogen ions is pH 2 than pH 5?',
    'A thousand times.',
    'intermediate'
  ),
  concept(
    'photosynthesis',
    'Photosynthesis',
    'Biology',
    'Plants use light energy to convert carbon dioxide and water into glucose and oxygen.',
    'Light energy is stored as chemical energy in glucose.',
    'Six molecules of carbon dioxide and six of water give one of glucose and six of oxygen.',
    'Saying plants "breathe in carbon dioxide and breathe out oxygen" only. They respire as well, all the time.',
    'Do plants respire?',
    'Yes, continuously. Photosynthesis happens in the light as well.',
    'beginner'
  ),
  concept(
    'derivative',
    'The derivative',
    'Mathematics',
    'The derivative of a function at a point is the limit of its average rate of change as the interval shrinks to zero.',
    'It is the gradient of the tangent: how fast something is changing right now.',
    'For f(x) = x², f′(x) = 2x, so the gradient at x = 3 is 6.',
    'Treating the derivative as a fraction of small numbers rather than a limit, and forgetting the chain rule on composites.',
    'What is the derivative of x³?',
    '3x².',
    'intermediate'
  ),
  concept(
    'integral',
    'The definite integral',
    'Mathematics',
    'The definite integral of a function between two points is the signed area between its graph and the horizontal axis.',
    'Differentiation and integration undo each other — the fundamental theorem of calculus.',
    'The integral of 2x from 0 to 3 is 9.',
    'Forgetting that area below the axis counts as negative.',
    'What is the integral of 2x from 0 to 3?',
    '9.',
    'advanced',
    TEEN_UP
  ),
  concept(
    'pythagoras',
    'Pythagoras’ theorem',
    'Mathematics',
    'In a right-angled triangle, the square on the hypotenuse equals the sum of the squares on the other two sides.',
    'It only holds for right-angled triangles.',
    'Sides 3 and 4 give a hypotenuse of 5, because 9 + 16 = 25.',
    'Applying it to a triangle that is not right-angled, or using it on the wrong side as the hypotenuse.',
    'A right-angled triangle has legs of 6 and 8. What is the hypotenuse?',
    '10.',
    'beginner'
  ),
  concept(
    'quadratic',
    'The quadratic formula',
    'Mathematics',
    'The solutions of ax² + bx + c = 0 are x = (−b ± √(b² − 4ac)) / 2a, for a ≠ 0.',
    'The discriminant b² − 4ac says how many real roots there are before you solve anything.',
    'For x² − 5x + 6 = 0 the roots are 2 and 3.',
    'Dividing by 2a only under part of the expression, and losing the minus sign on b.',
    'How many real roots does x² + x + 1 = 0 have?',
    'None. The discriminant is −3.',
    'intermediate'
  ),
  concept(
    'big-o',
    'Big-O notation',
    'Computer science',
    'Big-O describes how the work an algorithm does grows with the size of its input, ignoring constants.',
    'It is about growth, not speed. An O(n) algorithm can be slower than an O(n²) one on small inputs.',
    'Binary search is O(log n): doubling the list adds one step.',
    'Reading O(1) as "fast". It means "does not grow with the input", which is a different claim.',
    'What is the time complexity of searching an unsorted list of n items?',
    'O(n): every item may have to be looked at.',
    'intermediate',
    TEEN_UP
  ),
  concept(
    'recursion',
    'Recursion',
    'Computer science',
    'A function that solves a problem by calling itself on a smaller version of the same problem.',
    'Every recursion needs a base case, or it never stops.',
    'Factorial: n! = n × (n − 1)!, with 0! = 1 as the base case.',
    'Forgetting the base case, or recursing on something that is not actually smaller.',
    'What happens to a recursive function with no base case?',
    'It calls itself until the call stack runs out.',
    'intermediate',
    TEEN_UP
  ),
  concept(
    'supply-demand',
    'Supply and demand',
    'Economics',
    'In a market, the price tends toward the level at which the quantity people will buy equals the quantity sellers will supply.',
    'Price is an outcome of the two curves meeting, not a cause of either.',
    'A poor harvest shifts supply left, and the price rises.',
    'Confusing a shift of the whole curve with movement along it.',
    'A new tax on sellers shifts which curve?',
    'Supply, upwards and to the left.',
    'intermediate',
    TEEN_UP
  ),
  concept(
    'cell-division',
    'Mitosis and meiosis',
    'Biology',
    'Mitosis makes two genetically identical cells; meiosis makes four cells with half the chromosome number.',
    'Mitosis is for growth and repair; meiosis is for gametes.',
    'A skin cell dividing is mitosis; a sperm or egg cell forming is meiosis.',
    'Mixing up the number of divisions. Meiosis has two; mitosis has one.',
    'How many cells does one meiosis produce?',
    'Four, each with half the original chromosome number.',
    'intermediate'
  )
]

const fact = (id: string, title: string, text: string, subject: string, source: string, difficulty: LearningItem['difficulty'], bands: readonly AgeBand[] = EVERYONE): LearningItem => ({
  id: `fact-${id}`,
  kind: 'fact',
  title,
  difficulty,
  subject,
  origin: 'orbis',
  bands,
  tags: ['fact'],
  body: { text, source }
})

export const FACTS: readonly LearningItem[] = [
  fact('light-second', 'Light takes 1.28 seconds to reach the Moon', 'Light travels about 299,792 km every second, and the Moon averages about 384,400 km away, so a radio signal takes roughly 1.28 seconds each way.', 'Physics', 'Defined value of the speed of light; NASA lunar distance', 'beginner'),
  fact('water-density', 'Ice floats because water is strangest at 4 °C', 'Water is densest at about 4 °C, not at its freezing point, so ice floats and lakes freeze from the top down.', 'Chemistry', 'Standard physical properties of water', 'beginner'),
  fact('dna-length', 'Your DNA would stretch far past the Sun', 'A single human cell holds about two metres of DNA, and the body has on the order of tens of trillions of cells.', 'Biology', 'Human Genome Project figures', 'intermediate'),
  fact('prime-gaps', 'There is no largest prime number', 'Euclid proved over two thousand years ago that the primes never run out, by showing any finite list must be missing one.', 'Mathematics', "Euclid's Elements, Book IX", 'intermediate'),
  fact('neuron-speed', 'Nerve signals travel at very different speeds', 'Myelinated nerve fibres carry signals at up to about 120 m/s, while the slowest unmyelinated ones manage under 1 m/s.', 'Biology', 'Standard physiology references', 'intermediate', TEEN_UP),
  fact('bit-origin', 'The word "bit" is a contraction', 'It comes from "binary digit", coined in a 1948 paper by Claude Shannon, who credited John Tukey with the term.', 'Computer science', 'Shannon, A Mathematical Theory of Communication, 1948', 'beginner'),
  fact('everest-growth', 'Everest is still rising', 'The Indian plate continues to push into Eurasia, lifting the Himalaya by a few millimetres a year while erosion takes some back.', 'Geography', 'Plate tectonics; GPS measurements', 'beginner'),
  fact('zero-history', 'Zero took a long time to become a number', 'Used as a placeholder in Babylonian and Mayan systems, zero was treated as a number in its own right in Indian mathematics, notably by Brahmagupta in 628 CE.', 'History', 'Brahmagupta, Brahmasphutasiddhanta', 'intermediate')
]

const teaser = (id: string, title: string, question: string, answer: string, difficulty: LearningItem['difficulty']): LearningItem => ({
  id: `teaser-${id}`,
  kind: 'teaser',
  title,
  difficulty,
  subject: 'Logic',
  origin: 'orbis',
  bands: EVERYONE,
  tags: ['puzzle'],
  body: { question, answer }
})

export const TEASERS: readonly LearningItem[] = [
  teaser('bat-ball', 'Bat and ball', 'A bat and a ball cost £1.10 together. The bat costs £1.00 more than the ball. How much is the ball?', '5p. The bat is £1.05, and the difference is £1.00.', 'beginner'),
  teaser('handshakes', 'Handshakes', 'Five people each shake hands once with everybody else. How many handshakes happen?', 'Ten. Each of five people shakes four hands, and each handshake is counted twice: 5 × 4 ÷ 2.', 'beginner'),
  teaser('socks', 'Socks in the dark', 'A drawer holds 10 black and 10 white socks, mixed. How many must you take out, in the dark, to be sure of a matching pair?', 'Three. Two could differ; a third must match one of them.', 'beginner'),
  teaser('lily-pad', 'Lily pads', 'A patch of lilies doubles each day and covers the lake on day 48. When did it cover half?', 'Day 47.', 'beginner'),
  teaser('two-doors', 'Weighing coins', 'You have nine identical-looking coins, one slightly heavier, and a balance. How few weighings guarantee you find it?', 'Two. Weigh three against three, then three against each other within the heavy group.', 'intermediate'),
  teaser('monty', 'Switching doors', 'Three doors hide one prize. You pick one; the host, who knows, opens a different door showing no prize and offers a switch. Should you?', 'Yes. Switching wins two times in three, because your first pick was right only one time in three.', 'advanced')
]

/** Everything bundled, in one list for the learning engine to choose from. */
export const BUNDLED: readonly LearningItem[] = [...WORDS, ...CONCEPTS, ...FACTS, ...TEASERS]

/** A quiz drawn from a concept's own question, so there is no second place for the same answer to be wrong. */
export const QUIZZES: readonly LearningItem[] = CONCEPTS.filter((one) => one.body.question && one.body.answer).map((one) => ({
  ...one,
  id: `quiz-${one.id}`,
  kind: 'quiz' as const,
  tags: [...one.tags, 'quiz'],
  body: { question: one.body.question, answer: one.body.answer, text: one.body.keyIdea }
}))

export const ALL_CONTENT: readonly LearningItem[] = [...BUNDLED, ...QUIZZES]

export function contentById(id: string): LearningItem | null {
  return ALL_CONTENT.find((one) => one.id === id) ?? null
}
