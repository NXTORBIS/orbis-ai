# Orbis Chance

An independent platform for exploring probability, possibility, simulation and
uncertainty.

Orbis Chance answers questions such as *how likely is this?*, *how uncertain is
this estimate?*, *what happens if that assumption is wrong?* and *which input
actually drives the result?* — and shows the method, the formula, the
assumptions and the limits behind every answer.

Everything runs in your browser. There is no account, no server and no API key.

---

## Running it

```bash
npm install
npm run dev      # development server at http://localhost:5173
```

```bash
npm run build    # type-check and produce a production build in dist/
npm run preview  # serve the production build
```

### Checks

```bash
npm run typecheck   # tsc --build
npm run lint        # ESLint
npm test            # unit, property-based and integration tests
npm run test:e2e    # Playwright end-to-end tests (starts the dev server)
npm run check       # typecheck + lint + test + build
```

End-to-end tests need a Chromium binary. If Playwright's browsers are already
installed elsewhere, point at one:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm run test:e2e
# otherwise: npx playwright install chromium
```

The project targets Node 20 or later and any modern browser with IndexedDB and
Web Workers.

---

## What it does

Forty-two tools across eleven categories, each implementing a specific set of
methods. Nothing here is a placeholder: every tool computes with the engine,
and every method listed below is implemented and tested.

The first fourteen are the original set and are described in full. The rest
followed, and are listed by category after them.

With this many tools, the catalogue is searchable rather than only browsable:
press <kbd>Ctrl</kbd>+<kbd>K</kbd> (or <kbd>⌘</kbd>+<kbd>K</kbd>) anywhere and
type a method name — "expected shortfall", "Ljung-Box", "Kendall tau" — and it
will find the tool that implements it. The home screen's search field uses the
same matching.

### Probability

| Tool | Methods |
|---|---|
| **Probability basics** | Complement rule; conversion between decimals, percentages, fractions and odds; relative frequency with Wilson and Clopper–Pearson intervals. |
| **Event relationships** | Multiplication and addition rules, conditional probability, independence checking, and Fréchet–Hoeffding bounds when the relationship is unknown. |
| **Counting and combinatorics** | Factorials, permutations, combinations, selections with repetition and multinomial coefficients — exact, on arbitrary-precision integers. |
| **Repeated trials** | Binomial, geometric and negative binomial questions; hypergeometric for sampling without replacement; an exact recursion for runs; attempts needed to reach a target probability. |
| **Bayes' theorem** | Multi-hypothesis posteriors, Bayes factors, the law of total probability, and a diagnostic-test view with predictive values. |
| **Bayesian updating** | Beta–Binomial, Gamma–Poisson and Normal–Normal conjugate updates with credible intervals and posterior predictive statements. |

### Distributions

**Distribution explorer** — 20 distributions with density/mass, cumulative,
quantile and moment functions, interval probabilities, and side-by-side
comparison.

*Discrete:* Bernoulli, binomial, geometric, negative binomial, hypergeometric,
Poisson, discrete uniform.
*Continuous:* uniform, normal, exponential, gamma, beta, log-normal, Weibull,
Student's t, chi-square, triangular, PERT, Cauchy, Pareto.

### Experiments and simulation

| Tool | What it does |
|---|---|
| **Experiment laboratory** | Coins, dice (fair or weighted), cards, urns and custom outcome sets, with or without replacement. Observed frequencies are compared against the exact distribution, computed by convolution. |
| **Monte Carlo simulation** | Built-in models: π estimation, dice sums, project schedules, an M/M/1 queue, sampling variation and Markov paths — with convergence analysis and comparison against closed-form values. |
| **Scenario builder** | Your own model: fixed values, distributions, categories, Bernoulli events and derived formulas, linked by Gaussian-copula rank correlations or conditional parameters. |

### Analysis

| Tool | Methods |
|---|---|
| **Sensitivity analysis** | One-at-a-time sweeps with gradient and elasticity, tornado comparison, Spearman rank correlation, and Saltelli variance-based Sobol indices. |
| **Risk explorer** | Compound frequency–severity loss models, Value at Risk, Expected Shortfall, threshold exceedance, and an expected-value risk register with mitigation comparison. |
| **Markov chains** | Exact n-step distributions, stationary distributions, class structure and periodicity, and absorption analysis via the fundamental matrix. |
| **Data lab** | Import CSV or JSON locally. Descriptive statistics, correlations, grouped comparisons, hypothesis tests (t, Welch, paired, chi-square, Mann–Whitney, Kolmogorov–Smirnov, ANOVA, correlation) with effect sizes, and bootstrap intervals. |

### Everything added since

The engine grew to cover thirty subjects, and each of them now has an
interface. These are grouped by the same categories the application uses.
#### Simulation

| Tool | Methods |
|---|---|
| **Discrete-event simulation** | Event-driven simulation with a future event list; Multi-stage queue and resource networks; Priority, balking and reneging; Warm-up period detection; Batch-means confidence intervals; Independent replications; Resource utilisation and bottleneck analysis. |
| **Quasi-Monte Carlo** | Halton sequences with scrambling and leaping; Faure sequences; Rank-1 lattice rules with generator search; Randomised QMC with shifts; L2 star and centred discrepancy; Koksma-Hlawka error bounds; Log-log convergence rate fitting. |

#### Analysis

| Tool | Methods |
|---|---|
| **Extreme values** | Generalised extreme value distribution; Generalised Pareto distribution; Block maxima and peaks over threshold; Maximum likelihood with profile intervals; Return levels and return periods; Hill and Pickands tail index estimators; Runs declustering; Extreme value theory VaR and expected shortfall. |
| **Regression modelling** | Ordinary and weighted least squares by QR; Robust HC0-HC3 standard errors; Ridge, lasso and elastic net; Logistic and Poisson regression; Leverage, Cook distance and DFFITS; Breusch-Pagan and White tests; Leave-one-out and k-fold cross-validation; ROC curves and AUC. |
| **Hypothesis tests** | Mann-Whitney and Brunner-Munzel; Wilcoxon signed-rank and sign tests; Welch t-test, one-way and Welch ANOVA; Kruskal-Wallis and Friedman; Fisher's exact test; Tukey, Dunn and Games-Howell post-hoc; Holm, Hochberg and Benjamini-Hochberg; Permutation tests and BCa bootstrap; Minimum detectable effect. |
| **Causal inference** | d-separation and back-door identification; Front-door criterion; Inverse-probability weighting; Propensity score matching with balance diagnostics; Instrumental variables with weak-instrument testing; Difference-in-differences with a parallel-trends check; Regression discontinuity; E-value and sensitivity to unmeasured confounding. |
| **Information theory** | Shannon, Renyi and min-entropy; Mutual information with a permutation test; Kullback-Leibler and Jensen-Shannon divergence; Pinsker and Bretagnolle-Huber bounds; Maximum entropy under moment constraints; Brier and log scores with Murphy decomposition; Calibration, sharpness and PIT histograms; Blahut-Arimoto channel capacity; Continuous ranked probability score (CRPS); Fisher information and expected information gain. |
| **Transforms and spectra** | Radix-2 and mixed-radix FFT; Periodogram with windowing; Welch spectral estimation; Fast convolution; Characteristic functions; Moment generating functions; Numerical inversion. |
| **Dependence and copulas** | Pseudo-observations and empirical copulas; Kendall tau and Spearman rho; Gaussian, t, Clayton, Gumbel and Frank copulas; Fitting by inversion of Kendall tau; Family comparison on the same rank correlation; Upper and lower tail dependence coefficients; Gaussian and t copula sampling. |

#### Inference

| Tool | Methods |
|---|---|
| **Bayesian networks** | Variable elimination; Junction tree belief propagation; Most probable explanation; d-separation; Do-operator by graph surgery; Back-door and front-door criteria; Conditional probability table learning. |
| **Bayesian inference** | Random-walk Metropolis-Hastings; Adaptive Metropolis-Hastings; Hamiltonian Monte Carlo; Slice sampling; Gibbs sampling; Split and rank-normalised R-hat; Effective sample size; Highest density interval; Posterior predictive sampling. |
| **Gaussian processes** | Thirteen kernels with sums, products and scaling; Exact conditioning with jitter diagnostics; Hyperparameter fitting from multiple restarts; Automatic relevance determination; Leave-one-out predictive density and PIT; Subset-of-data, FITC and SoR approximations; Expected improvement and UCB acquisition; Bayesian optimisation with regret reporting. |
| **Model comparison** | AIC, AICc, BIC and WAIC; Deviance information criterion; K-fold and exact leave-one-out cross-validation; elpd differences with standard errors; Bayesian model averaging; Stacking and pseudo-BMA weights; Marginal likelihood estimation; Bayes factors with conventional interpretation bands. |
| **Hidden Markov models** | Forward-backward with scaling; Viterbi decoding; Baum-Welch parameter estimation; Mean first passage times; Hitting probabilities and the fundamental matrix; Second-largest eigenvalue modulus and mixing rate; Periodicity and reversibility checks; Markov property testing and order selection. |

#### Decisions

| Tool | Methods |
|---|---|
| **Decision analysis** | Decision tree rollback; Expected value of perfect information; Expected value of sample information; Exponential and power utility; Certainty equivalent; Stochastic dominance; Minimax regret; Kelly criterion; Newsvendor model. |
| **Portfolio risk** | Portfolio mean, variance and correlation structure; Parametric, historical and simulated value at risk; Expected shortfall with its standard error; Marginal and component risk contributions; Markowitz mean-variance efficient frontier; Sharpe ratio and risk-adjusted comparison; Shapley and Euler risk allocation; Risk parity and Ledoit-Wolf shrinkage; Maximum drawdown distribution; Correlation stress testing. |
| **Sequential decisions** | Value iteration and policy iteration; Discounted and average-reward criteria; Optimal stopping and the secretary problem; POMDP belief updating; Thompson sampling and UCB; Epsilon-greedy with regret accounting; Lai-Robbins regret bound; Gittins indices; Expected value of information. |
| **Optimisation under uncertainty** | Gaussian chance constraints by reformulation; Bonferroni joint chance constraints; Calafiore-Campi sample sizing; Scenario approximation; CVaR-constrained linear programming; Tail sensitivity analysis; Simulated annealing. |

#### Systems

| Tool | Methods |
|---|---|
| **Reliability and failure** | Series, parallel and k-of-n structures; Minimal cut and path sets; Esary-Proschan bounds; Birnbaum and Fussell-Vesely importance; Fault tree analysis; Weibull and exponential lifetime models; Availability from MTBF and MTTR; Beta-factor common-cause model; Censored-data maximum likelihood. |
| **Queues and waiting** | Little's law; M/M/1, M/M/c and M/M/c/K; Erlang B and Erlang C; Pollaczek-Khinchine formula; Kingman approximation; Finite population and priority queues; Jackson networks; Capacity and cost optimisation. |
| **Networks and epidemics** | Erdos-Renyi, Watts-Strogatz and Barabasi-Albert generators; Degree distribution and assortativity; Centrality measures; Bond and site percolation thresholds; SIR and SEIR on a network and in the mean field; Basic and effective reproduction number; Independent-cascade and threshold models; Gillespie exact stochastic simulation; Targeted versus random node removal. |

#### Time

| Tool | Methods |
|---|---|
| **Time to event** | Kaplan-Meier estimator; Greenwood variance and log-log intervals; Nelson-Aalen cumulative hazard; Weighted log-rank tests; Cox proportional hazards; Schoenfeld residual diagnostics; Restricted mean survival time; Aalen-Johansen cumulative incidence; Required-events calculation. |
| **Time series** | Autocorrelation and partial autocorrelation; Ljung-Box test; Augmented Dickey-Fuller and KPSS; Classical and STL decomposition; Holt-Winters smoothing; Periodogram and dominant period; ARIMA by exact Kalman likelihood; Rolling-origin backtesting with MASE; PELT changepoint detection. |
| **Stochastic processes** | Poisson, non-homogeneous Poisson and compound Poisson; Renewal counting with the elementary renewal rate; Brownian motion with reflection-principle first passage; Geometric Brownian motion and the Ito correction; Ornstein-Uhlenbeck transient and stationary laws; Jump diffusion; Gambler’s ruin; Galton-Watson extinction probability; CTMC transient, stationary and hitting times. |
| **State estimation** | Kalman filter with Joseph and square-root forms; Exact Gaussian likelihood; EM parameter fitting; Direct likelihood maximisation; Innovation whiteness testing; Normalised estimation error squared; Interval coverage checks; Local level, local linear trend and constant velocity models; Extended Kalman filter with analytic or finite-difference Jacobians; Unscented Kalman filter (scaled unscented transform); Bootstrap and auxiliary particle filters; Effective sample size and weight-degeneracy diagnostics; Systematic, stratified, residual and multinomial resampling; Monte Carlo standard error for particle estimates; Noisy pendulum and logistic growth non-linear models. |

#### Data

| Tool | Methods |
|---|---|
| **Distribution fitting** | Maximum likelihood over 42 distributions; Method of moments; Profile-likelihood intervals; Anderson-Darling and Cramer-von Mises; Shapiro-Wilk and Jarque-Bera; AIC, AICc and BIC with Akaike weights; Q-Q plots with bootstrap envelopes; Gaussian mixtures by EM; Kernel density and ECDF bands. |

#### Uncertainty

| Tool | Methods |
|---|---|
| **Expert judgement** | Bisection and fixed-interval protocols; Probability wheels; Fitting elicited quantiles across families; Chip allocation; Partition, conjunction and subadditivity checks; Partition-dependence and anchoring detection; Linear and logarithmic opinion pools; Cooke’s classical method with cross-validation; Interval calibration and proper scoring. |
| **Imprecise probability** | Possibility and necessity measures; Dempster-Shafer belief and plausibility; Dempster, Yager and disjunctive combination; Probability boxes from intervals, moments or data; Williamson-Downs bounds without a dependence assumption; Credal sets and robust Bayes; Imprecise Dirichlet model; Fuzzy arithmetic by alpha-cuts. |

Plus **worked examples** and **a template for every one of the 42 tools**,
each a real running configuration rather than a description. A test asserts
that every tool is reachable from the library, and that every entry's settings
still exist on the tool it opens — so an entry cannot rot silently after the
tool it points at changes.

---

## How it is built

```
src/
  engine/          the mathematics — no UI imports, no AI imports
    core/          results, validation, exact rationals, numerics
    special/       log-gamma, incomplete gamma and beta, erf, normal quantile
    random/        seeded xoshiro128** generator and exact samplers
    distributions/ 42 distributions behind one interface
    combinatorics/ exact counting on BigInt
    probability/   basic probability, repeated trials, Bayes, conjugate updating
    experiments/   experiment models and exact convolution
    simulation/    the Monte Carlo framework, runner and built-in models
    scenario/      user-defined models, copulas, conditional parameters
    sensitivity/   sweeps, tornado, rank correlation, Sobol
    risk/          VaR, Expected Shortfall, risk registers
    stats/         descriptive statistics, hypothesis tests, datasets, Markov
    expression/    a safe expression parser (no eval)
    nonparametric/ rank tests, permutation tests, bootstrap and jackknife
    fitting/       distribution fitting and goodness of fit
    regression/    linear, robust and regularised regression
    timeseries/    autocorrelation, stationarity, decomposition, ARIMA
    survival/      Kaplan-Meier, Cox, parametric survival
    extremes/      generalised extreme value, peaks over threshold, tail index
    mcmc/          Metropolis-Hastings, Hamiltonian Monte Carlo, diagnostics
    bayesnet/      discrete Bayesian networks and exact inference
    decision/      decision trees, utility, value of information
    reliability/   system reliability, importance measures, fault trees
    queueing/      M/M/c and friends, networks of queues
    des/           discrete-event simulation with batch-means analysis
    processes/     Poisson, renewal, Brownian, Ornstein-Uhlenbeck, CTMC
    networks/      graph generators, percolation, epidemics on networks
    causal/        identification, propensity methods, instruments, DiD, RDD
    portfolio/     portfolio risk, allocation, efficient frontier
    gp/            Gaussian processes, kernels, Bayesian optimisation
    filtering/     Kalman, extended and unscented filters, particle filters
    hmm/           hidden Markov models and deep chain analysis
    copula/        rank correlation, copula fitting, tail dependence
    imprecise/     possibility, belief functions, p-boxes, credal sets
    elicitation/   elicitation protocols, coherence checks, expert pooling
    information/   entropy, divergence, channel capacity, scoring rules
    sequential/    Markov decision processes, stopping, bandits
    modelchoice/   information criteria, cross-validation, model averaging
    stochopt/      chance-constrained and CVaR-constrained optimisation
    qmc/           low-discrepancy sequences and variance reduction
    transforms/    FFT, spectra, characteristic functions, convolution
    jobs/          the job registry the worker and the main thread share
  workers/         the simulation worker and the general engine-job channel
  ui/              design system, primitives, charts
  app/             screens, tools, search and application state
  persistence/     the stored schema, configuration reconciliation, reports
  workers/         the simulation worker and its client
  persistence/     IndexedDB storage and the versioned file format
  ai/              the integration contract — no provider, no keys, no network
  examples/        worked examples and templates
```

Boundaries that matter and are maintained:

- the engine imports nothing from the UI and nothing from `ai/`;
- persistence holds no calculation logic;
- chart components receive values, they do not compute them;
- simulation models are serialisable configurations looked up by id, so the
  same code runs on the main thread, in a worker and in tests.

### Correctness

Results come from implemented, tested methods. Nothing is fabricated, and the
application distinguishes four kinds of value throughout — exact, numerical
approximation, empirical estimate, and user assumption — labelling each one in
the interface.

- **363 unit, property-based and integration tests.** Distributions are checked
  against reference values generated independently with SciPy
  (`scripts/generate_reference_values.py`); Sobol indices are checked against
  the Ishigami function's analytic indices; run probabilities are checked
  against exhaustive enumeration; hypothesis tests are checked against SciPy.
- **Property-based tests** (fast-check) for invariants: cumulative
  distributions are non-decreasing, mass functions sum to one, variance is
  non-negative, a seed reproduces its stream exactly.
- **32 end-to-end tests** driving the real application in a browser.

### Honesty about uncertainty

Several distinctions are enforced rather than left to the reader:

- a **confidence interval** for an estimated expectation is reported and
  labelled separately from **percentiles of simulated outcomes**; they are
  never conflated;
- an event that did not occur in a finite number of trials is reported as
  *not observed*, with the interval consistent with that, never as impossible;
- assuming independence is a user choice that must be stated, never a default;
  where the relationship between two events is unknown, bounds are given
  instead of a single number;
- weights that do not sum to one are treated as relative and the rescaling is
  shown — nothing is silently normalised;
- sampling without replacement uses the hypergeometric family, not the
  binomial;
- every dropped, missing or unreadable value in an imported file is counted and
  reported.

### Performance and limits

Simulations run in a Web Worker with real progress reporting and working
cancellation. (The runner is a generator that yields between chunks of trials;
a worker blocked in a synchronous loop could never receive a cancel message,
and `SharedArrayBuffer` is unavailable unless the page is cross-origin
isolated.)

Documented limits: 2,000,000 trials per run, 8,000,000 stored values, 500,000
data rows, 25 MB import, 200 scenario variables, 200 Markov states. Exceeding
one produces an explanation and a suggested reduction, not a freeze.

---

## Your data

Investigations, templates and preferences are stored in **IndexedDB in your own
browser**. Imported datasets are read with the File API and analysed in the
page; they are never uploaded and never written into a saved investigation.

If IndexedDB is unavailable — private browsing, blocked site data — the
application says so, falls back to in-memory storage for the session, and
recommends exporting.

Export produces a versioned JSON file (`orbis-chance.investigation`, format
version 1) containing the method, full configuration, assumptions, simulation
settings and seed. Re-running with the saved seed reproduces results exactly,
which is why raw sample arrays are not stored. Imports are validated before
anything is written, and an incoming identifier that already exists is added as
a new copy — an import never overwrites existing work. Tabular results also
export as CSV.

---

## AI

Orbis Chance contains **no AI client, no API keys and no network code**. Verify
it:

```bash
grep -rniE 'api[_-]?key|groq|mistral|openai|bearer |fetch\(|XMLHttpRequest' src/
```

What exists is a typed, versioned integration contract (`src/ai/`) that a
future Orbis host can implement to supply AI assistance. Until then every
AI-dependent feature shows an honest unavailable state together with the manual
route to the same outcome, and all deterministic functionality is unaffected.

The contract is shaped so that AI can never supply a number the application
presents as a result: no response type carries a probability, expectation or
test statistic. A host suggests a *model*; the engine validates it and computes
the answer.

See [`docs/AI_INTEGRATION.md`](docs/AI_INTEGRATION.md).

---

## Accessibility

Keyboard navigable throughout, with a skip link and focus trapping in dialogs.
Every chart carries an accessible description and a "Show values" table, so no
information is available only as a picture. Status is never conveyed by colour
alone — notices carry a text prefix and an icon, and the active navigation item
has a shape indicator. The categorical chart palette was validated for
colour-vision deficiency in both light and dark themes, and an optional texture
setting adds pattern fills. The OS reduced-motion setting is honoured, and
there is an in-app override.

---

## Known limitations

- **Sobol indices need many model evaluations** (N × (k + 2)). The interface
  estimates the cost before you run it, but a large configuration still takes
  minutes.
- **Correlated inputs use a Gaussian copula**, which has no tail dependence.
  Models where extremes must coincide more often than that need a different
  copula family, which is not implemented; the limitation is stated with every
  result that uses one.
- **The Kolmogorov–Smirnov p-value is asymptotic**, accurate for roughly 30 or
  more observations, and conservative if the reference parameters were
  estimated from the same data. Both caveats are shown with the result.
- **Exact factorials are computed up to 20,000**; beyond that an accurate
  logarithmic approximation is used and labelled as such.
- **Deep-linking to a specific saved investigation** works, but the tool
  configuration itself is not encoded in the URL, so links cannot carry an
  unsaved setup. A configuration in progress survives navigating between tools,
  but it is held in memory: a reload starts the tool fresh unless you saved it.
- **The transition-matrix editor takes up to 10 states.** The engine is not
  limited to 10; the editor is, because beyond that a hand-typed grid stops
  being usable.
- **The Data Lab holds the imported dataset in memory only.** Reopening a saved
  data-lab investigation restores the analysis settings, and you reload the
  file — deliberate, so datasets are never written into storage or an export.

---

## Licence

No licence has been specified for this repository.
