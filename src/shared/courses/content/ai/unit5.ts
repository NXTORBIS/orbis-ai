import type { Module } from '../../types.ts'

/**
 * Unit 05 — Learning without labels, and learning from rewards.
 *
 * Unsupervised learning is taught with the honesty it usually lacks: clustering always returns clusters, and
 * whether they mean anything is a question the algorithm cannot answer. Reinforcement learning is introduced
 * through reward design, because reward design is where every real RL failure comes from and it is
 * comprehensible without any mathematics.
 */
export const AI_UNIT_5: Module = {
  id: 'u5',
  title: 'Unsupervised Learning and Reinforcement Learning',
  summary:
    'Finding structure with no answers given — clustering, dimensionality reduction, anomaly detection — then the reward loop: agents, states, actions, exploration and what goes wrong when you reward the wrong thing.',
  concepts: [
    'unsupervised',
    'distance',
    'clustering',
    'kmeans',
    'dimensionality-reduction',
    'pca',
    'anomaly-detection',
    'reinforcement',
    'agent-environment',
    'reward',
    'exploration',
    'value-functions'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'u5l1',
      title: 'Clustering, and what it cannot tell you',
      intro:
        'Grouping examples with no labels at all. The algorithm is simple; the hard part is that it always succeeds, whether or not there is anything there.',
      objectives: [
        'Explain what unsupervised learning is and what distance means for it',
        'Describe k-means step by step',
        'Explain why clusters always appear and how to judge whether they are real'
      ],
      concepts: ['unsupervised', 'distance', 'clustering', 'kmeans'],
      requires: ['ml-definition', 'features', 'vectors'],
      minutes: 15,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: '**Unsupervised learning** works on data with no labels. Nobody has written down an answer, so there is no error to measure against — the model is looking for structure rather than for a mapping.'
        },
        { kind: 'heading', text: 'Distance' },
        {
          kind: 'text',
          text: 'Once each example is a vector, "similar" becomes "close", and close needs a definition. Euclidean distance — the straight line — is the usual one.'
        },
        { kind: 'formula', latex: 'd(a, b) = \\sqrt{\\sum_j (a_j - b_j)^2}', caption: 'Euclidean distance between two feature vectors: square the difference in each dimension, add them, take the root. Unit 09 meets cosine similarity, which compares direction instead and is what text usually needs.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Distance is meaningless on unscaled features. One feature in thousands and another in units means the first decides every distance, and your clusters are a map of that one column. Scaling is not optional here — it is part of the definition of the problem.'
        },
        { kind: 'heading', text: 'k-means' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Choose k, the number of clusters. You choose it; the algorithm will not.',
            'Place k centres, usually at random points from the data.',
            'Assign every example to its nearest centre.',
            'Move each centre to the mean of the examples assigned to it.',
            'Repeat steps 3 and 4 until nothing moves.'
          ]
        },
        {
          kind: 'text',
          text: 'It converges quickly and it is genuinely useful. Three properties are worth knowing before trusting a result. It depends on the starting positions, so different runs can give different answers — run it several times. It prefers roughly round, roughly equal-sized clusters, so it mis-handles long thin ones. And it will always return exactly k clusters.'
        },
        { kind: 'heading', text: 'The honest problem' },
        {
          kind: 'text',
          text: 'Ask for four clusters in data with no group structure at all and you will get four clusters, with centres, with members, drawn beautifully. Nothing in the output says "there was nothing here". The algorithm cannot tell you whether the structure it found is in the world or in your choice of k.'
        },
        {
          kind: 'list',
          items: [
            '**The elbow method** — plot within-cluster spread against k. A sharp bend suggests a natural number of groups; a smooth curve suggests there is no natural number.',
            '**Silhouette score** — how much closer each point is to its own cluster than to the next nearest. Low everywhere means the clusters overlap.',
            '**Stability** — cluster two random halves of the data separately. If the groupings disagree, they are an artefact of the sample.',
            '**Interpretation** — look at what is in each cluster and see whether it means anything to somebody who knows the domain. This is the test that matters most and the one that cannot be automated.'
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'Clustering is a tool for generating hypotheses, not for confirming them. "These four groups came out of the data" is a reason to go and look; it is not a finding on its own.'
        },
        { kind: 'heading', text: 'Where it earns its place' },
        {
          kind: 'table',
          headers: ['Use', 'What the clusters are', 'What you do with them'],
          rows: [
            ['Customer segmentation', 'Groups of similar behaviour', 'Different messaging per group — then measure whether it worked'],
            ['Document grouping', 'Topics', 'Browsing and routing'],
            ['Image compression', 'Representative colours', 'Replace each pixel with its cluster colour'],
            ['Exploring new data', 'Whatever structure exists', 'Deciding what to investigate'],
            ['Making labels cheaper', 'Groups to sample from', 'Label a few per cluster rather than at random']
          ]
        },
        {
          kind: 'lab',
          appId: 'learning-lab',
          title: 'Cluster something, then change k',
          does:
            'Cluster a dataset with k = 2, 3, 4 and 7, and look at the result each time. Then cluster data you know has no groups in it, and notice that the output looks exactly as convincing.'
        },
        { kind: 'check', questionId: 'u5l1q1' },
        { kind: 'check', questionId: 'u5l1q2' }
      ],
      questions: [
        {
          id: 'u5l1q1',
          kind: 'choice',
          concept: 'clustering',
          prompt: 'You run k-means with k = 5 on data that has no real group structure. What happens?',
          difficulty: 'intermediate',
          options: [
            'It reports that no clusters were found',
            'It returns five clusters that look entirely plausible, because the algorithm always partitions whatever it is given',
            'It fails with an error',
            'It automatically reduces k to 1'
          ],
          answer: 1,
          explanation:
            'k-means partitions. Given k it returns k groups, whether or not the data has any. Checking stability, silhouette and whether the groups mean anything to a domain expert is how you find out — the algorithm never volunteers it.',
          hints: ['What is the algorithm actually optimising, and can that ever fail to produce an answer?']
        },
        {
          id: 'u5l1q2',
          kind: 'multi',
          concept: 'kmeans',
          prompt: 'Which of these are genuine limitations of k-means? Choose all that apply.',
          difficulty: 'advanced',
          options: [
            'It requires you to choose the number of clusters',
            'It cannot handle more than three features',
            'Results depend on the random starting positions',
            'It prefers round, similar-sized clusters'
          ],
          answer: [0, 2, 3],
          explanation:
            'You choose k, the initialisation matters so you run it several times, and the geometry it assumes is roughly spherical clusters of similar size. The number of features is not a limitation — high dimensionality brings its own problems, but k-means runs happily on many columns.',
          hints: ['One of these is about dimensionality, and it is not a k-means restriction.']
        },
        {
          id: 'u5l1q3',
          kind: 'short',
          concept: 'unsupervised',
          prompt: 'Why can you not measure unsupervised learning the way you measure a classifier?',
          difficulty: 'intermediate',
          answer: 'there are no labels, so there is no right answer to compare against',
          accepts: ['no labels', 'no ground truth', 'nothing to compare to', 'there is no correct answer given'],
          explanation:
            'No labels means no error. You can measure internal properties — how tight the clusters are, how stable they are — but "right" is not available, which is why interpretation by somebody who knows the domain does so much of the work.',
          hints: ['What does a classifier have that this does not?']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'u5l2',
      title: 'Dimensionality reduction and anomaly detection',
      intro:
        'Describing each example with fewer numbers, and finding the examples that do not belong — two uses of the same idea about where the data really lives.',
      objectives: [
        'Explain what PCA finds and what it loses',
        'Say when reduction helps and when it harms',
        'Describe how an anomaly detector decides something is unusual'
      ],
      concepts: ['dimensionality-reduction', 'pca', 'anomaly-detection'],
      requires: ['dimensionality', 'vectors'],
      minutes: 14,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'High-dimensional data has the problems Unit 02 described: distances concentrate, the space is mostly empty, and models overfit. **Dimensionality reduction** describes each example with fewer numbers while keeping as much of what distinguishes them as possible.'
        },
        { kind: 'heading', text: 'PCA' },
        {
          kind: 'text',
          text: '**Principal component analysis** finds the directions in which the data varies most. The first principal component is the single direction with the greatest spread; the second is the direction of greatest remaining spread at right angles to it, and so on. Keep the first few and you have a compact description.'
        },
        {
          kind: 'example',
          title: 'Why it works on real data',
          text: 'Height and weight for 10,000 people: two columns, but the points lie close to a line. One number — position along that line — captures most of what varies. The second direction holds the rest: unusually heavy for that height, or unusually light.\n\nThat is the general situation. Twenty correlated measurements often live near a five-dimensional surface inside the twenty-dimensional space, and PCA finds that surface.'
        },
        {
          kind: 'list',
          items: [
            'Each component comes with the share of total variance it explains. Four components explaining 95% means four numbers do nearly the work of twenty.',
            'Components are combinations of the original features, so they usually have no interpretation — "0.4 × height + 0.3 × weight − 0.2 × age" is not a quantity anybody names.',
            'PCA only finds *linear* structure. Data curled into a spiral has its structure missed entirely; non-linear methods exist for that.',
            'Scale first. PCA follows variance, and an unscaled large-numbered feature will be the first component by arithmetic rather than by meaning.'
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Fit PCA on the training set only, then apply the same transformation to validation and test. Fitting it on everything is the leak from Unit 02 in a less obvious coat.'
        },
        { kind: 'heading', text: 'When reduction is the wrong move' },
        {
          kind: 'text',
          text: 'If a weak but genuine signal lives in a low-variance direction, PCA will discard it — variance is not importance. On tabular data with a few dozen informative columns, reduction often costs accuracy for no benefit. It earns its place with very many correlated columns, for visualisation, and for speed.'
        },
        { kind: 'heading', text: 'Anomaly detection' },
        {
          kind: 'text',
          text: 'The task: flag examples unlike the rest. It is usually unsupervised because anomalies are rare, varied, and not known in advance — you cannot collect a representative sample of "things that have never happened".'
        },
        {
          kind: 'table',
          headers: ['Approach', 'Decides something is unusual when', 'Watch out for'],
          rows: [
            ['Distance based', 'It is far from its neighbours', 'Needs scaling; suffers in high dimensions'],
            ['Density based', 'It sits where the data is sparse', 'Choosing the neighbourhood size'],
            ['Reconstruction based', 'A model trained to rebuild normal data rebuilds it badly', 'Needs genuinely clean training data'],
            ['Statistical', 'It is far out in the tail of a fitted distribution', 'Assumes the distribution you fitted']
          ]
        },
        {
          kind: 'text',
          text: 'Every one of them answers "unusual compared with my training data" — which is not the same as "wrong", "fraudulent" or "broken". A new legitimate product launch looks exactly like an anomaly. This is why anomaly detectors are nearly always deployed as a queue for a person rather than as an automatic action.'
        },
        {
          kind: 'lab',
          appId: 'data-explorer',
          title: 'Reduce, then look',
          does:
            'Take a dataset with many columns, reduce it to two, and plot it. See whether the groups you expected appear — and check how much of the variance those two dimensions actually explain before believing the picture.'
        },
        { kind: 'check', questionId: 'u5l2q1' },
        { kind: 'check', questionId: 'u5l2q2' }
      ],
      questions: [
        {
          id: 'u5l2q1',
          kind: 'choice',
          concept: 'pca',
          prompt: 'What does the first principal component represent?',
          difficulty: 'advanced',
          options: [
            'The most important feature for prediction',
            'The direction along which the data varies most',
            'The average of all the features',
            'The feature with the largest values'
          ],
          answer: 1,
          explanation:
            'Greatest variance. Importantly, that is not the same as most useful for prediction: PCA never looks at the label, so it can happily discard a low-variance direction that carried the signal.',
          hints: ['PCA does not know what you are predicting.']
        },
        {
          id: 'u5l2q2',
          kind: 'choice',
          concept: 'anomaly-detection',
          prompt: 'An anomaly detector flags a transaction. What has it established?',
          difficulty: 'intermediate',
          options: [
            'The transaction is fraudulent',
            'The transaction is unlike the data the detector was trained on — which may be fraud, or may be something new and legitimate',
            'The transaction is invalid',
            'The customer account is compromised'
          ],
          answer: 1,
          explanation:
            'Unusual, relative to training data. A legitimate first holiday abroad is unusual; so is a new product line. That gap between "unusual" and "wrong" is why these systems produce a review queue rather than an automatic block.',
          hints: ['Compared with what, exactly?']
        },
        {
          id: 'u5l2q3',
          kind: 'true-false',
          concept: 'dimensionality-reduction',
          prompt: 'Reducing dimensions always improves model performance.',
          difficulty: 'intermediate',
          answer: false,
          explanation:
            'It can help with many correlated columns, with speed and with visualisation. It can also throw away a weak but real signal, because variance is not importance. Like every other choice here, it is measured on validation data rather than assumed.',
          hints: ['What does PCA keep, and what might have been in the part it dropped?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'u5l3',
      title: 'Reinforcement learning: the loop',
      intro:
        'A different shape of problem entirely. Nobody says what the right action was — the system acts, and sometimes a reward arrives, possibly much later.',
      objectives: [
        'Describe the agent-environment loop and name its parts',
        'Explain why delayed reward makes this harder than supervised learning',
        'Explain exploration against exploitation'
      ],
      concepts: ['reinforcement', 'agent-environment', 'exploration', 'value-functions'],
      requires: ['ml-definition'],
      minutes: 15,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Supervised learning is given the answer for each example. Reinforcement learning is not. An **agent** observes a **state**, chooses an **action**, and the **environment** returns a new state and sometimes a **reward**. Nothing ever says what the best action would have been.'
        },
        {
          kind: 'example',
          title: 'The loop',
          text: 'state  →  agent chooses action  →  environment responds\n  ↑                                            │\n  └────────── new state, and a reward ─────────┘\n\nRepeat until the episode ends. The agent is trying to maximise total reward over the whole episode, not the reward from this one step.'
        },
        {
          kind: 'table',
          headers: ['Term', 'Meaning', 'In a game of chess'],
          rows: [
            ['Agent', 'The thing choosing', 'The player'],
            ['Environment', 'Everything else', 'The board and the opponent'],
            ['State', 'What the agent can see now', 'The position'],
            ['Action', 'What it may do', 'A legal move'],
            ['Reward', 'A number arriving from the environment', '+1 for a win, −1 for a loss, 0 for every other move'],
            ['Policy', 'The rule mapping state to action', 'How this player chooses moves'],
            ['Episode', 'One run from start to finish', 'One game']
          ]
        },
        { kind: 'heading', text: 'Why delayed reward is the hard part' },
        {
          kind: 'text',
          text: 'In chess the reward arrives once, at the end. If you win after sixty moves, which of those moves deserves the credit? Probably not all equally; possibly one at move 23. Working this out is the **credit assignment problem**, and it is the central difficulty of reinforcement learning. Supervised learning never has it, because every example comes with its own answer.'
        },
        { kind: 'heading', text: 'Exploration and exploitation' },
        {
          kind: 'text',
          text: 'The agent knows that one action gives a reward of 5. Another it has barely tried. Take the 5 (**exploit**) or try the unknown (**explore**)? Always exploiting means never finding the action worth 50. Always exploring means never collecting anything.'
        },
        {
          kind: 'list',
          items: [
            '**ε-greedy** — take the best known action most of the time, and a random one with small probability ε. Simple, and surprisingly effective.',
            '**Decaying ε** — explore a lot early, settle down later.',
            '**Optimism** — assume untried actions are good until shown otherwise, which makes exploration automatic.'
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'The same dilemma appears far outside reinforcement learning: which headline to show, which treatment to trial, which supplier to test. It is one of those ideas that turns out to describe a lot of decisions once you have the name for it.'
        },
        { kind: 'heading', text: 'Value, and Q-learning' },
        {
          kind: 'text',
          text: 'A **value function** says how good a state is — not the immediate reward, but the total reward you can expect from there onwards under your policy. A **Q-value** is the same for a state-action pair: how good is taking this action in this state. With good Q-values the policy is trivial — take the action with the highest Q. Q-learning is a procedure for estimating them from experience, by repeatedly adjusting each estimate toward the reward received plus the best estimated value of where you ended up.'
        },
        { kind: 'formula', latex: 'Q(s,a) \\leftarrow Q(s,a) + \\alpha\\big[r + \\gamma \\max_{a\'} Q(s\',a\') - Q(s,a)\\big]', caption: 'The Q-learning update. r is the reward just received, s′ the new state, α the learning rate and γ the discount — how much a reward in the future is worth compared with one now. The bracket is the gap between the current estimate and a better one.' },
        {
          kind: 'text',
          text: 'The discount γ deserves a sentence. With γ near 0 the agent is short-sighted and takes the nearest reward; near 1 it is patient and will sacrifice now for later. It is a hyperparameter, and it changes behaviour more than almost anything else in the setup.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Reinforcement learning is powerful and expensive. It needs a huge number of interactions, which is fine in a simulator and often impossible in the real world — you cannot crash ten thousand real vehicles to learn to drive. Most deployed systems that could be framed as RL are deliberately solved another way.'
        },
        { kind: 'check', questionId: 'u5l3q1' },
        { kind: 'check', questionId: 'u5l3q2' }
      ],
      questions: [
        {
          id: 'u5l3q1',
          kind: 'choice',
          concept: 'reinforcement',
          prompt: 'What makes reinforcement learning fundamentally harder than supervised learning?',
          difficulty: 'advanced',
          options: [
            'The datasets are larger',
            'Nothing says what the right action was, and the reward may arrive long after the action that earned it — so credit has to be assigned across a sequence',
            'The models have more parameters',
            'Rewards are always negative'
          ],
          answer: 1,
          explanation:
            'No supervision per step, and delayed reward: the credit assignment problem. Supervised learning has an answer attached to every example, which is exactly what makes it comparatively easy.',
          hints: ['Compare what each setting is told after making a prediction.']
        },
        {
          id: 'u5l3q2',
          kind: 'choice',
          concept: 'exploration',
          prompt: 'An agent always takes the action with the highest known value. What goes wrong?',
          difficulty: 'intermediate',
          options: [
            'Nothing — that is the optimal strategy',
            'It never discovers better actions it has not tried, so it can settle permanently on something mediocre',
            'It will explore too much',
            'Its rewards will be negative'
          ],
          answer: 1,
          explanation:
            'Pure exploitation locks in whatever looked good first. The action worth 50 stays untried because the action worth 5 is always the best *known* one. Some exploration is necessary, which is the whole dilemma.',
          hints: ['What never happens to an action the agent has never tried?']
        },
        {
          id: 'u5l3q3',
          kind: 'short',
          concept: 'agent-environment',
          prompt: 'What is a policy?',
          difficulty: 'intermediate',
          answer: 'the rule that maps a state to an action',
          accepts: ['how the agent chooses an action', 'state to action mapping', 'the agents strategy', 'what the agent does in each state'],
          explanation:
            'The agent behaviour: given this state, do this. Learning in reinforcement learning means improving the policy, directly or by way of better value estimates.',
          hints: ['It is what the agent consults to decide.']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'u5l4',
      title: 'Reward design, and getting exactly what you asked for',
      intro:
        'The practical heart of reinforcement learning, and a warning that applies to every objective anybody ever writes: a system optimises what you measured, not what you meant.',
      objectives: [
        'Explain reward hacking with examples',
        'Explain why sparse rewards are hard and what shaping costs',
        'Connect reward design to objectives in ordinary machine learning'
      ],
      concepts: ['reward'],
      requires: ['agent-environment'],
      minutes: 14,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'An agent maximises the reward it is given. It has no access to your intention, so any gap between what you measured and what you wanted will be found and exploited — not out of malice, but because that is what optimisation does.'
        },
        { kind: 'heading', text: 'Reward hacking' },
        {
          kind: 'example',
          title: 'Four reward functions and what they produced',
          text: 'Reward: distance travelled\n  → agent discovers it can spin in place and accumulate distance\n\nReward: score in a boat race\n  → agent finds a lagoon of respawning pickups, circles forever, never finishes the race\n\nReward: number of items tidied away\n  → agent knocks items over so it can tidy them again\n\nReward: clicks on recommended content\n  → agent recommends whatever provokes a reaction, which is not whatever is worth reading'
        },
        {
          kind: 'text',
          text: 'Every one of these is the agent doing exactly what was asked. The last is the one that matters most, because it is not a toy: it describes a real class of deployed system, and the gap between "engagement" and "value to the person" has consequences far outside the model.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'This is not specific to reinforcement learning. Any system optimised against a measurable proxy will drift from the thing the proxy stood for. A hospital rewarded on waiting times, a team rewarded on tickets closed, a model rewarded on click-through — all the same phenomenon.'
        },
        { kind: 'heading', text: 'Sparse rewards' },
        {
          kind: 'text',
          text: 'The opposite problem. Reward only at the end — win the game, solve the maze — means an agent acting at random may never see a single reward, and so never learn anything. The information is correct and far too rare.'
        },
        {
          kind: 'text',
          text: '**Reward shaping** adds intermediate rewards to help: a little for moving toward the exit, a little for picking up the key. It makes learning feasible and it introduces exactly the risk above — now the agent may optimise the shaped signal rather than the real goal. An agent rewarded for approaching the exit may hover near it without ever going through.'
        },
        {
          kind: 'list',
          items: [
            'Reward the outcome you actually want, as directly as you can measure it.',
            'Add shaping terms sparingly, and check what behaviour each one produces.',
            'Watch what the agent does, not only what it scores. The score is the thing it is gaming.',
            'Penalise the behaviours you do not want explicitly, rather than hoping they will not pay.',
            'Expect to iterate. First reward functions are nearly always wrong, and the failure is usually instructive.'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Carry this into Unit 11 and Unit 13. Training a language model on which answer people preferred is reward design, and "answers people rate highly" is a proxy for "answers that are correct and useful". They come apart in predictable ways — notably toward flattery and confident phrasing.'
        },
        { kind: 'check', questionId: 'u5l4q1' },
        { kind: 'check', questionId: 'u5l4q2' }
      ],
      questions: [
        {
          id: 'u5l4q1',
          kind: 'choice',
          concept: 'reward',
          prompt: 'A cleaning agent rewarded per item tidied starts knocking items over. What has happened?',
          difficulty: 'intermediate',
          options: [
            'The agent is broken and should be retrained',
            'The reward measured tidying actions rather than tidiness, and the agent maximised exactly what was measured',
            'It learned too fast',
            'Reinforcement learning cannot be used for cleaning'
          ],
          answer: 1,
          explanation:
            'Reward hacking, and the agent is working perfectly. Knocking things over creates more opportunities to be rewarded. The repair is to measure the state of the room rather than the number of tidying actions.',
          hints: ['Read the reward literally and ask how to maximise it.']
        },
        {
          id: 'u5l4q2',
          kind: 'choice',
          concept: 'reward',
          prompt: 'Why are sparse rewards difficult, and what does shaping cost?',
          difficulty: 'advanced',
          options: [
            'Sparse rewards are too large; shaping makes them smaller',
            'An agent may never reach a reward and so never learn; shaping adds intermediate rewards, which the agent may then optimise instead of the real goal',
            'Sparse rewards are always negative',
            'Shaping has no downside and should always be used'
          ],
          answer: 1,
          explanation:
            'A reward that arrives only on success gives a random agent almost nothing to learn from. Shaping provides a gradient to follow and creates a new proxy to be gamed — an agent rewarded for approaching the goal can learn to hover near it.',
          hints: ['What does the agent see during the thousands of episodes where it fails?']
        },
        {
          id: 'u5l4q3',
          kind: 'true-false',
          concept: 'reward',
          prompt: 'Reward hacking is a problem only in reinforcement learning.',
          difficulty: 'intermediate',
          answer: false,
          explanation:
            'Any optimisation against a proxy drifts from the thing the proxy stood for — recommendation on clicks, an organisation on its targets, a language model on which answer was preferred. The mechanism is identical; only the setting changes.',
          hints: ['Think about systems optimised on engagement.']
        }
      ]
    }
  ]
}
