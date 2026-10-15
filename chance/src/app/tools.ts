/**
 * The tool catalogue: the single source of truth for navigation, the home
 * screen, templates and the AI contract's method list. Every entry maps to an
 * implemented screen — there are no placeholder destinations.
 */
import type { IconName } from '../ui/icons';
import type { ToolId } from '../persistence/schema';

export type ToolCategory =
  | 'Probability'
  | 'Distributions'
  | 'Experiments'
  | 'Simulation'
  | 'Analysis'
  | 'Data'
  // Added with the capability expansion. 'Decisions' covers choosing under
  // uncertainty, 'Systems' covers reliability and queueing, 'Time' covers
  // anything where order matters, and 'Inference' covers drawing conclusions
  // from evidence rather than computing a probability from a model.
  | 'Decisions'
  | 'Systems'
  | 'Time'
  // Bounds rather than a point estimate: a different kind of answer, so a
  // category of its own rather than filed under 'Probability'.
  | 'Uncertainty'
  | 'Inference';

export interface ToolInfo {
  id: ToolId;
  name: string;
  /** One-line description for cards and the navigation. */
  summary: string;
  /** Longer description shown on the tool page. */
  description: string;
  icon: IconName;
  category: ToolCategory;
  /** Runs simulations, so it needs trials and a seed. */
  usesSimulation: boolean;
  /** What this tool answers, in question form. */
  questions: string[];
  /** Methods it implements, named for the explanation panel and the AI contract. */
  methods: string[];
}

export const TOOLS: ToolInfo[] = [
  {
    id: 'probability-basics',
    name: 'Probability basics',
    summary: 'Convert between forms, take complements, and read a probability correctly.',
    description:
      'Enter a probability as a decimal, percentage or fraction and see every equivalent form, its complement and its odds. Exact fractions are preserved where the arithmetic allows.',
    icon: 'target',
    category: 'Probability',
    usesSimulation: false,
    questions: ['What is 1 in 8 as a percentage?', 'What is the probability that this does not happen?', 'What are the odds against this event?'],
    methods: ['Complement rule', 'Probability, percentage, fraction and odds conversion', 'Clopper-Pearson exact binomial intervals', 'Wilson score intervals'],
  },
  {
    id: 'event-relationships',
    name: 'Event relationships',
    summary: 'Combine two events once you have stated how they relate.',
    description:
      'Work out the probability that both events happen, that either happens, or that one happens given the other. The relationship between the events must be stated: nothing is assumed independent. When the relationship is unknown, the tool gives the tightest bounds instead of inventing a single answer.',
    icon: 'combinatorics',
    category: 'Probability',
    usesSimulation: false,
    questions: ['What is the probability that both events occur?', 'Are these two events independent?', 'What is P(A given B)?'],
    methods: ['Multiplication rule', 'General addition rule', 'Conditional probability', 'Fréchet–Hoeffding bounds'],
  },
  {
    id: 'combinatorics',
    name: 'Counting and combinatorics',
    summary: 'Permutations, combinations and arrangements, computed exactly.',
    description:
      'Count the ways a selection can be made, with or without repetition and with or without regard to order. Results are exact integers of any size, with the formula and a worked interpretation.',
    icon: 'combinatorics',
    category: 'Probability',
    usesSimulation: false,
    questions: ['How many ways can 5 cards be dealt from 52?', 'How many 4-digit codes exist?', 'How many distinct arrangements does a word have?'],
    methods: ['Factorials', 'Permutations', 'Combinations', 'Selections with repetition', 'Multinomial coefficients'],
  },
  {
    id: 'repeated-trials',
    name: 'Repeated trials',
    summary: 'Questions about many attempts: at least one, exactly k, runs, and waiting times.',
    description:
      'Answer questions about repeating a trial: the chance of at least one success, of exactly a given number, of a run of consecutive successes, and how many attempts are needed to reach a target probability. Dependent draws without replacement are handled with the hypergeometric distribution rather than the binomial.',
    icon: 'repeat',
    category: 'Probability',
    usesSimulation: false,
    questions: ['What is the chance of at least one six in ten rolls?', 'How many attempts do I need for a 95% chance of success?', 'What is the chance of five heads in a row?'],
    methods: ['Binomial distribution', 'Geometric distribution', 'Negative binomial distribution', 'Hypergeometric distribution', 'Exact run recursion'],
  },
  {
    id: 'bayes',
    name: "Bayes' theorem",
    summary: 'Update a probability when evidence arrives, with the full breakdown.',
    description:
      'Enter prior probabilities and the likelihood of the evidence under each hypothesis to obtain the posterior probabilities, with every intermediate quantity shown. Includes a diagnostic-test view using sensitivity, specificity and the base rate.',
    icon: 'bayes',
    category: 'Probability',
    usesSimulation: false,
    questions: ['A test is 99% accurate — how likely is it that I have the condition?', 'How much should this evidence change my belief?', 'Which explanation is most likely given what I observed?'],
    methods: ["Bayes' theorem", 'Law of total probability', 'Bayes factors', 'Diagnostic predictive values'],
  },
  {
    id: 'bayesian-updating',
    name: 'Bayesian updating',
    summary: 'Learn an unknown rate or probability from data, with credible intervals.',
    description:
      'Start from a prior distribution over an unknown quantity and update it with observed data using exact conjugate relationships: Beta–Binomial for a probability, Gamma–Poisson for a rate, and Normal–Normal for a mean.',
    icon: 'distribution',
    category: 'Probability',
    usesSimulation: false,
    questions: ['What is the success rate given 7 successes in 10 attempts?', 'How uncertain is my estimate of this rate?', 'What should I expect from the next observation?'],
    methods: ['Beta–Binomial conjugate update', 'Gamma–Poisson conjugate update', 'Normal–Normal conjugate update', 'Credible intervals', 'Posterior predictive distributions'],
  },
  {
    id: 'distribution-explorer',
    name: 'Distribution explorer',
    summary: 'Twenty distributions: parameters, graphs, interval probabilities and comparisons.',
    description:
      'Choose a distribution, adjust its parameters and read its density or mass function, cumulative distribution, summary statistics and quantiles. Calculate the probability of any interval, compare two distributions on one chart, and export the curve.',
    icon: 'distribution',
    category: 'Distributions',
    usesSimulation: false,
    questions: ['What is the chance a value falls between two bounds?', 'What does this distribution look like with these parameters?', 'How do these two distributions differ?'],
    methods: ['Probability mass and density functions', 'Cumulative distribution functions', 'Quantile functions', 'Moments and summary statistics'],
  },
  {
    id: 'experiment',
    name: 'Experiment laboratory',
    summary: 'Coins, dice, cards, urns and custom outcome sets, repeated many times.',
    description:
      'Set up a random experiment and repeat it as often as you like. Observed frequencies are compared with the exact theoretical distribution, and sampling without replacement correctly tracks what remains after each draw.',
    icon: 'dice',
    category: 'Experiments',
    usesSimulation: true,
    questions: ['How close do observed frequencies get to the theory?', 'What happens when a die is biased?', 'What is the chance of drawing two aces without replacement?'],
    methods: ['Seeded pseudorandom sampling', 'Exact convolution of outcome distributions', 'Empirical versus theoretical frequency comparison'],
  },
  {
    id: 'simulation',
    name: 'Monte Carlo simulation',
    summary: 'Built-in models: π estimation, dice sums, project schedules, queues and more.',
    description:
      'Run a Monte Carlo simulation of a built-in model with a chosen number of trials and a recorded seed. Results include summary statistics, histograms, empirical cumulative distributions, convergence plots and a comparison with the exact value where one exists.',
    icon: 'simulation',
    category: 'Simulation',
    usesSimulation: true,
    questions: ['How does an estimate improve as trials increase?', 'How long will this project take?', 'How long will customers wait in this queue?'],
    methods: ['Monte Carlo estimation', 'Convergence analysis', 'Confidence intervals for simulation estimates', 'Comparison with closed-form results'],
  },
  {
    id: 'scenario',
    name: 'Scenario builder',
    summary: 'Build your own model: variables, dependencies, derived values and metrics.',
    description:
      'Define variables as fixed values, distributions, categories or expressions of one another, link them with rank correlations or conditional parameters, and record any output metric you can write as a formula. Scenarios can be compared side by side.',
    icon: 'scenario',
    category: 'Simulation',
    usesSimulation: true,
    questions: ['What happens to the result if this assumption changes?', 'How do two plans compare under uncertainty?', 'What is the chance my total exceeds a threshold?'],
    methods: ['Monte Carlo simulation of a user-defined model', 'Gaussian copula correlation', 'Conditional distribution parameters', 'Scenario comparison'],
  },
  {
    id: 'sensitivity',
    name: 'Sensitivity analysis',
    summary: 'Find which inputs actually drive the result: sweeps, tornado charts and Sobol indices.',
    description:
      'Vary one parameter across a range, compare the swing produced by several parameters, measure rank correlation between sampled inputs and the output, or decompose the output variance into first-order and total Sobol indices.',
    icon: 'sensitivity',
    category: 'Analysis',
    usesSimulation: true,
    questions: ['Which input matters most?', 'How much does the answer move if this input is wrong?', 'How much of the variation comes from interactions?'],
    methods: ['One-at-a-time parameter sweep', 'Tornado diagram comparison', 'Spearman rank correlation', 'Saltelli variance decomposition (Sobol indices)'],
  },
  {
    id: 'risk',
    name: 'Risk explorer',
    summary: 'Loss distributions, Value at Risk, Expected Shortfall and a risk register.',
    description:
      'Model losses as a frequency and a severity, then read the resulting loss distribution, the probability of exceeding a threshold, Value at Risk and Expected Shortfall. A separate register summarises individual risks by probability and impact, including mitigation options.',
    icon: 'risk',
    category: 'Analysis',
    usesSimulation: true,
    questions: ['How bad could the worst cases be?', 'What is the chance of exceeding this loss?', 'Which mitigation is worth its cost?'],
    methods: ['Compound frequency–severity model', 'Empirical Value at Risk and Expected Shortfall', 'Threshold exceedance probability', 'Expected-value risk register'],
  },
  {
    id: 'data-lab',
    name: 'Data lab',
    summary: 'Import a CSV or JSON file: statistics, relationships, tests and the bootstrap.',
    description:
      'Load a dataset from your own computer and analyse it locally. Descriptive statistics, histograms, correlations, grouped comparisons, hypothesis tests and bootstrap intervals, with every dropped or unreadable value accounted for. The file never leaves your browser.',
    icon: 'data',
    category: 'Data',
    usesSimulation: true,
    questions: ['What does this dataset look like?', 'Do these two groups really differ?', 'How uncertain is this estimate?'],
    methods: ['Descriptive statistics', 'Correlation and rank correlation', 't tests, chi-square, Mann–Whitney, Kolmogorov–Smirnov, ANOVA', 'Bootstrap resampling', 'Permutation tests'],
  },
  {
    id: 'markov',
    name: 'Markov chains',
    summary: 'States and transitions: n-step behaviour, long-run distribution and absorption.',
    description:
      'Define a set of states and the probability of moving between them, then read the exact distribution after any number of steps, the long-run stationary distribution, the chain structure, and expected times to absorption. All computed by linear algebra, with optional path simulation.',
    icon: 'markov',
    category: 'Analysis',
    usesSimulation: true,
    questions: ['Where will this process end up in the long run?', 'How long until it reaches this state?', 'What is the chance of ending in this state rather than that one?'],
    methods: ['n-step transition matrices', 'Stationary distributions', 'Chain classification and periodicity', 'Fundamental matrix absorption analysis'],
  },
  {
    id: 'decision',
    name: 'Decision analysis',
    summary: 'Turn probabilities into a decision, and price the risk you are taking.',
    description:
      'Roll back a decision tree to the optimal policy, work out what information would be worth paying for, and see how the recommendation changes with your attitude to risk. When probabilities genuinely are not known, the criteria that need none are shown side by side — along with the fact that they disagree, which is a value judgement rather than a calculation.',
    icon: 'decision',
    category: 'Decisions',
    usesSimulation: false,
    questions: ['Which option should I choose?', 'What would it be worth to know this in advance?', 'Should I pay for this test?', 'How risk-averse would I have to be to change my mind?'],
    methods: ['Decision tree rollback', 'Expected value of perfect information', 'Expected value of sample information', 'Exponential and power utility', 'Certainty equivalent', 'Stochastic dominance', 'Minimax regret', 'Kelly criterion', 'Newsvendor model'],
  },
  {
    id: 'bayes-network',
    name: 'Bayesian networks',
    summary: 'State how everything depends on everything else, then ask any question of it.',
    description:
      'Build a network of variables and their conditional probabilities, then compute any conditional probability from it exactly. Check whether two variables are independent given a third, and see the paths that make them dependent when they are not. The causal panel separates seeing from doing: P(Y given X) and P(Y given do(X)) are different questions, and the gap between them is the confounding.',
    icon: 'network',
    category: 'Inference',
    usesSimulation: false,
    questions: ['What is the probability of this given everything I have observed?', 'Are these two variables independent once I know the third?', 'What would happen if I intervened, rather than merely observed?', 'Which variables do I need to adjust for?'],
    methods: ['Variable elimination', 'Junction tree belief propagation', 'Most probable explanation', 'd-separation', 'Do-operator by graph surgery', 'Back-door and front-door criteria', 'Conditional probability table learning'],
  },
  {
    id: 'reliability',
    name: 'Reliability and failure',
    summary: 'Work out whether a system holds, from what you know about its parts.',
    description:
      'Compute system reliability exactly from component reliabilities for series, parallel, k-of-n and bridge structures, find the minimal cut sets that bring the system down, and rank components by how much the system depends on them. Lifetime models give the reliability and hazard over time, and the common-cause panel shows how much the usual assumption of independent failures is flattering your answer.',
    icon: 'reliability',
    category: 'Systems',
    usesSimulation: false,
    questions: ['How likely is this system to survive the mission?', 'Which component deserves the maintenance budget?', 'How much does redundancy actually buy me?', 'Is this wearing out, or failing at random?'],
    methods: ['Series, parallel and k-of-n structures', 'Minimal cut and path sets', 'Esary-Proschan bounds', 'Birnbaum and Fussell-Vesely importance', 'Fault tree analysis', 'Weibull and exponential lifetime models', 'Availability from MTBF and MTTR', 'Beta-factor common-cause model', 'Censored-data maximum likelihood'],
  },
  {
    id: 'queueing',
    name: 'Queues and waiting',
    summary: 'How long the queue gets, and how many servers it takes to fix it.',
    description:
      'Exact steady-state results for the standard queueing models: the queue length, the waiting time, the chance of waiting longer than a given time, and the blocking probability. Solve for the minimum number of servers that meets a service target, or the number that minimises total cost. The utilisation curve shows why the last few percent of capacity is so expensive.',
    icon: 'queue',
    category: 'Systems',
    usesSimulation: false,
    questions: ['How long will people wait?', 'How many servers do I need to keep the wait under a minute?', 'What happens if demand rises by ten percent?', 'How much does variable service time cost me?'],
    methods: ["Little's law", 'M/M/1, M/M/c and M/M/c/K', 'Erlang B and Erlang C', 'Pollaczek-Khinchine formula', 'Kingman approximation', 'Finite population and priority queues', 'Jackson networks', 'Capacity and cost optimisation'],
  },
  {
    id: 'survival',
    name: 'Time to event',
    summary: 'How long until it happens, when some cases have not happened yet.',
    description:
      'Estimate and compare survival curves from data where some observations are censored — the subject had not had the event when you stopped watching. Censoring is what makes this its own field: dropping those observations biases the answer downward, and counting them as events biases it too. Includes the log-rank family, Cox regression with its proportional-hazards check, and competing risks.',
    icon: 'survival',
    category: 'Time',
    usesSimulation: false,
    questions: ['What is the survival curve for each group?', 'Is the difference between these groups real?', 'What is the median time to failure?', 'How many events do I need for the study to be conclusive?'],
    methods: ['Kaplan-Meier estimator', 'Greenwood variance and log-log intervals', 'Nelson-Aalen cumulative hazard', 'Weighted log-rank tests', 'Cox proportional hazards', 'Schoenfeld residual diagnostics', 'Restricted mean survival time', 'Aalen-Johansen cumulative incidence', 'Required-events calculation'],
  },
  {
    id: 'bayesian-inference',
    name: 'Bayesian inference',
    summary: 'Update any prior with any likelihood, not just the conjugate ones.',
    description:
      'Markov chain Monte Carlo over a model you choose, which removes the conjugacy restriction of the other Bayesian tools. Every run reports its convergence diagnostics first, because a chain that has not converged does not have a posterior mean worth reading — and for the conjugate cases the sampler is shown beside the exact analytic answer so you can see it agreeing.',
    icon: 'mcmc',
    category: 'Inference',
    usesSimulation: true,
    questions: ['What is the posterior when the prior is not conjugate?', 'Has this chain actually converged?', 'What is the credible interval for this parameter?', 'What does the model predict for a new observation?'],
    methods: ['Random-walk Metropolis-Hastings', 'Adaptive Metropolis-Hastings', 'Hamiltonian Monte Carlo', 'Slice sampling', 'Gibbs sampling', 'Split and rank-normalised R-hat', 'Effective sample size', 'Highest density interval', 'Posterior predictive sampling'],
  },
  {
    id: 'extremes',
    name: 'Extreme values',
    summary: 'How bad the worst case can get, beyond anything you have observed.',
    description:
      'Fit the limiting distributions of extremes — generalised extreme value by block maxima, generalised Pareto over a threshold — and read off return levels and tail risk at levels no sample can reach. A simulation cannot tell you about a one-in-ten-thousand event from ten thousand trials; extrapolating the tail is the only honest route, and this tool shows how uncertain that extrapolation is.',
    icon: 'extremes',
    category: 'Analysis',
    usesSimulation: false,
    questions: ['What is the hundred-year level?', 'How often will this threshold be exceeded?', 'Is there an upper bound at all?', 'What is value at risk at 99.99%?'],
    methods: ['Generalised extreme value distribution', 'Generalised Pareto distribution', 'Block maxima and peaks over threshold', 'Maximum likelihood with profile intervals', 'Return levels and return periods', 'Hill and Pickands tail index estimators', 'Runs declustering', 'Extreme value theory VaR and expected shortfall'],
  },
  {
    id: 'regression',
    name: 'Regression modelling',
    summary: 'How one quantity depends on others, with the uncertainty stated honestly.',
    description:
      'Fit a linear model, a generalised linear model or a penalised one, and get the diagnostics that decide whether the fit means anything: collinearity, leverage, influence, heteroskedasticity, and out-of-sample performance beside the in-sample fit. A confidence band for the mean response and a prediction band for a new observation are different widths answering different questions, and both are shown.',
    icon: 'regression',
    category: 'Analysis',
    usesSimulation: false,
    questions: ['How does the outcome depend on these predictors?', 'Which observations are driving the result?', 'Can this model predict out of sample?', 'How wide is the interval for a new case?'],
    methods: ['Ordinary and weighted least squares by QR', 'Robust HC0-HC3 standard errors', 'Ridge, lasso and elastic net', 'Logistic and Poisson regression', 'Leverage, Cook distance and DFFITS', 'Breusch-Pagan and White tests', 'Leave-one-out and k-fold cross-validation', 'ROC curves and AUC'],
  },
  {
    id: 'distribution-fitting',
    name: 'Distribution fitting',
    summary: 'Which distribution describes your data, and how well it really fits.',
    description:
      'Fit every compatible distribution to a sample, rank them by information criteria, and test the fit from several directions — because any single goodness-of-fit test can mislead. Once a distribution is fitted it can feed the simulation and risk tools, which is the link between data and modelling the app previously lacked. A test that fails to reject is not evidence the distribution is right, and the tool says so.',
    icon: 'fitting',
    category: 'Data',
    usesSimulation: false,
    questions: ['Which distribution fits this data?', 'Is a normal distribution defensible here?', 'What are the parameters, and how uncertain are they?', 'What if no parametric family fits?'],
    methods: ['Maximum likelihood over 42 distributions', 'Method of moments', 'Profile-likelihood intervals', 'Anderson-Darling and Cramer-von Mises', 'Shapiro-Wilk and Jarque-Bera', 'AIC, AICc and BIC with Akaike weights', 'Q-Q plots with bootstrap envelopes', 'Gaussian mixtures by EM', 'Kernel density and ECDF bands'],
  },
  {
    id: 'hypothesis-tests',
    name: 'Hypothesis tests',
    summary: 'Compare groups, with or without a normality assumption, and know what a null result means.',
    description:
      'Tests for two groups, paired data, several groups, variances and categorical tables, with the exact null distribution used wherever it is computable. Every result reports the achieved power and the minimum detectable effect, because "not significant" from a small sample means almost nothing and most tools let the reader conclude otherwise. Post-hoc comparisons always carry their multiplicity control.',
    icon: 'tests',
    category: 'Analysis',
    usesSimulation: false,
    questions: ['Is the difference between these groups real?', 'What if the data is not normal?', 'How do I compare more than two groups?', 'Does a non-significant result mean there is no effect?'],
    methods: ['Mann-Whitney and Brunner-Munzel', 'Wilcoxon signed-rank and sign tests', 'Welch t-test, one-way and Welch ANOVA', 'Kruskal-Wallis and Friedman', "Fisher's exact test", 'Tukey, Dunn and Games-Howell post-hoc', 'Holm, Hochberg and Benjamini-Hochberg', 'Permutation tests and BCa bootstrap', 'Minimum detectable effect'],
  },
  {
    id: 'time-series',
    name: 'Time series',
    summary: 'Data where the order matters: structure, forecasts, and what autocorrelation does to your errors.',
    description:
      'Autocorrelation, stationarity testing, decomposition, spectral analysis, ARIMA fitting and forecasting, with backtests always shown against the naive baseline. The effective-sample-size panel matters beyond this tool: the rest of the app assumes independent observations, and on autocorrelated data that understates every standard error, sometimes by a large factor.',
    icon: 'timeseries',
    category: 'Time',
    usesSimulation: false,
    questions: ['Is there a trend, a cycle or a season here?', 'Is this series stationary?', 'What is the forecast, and how wide is it really?', 'Can this model beat simply using the last value?'],
    methods: ['Autocorrelation and partial autocorrelation', 'Ljung-Box test', 'Augmented Dickey-Fuller and KPSS', 'Classical and STL decomposition', 'Holt-Winters smoothing', 'Periodogram and dominant period', 'ARIMA by exact Kalman likelihood', 'Rolling-origin backtesting with MASE', 'PELT changepoint detection'],
  },
  {
    id: 'causal',
    name: 'Causal inference',
    summary: 'Whether this dataset can answer a causal question at all, and what it takes to believe the answer.',
    description:
      'Graphical identification before estimation: back-door and front-door criteria, d-separation, instrumental variables, difference-in-differences and regression discontinuity, with propensity and matching diagnostics. The point of the identification step is that it can fail, and when it does the tool says the effect is not identified from these variables rather than returning a number. An adjusted association is not a causal effect unless the graph says it is.',
    icon: 'causal',
    category: 'Analysis',
    usesSimulation: false,
    questions: ['Is this effect identified from the variables I have?', 'What must I adjust for, and what must I not?', 'How strong would unmeasured confounding have to be to explain this away?', 'Does my instrument or discontinuity actually hold?'],
    methods: ['d-separation and back-door identification', 'Front-door criterion', 'Inverse-probability weighting', 'Propensity score matching with balance diagnostics', 'Instrumental variables with weak-instrument testing', 'Difference-in-differences with a parallel-trends check', 'Regression discontinuity', 'E-value and sensitivity to unmeasured confounding'],
  },
  {
    id: 'networks',
    name: 'Networks and epidemics',
    summary: 'Spread, reachability and failure across a network, where the structure drives the outcome more than the rate does.',
    description:
      'Network construction and metrics, percolation thresholds, SIR and SEIR dynamics on a network and in the mean field, and cascade models. Degree heterogeneity is the result worth internalising: in a network with a heavy-tailed degree distribution the epidemic threshold can approach zero, so a disease with a reproduction number below one in a homogeneous model can still spread. The tool shows both so the difference is visible rather than assumed away.',
    icon: 'epidemic',
    category: 'Systems',
    usesSimulation: true,
    questions: ['Will this spread, or die out?', 'Which nodes matter most to remove?', 'Does my network stay connected as links fail?', 'How much does degree heterogeneity change the threshold?'],
    methods: ['Erdos-Renyi, Watts-Strogatz and Barabasi-Albert generators', 'Degree distribution and assortativity', 'Centrality measures', 'Bond and site percolation thresholds', 'SIR and SEIR on a network and in the mean field', 'Basic and effective reproduction number', 'Independent-cascade and threshold models', 'Gillespie exact stochastic simulation', 'Targeted versus random node removal'],
  },
  {
    id: 'processes',
    name: 'Stochastic processes',
    summary: 'Processes that evolve in continuous time: exact laws where they exist, simulated paths where they do not.',
    description:
      'Poisson and renewal counting, Brownian motion, geometric Brownian motion, Ornstein-Uhlenbeck, jump diffusions, random walks, branching processes and continuous-time Markov chains. Closed-form marginals and first-passage probabilities are labelled exact; everything else is simulated and labelled as such. The fan chart appears twice on purpose, once for the spread of individual paths and once for uncertainty in the mean, because they narrow at different rates and conflating them overstates what the ensemble tells you.',
    icon: 'processes',
    category: 'Time',
    usesSimulation: true,
    questions: ['What is the distribution of this process at time t?', 'How likely is it to cross this level before then?', 'Will this population go extinct?', 'How long until this chain reaches that state?'],
    methods: ['Poisson, non-homogeneous Poisson and compound Poisson', 'Renewal counting with the elementary renewal rate', 'Brownian motion with reflection-principle first passage', 'Geometric Brownian motion and the Ito correction', 'Ornstein-Uhlenbeck transient and stationary laws', 'Jump diffusion', 'Gambler\u2019s ruin', 'Galton-Watson extinction probability', 'CTMC transient, stationary and hitting times'],
  },
  {
    id: 'portfolio',
    name: 'Portfolio risk',
    summary: 'Risk across holdings that move together, where the correlations do most of the damage.',
    description:
      'Portfolio moments, value at risk and expected shortfall, risk contributions, the efficient frontier and drawdown analysis. Diversification is reported against its actual dependence structure rather than an assumed one, because the correlation that matters is the one in the tail: holdings that look weakly related in ordinary conditions can move together in a crisis, and a model fitted on calm data will not show that.',
    icon: 'portfolio',
    category: 'Decisions',
    usesSimulation: true,
    questions: ['How much can this portfolio lose, and how often?', 'Which holding contributes most of the risk?', 'How much diversification am I actually getting?', 'What happens to this allocation under a correlation shock?'],
    methods: ['Portfolio mean, variance and correlation structure', 'Parametric, historical and simulated value at risk', 'Expected shortfall with its standard error', 'Marginal and component risk contributions', 'Markowitz mean-variance efficient frontier', 'Sharpe ratio and risk-adjusted comparison', 'Shapley and Euler risk allocation', 'Risk parity and Ledoit-Wolf shrinkage', 'Maximum drawdown distribution', 'Correlation stress testing'],
  },
  {
    id: 'des',
    name: 'Discrete-event simulation',
    summary: 'Systems where entities queue, seize resources and wait \u2014 simulated event by event rather than solved in closed form.',
    description:
      'An event-driven simulator for networks of queues and resources, with warm-up detection, batch-means confidence intervals and replication analysis. This is where to go when a system violates the assumptions the queueing formulas need: priorities, balking, finite buffers, routing, shift patterns. The statistics are the hard part and the tool treats them as such \u2014 autocorrelated output makes a naive confidence interval far too narrow, so the interval here comes from batch means with the batch size justified.',
    icon: 'des',
    category: 'Simulation',
    usesSimulation: true,
    questions: ['How long will entities wait in this system?', 'Where is the bottleneck?', 'How many servers do I actually need?', 'How long must I run before the numbers mean anything?'],
    methods: ['Event-driven simulation with a future event list', 'Multi-stage queue and resource networks', 'Priority, balking and reneging', 'Warm-up period detection', 'Batch-means confidence intervals', 'Independent replications', 'Resource utilisation and bottleneck analysis'],
  },
  {
    id: 'information',
    name: 'Information theory',
    summary: 'How much a message, a measurement or a forecast actually tells you \u2014 in bits.',
    description:
      'Entropy, mutual information, divergences, maximum-entropy distributions, channel capacity, Fisher information and proper scoring rules. The scoring section is the one with teeth: a proper rule is minimised by telling the truth, and the tool demonstrates that the absolute score is not proper rather than merely asserting it, which matters because scoring a forecaster with an improper rule rewards them for misreporting.',
    icon: 'information',
    category: 'Analysis',
    usesSimulation: false,
    questions: ['How much uncertainty is in this distribution?', 'How much does knowing X tell me about Y?', 'Which measurement is worth taking?', 'Is this scoring rule rewarding honesty?'],
    methods: ['Shannon, Renyi and min-entropy', 'Mutual information with a permutation test', 'Kullback-Leibler and Jensen-Shannon divergence', 'Pinsker and Bretagnolle-Huber bounds', 'Maximum entropy under moment constraints', 'Brier and log scores with Murphy decomposition', 'Calibration, sharpness and PIT histograms', 'Blahut-Arimoto channel capacity', 'Continuous ranked probability score (CRPS)', 'Fisher information and expected information gain'],
  },
  {
    id: 'elicitation',
    name: 'Expert judgement',
    summary: 'Turning an opinion into a distribution, without pretending the result is a measurement.',
    description:
      'Elicitation protocols, fitting a distribution to stated quantiles, coherence and bias checks, combining several experts, and scoring how good a judge turned out to be. Every result here is labelled assumed, because it is: it rests on what someone said. Two findings are built in rather than described \u2014 stated probabilities over a partition routinely fail to sum to one, and the family chosen to fit the same three quantiles can change a tail probability by a large factor.',
    icon: 'elicitation',
    category: 'Uncertainty',
    usesSimulation: false,
    questions: ['How do I turn this expert\u2019s opinion into a distribution?', 'Are these stated probabilities even coherent?', 'How should I combine disagreeing experts?', 'Has this forecaster been any good?'],
    methods: ['Bisection and fixed-interval protocols', 'Probability wheels', 'Fitting elicited quantiles across families', 'Chip allocation', 'Partition, conjunction and subadditivity checks', 'Partition-dependence and anchoring detection', 'Linear and logarithmic opinion pools', 'Cooke\u2019s classical method with cross-validation', 'Interval calibration and proper scoring'],
  },
  {
    id: 'sequential',
    name: 'Sequential decisions',
    summary: 'Decisions taken one after another, where what you do now changes what you learn next.',
    description:
      'Markov decision processes, optimal stopping, partially observed problems and bandit algorithms. The distinguishing feature of a sequential problem is that information has value: the best first action may be the one that teaches you most rather than the one that pays most, and a policy that ignores that is beaten by one that does not. Regret is reported against the Lai-Robbins bound, which constrains the limiting behaviour rather than any single run.',
    icon: 'sequential',
    category: 'Decisions',
    usesSimulation: true,
    questions: ['What should I do now, given what happens next?', 'When should I stop and take what I have?', 'How do I trade exploring against exploiting?', 'How much is this information worth?'],
    methods: ['Value iteration and policy iteration', 'Discounted and average-reward criteria', 'Optimal stopping and the secretary problem', 'POMDP belief updating', 'Thompson sampling and UCB', 'Epsilon-greedy with regret accounting', 'Lai-Robbins regret bound', 'Gittins indices', 'Expected value of information'],
  },
  {
    id: 'gaussian-process',
    name: 'Gaussian processes',
    summary: 'A distribution over functions: predictions that widen honestly where you have no data.',
    description:
      'Kernel construction, exact conditioning, hyperparameter fitting, leave-one-out calibration, sparse approximations and Bayesian optimisation. The reason to reach for this rather than a regression line is the interval: a Gaussian process widens where the data thins out, and the screen keeps the band for the underlying function separate from the wider band for a new observation, because those are different questions and the gap between them is the measurement noise.',
    icon: 'gp',
    category: 'Inference',
    usesSimulation: false,
    questions: ['What is this function between my data points?', 'How uncertain is the prediction out here?', 'Which kernel does this data support?', 'Where should I measure next?'],
    methods: ['Thirteen kernels with sums, products and scaling', 'Exact conditioning with jitter diagnostics', 'Hyperparameter fitting from multiple restarts', 'Automatic relevance determination', 'Leave-one-out predictive density and PIT', 'Subset-of-data, FITC and SoR approximations', 'Expected improvement and UCB acquisition', 'Bayesian optimisation with regret reporting'],
  },
  {
    id: 'state-filtering',
    name: 'State estimation',
    summary: 'Recovering a hidden state from noisy measurements, and checking whether the filter is honest.',
    description:
      'Kalman filtering and smoothing, the extended and unscented filters for non-linear models, particle filtering, and the diagnostics that say whether any of them deserves belief. The diagnostics are the point: a filter that reports intervals far too narrow looks precise and is wrong, so innovation whiteness, normalised error squared and interval coverage are shown alongside the estimates rather than buried. Missing observations contribute nothing instead of a substituted value.',
    icon: 'filtering',
    category: 'Time',
    usesSimulation: true,
    questions: ['What is the hidden state right now?', 'Are my filter\u2019s uncertainty estimates believable?', 'What are the noise parameters?', 'How should the filter handle a gap in the data?', 'Is my particle filter running on one surviving particle?', 'Has the extended Kalman filter diverged without saying so?'],
    methods: ['Kalman filter with Joseph and square-root forms', 'Exact Gaussian likelihood', 'EM parameter fitting', 'Direct likelihood maximisation', 'Innovation whiteness testing', 'Normalised estimation error squared', 'Interval coverage checks', 'Local level, local linear trend and constant velocity models', 'Extended Kalman filter with analytic or finite-difference Jacobians', 'Unscented Kalman filter (scaled unscented transform)', 'Bootstrap and auxiliary particle filters', 'Effective sample size and weight-degeneracy diagnostics', 'Systematic, stratified, residual and multinomial resampling', 'Monte Carlo standard error for particle estimates', 'Noisy pendulum and logistic growth non-linear models'],
  },
  {
    id: 'transforms',
    name: 'Transforms and spectra',
    summary: 'Moving between the time and frequency pictures of a signal, and between distributions and their transforms.',
    description:
      'Fast Fourier transforms, periodograms and spectral estimation, convolution, and characteristic and moment generating functions. A transform is where a sum of independent variables becomes a product and a repeated convolution becomes an exponent, which is why several results elsewhere in the application are computed here. Frequency axes carry their units and the sampling assumption is stated rather than left implicit, because aliasing is silent otherwise.',
    icon: 'transforms',
    category: 'Analysis',
    usesSimulation: false,
    questions: ['What frequencies are in this signal?', 'What is the distribution of this sum?', 'How do I convolve these distributions exactly?', 'Is this periodicity real or an artefact of my sampling?'],
    methods: ['Radix-2 and mixed-radix FFT', 'Periodogram with windowing', 'Welch spectral estimation', 'Fast convolution', 'Characteristic functions', 'Moment generating functions', 'Numerical inversion'],
  },
  {
    id: 'stochastic-optimisation',
    name: 'Optimisation under uncertainty',
    summary: 'Choosing a plan when the constraints themselves are random, with the reliability you asked for.',
    description:
      'Chance-constrained and CVaR-constrained programmes, scenario approximation with sample-size guarantees, and simulated annealing. A deterministic optimum sitting exactly on a constraint fails about half the time once that constraint is random, which is the whole reason for this screen. Where the solution is conservative \u2014 as the Bonferroni joint-chance route is \u2014 the tool reports the guarantee and the objective value given away for it rather than presenting the result as exact.',
    icon: 'stochopt',
    category: 'Decisions',
    usesSimulation: true,
    questions: ['What plan meets my constraints with 95% reliability?', 'How much does that reliability cost me?', 'How many scenarios do I need for a guarantee?', 'What does a tail constraint do to the solution?'],
    methods: ['Gaussian chance constraints by reformulation', 'Bonferroni joint chance constraints', 'Calafiore-Campi sample sizing', 'Scenario approximation', 'CVaR-constrained linear programming', 'Tail sensitivity analysis', 'Simulated annealing'],
  },
  {
    id: 'model-comparison',
    name: 'Model comparison',
    summary: 'Which of several models to believe, and whether the data can tell them apart at all.',
    description:
      'Information criteria, cross-validation, model averaging, stacking and Bayes factors. The answer worth having is often that the data cannot distinguish the candidates, so every difference in predictive performance is shown with its standard error: a difference smaller than its own uncertainty is not evidence, and ranking on it is reading noise. Where several models are credible, averaging over them beats picking one and pretending the choice was certain.',
    icon: 'modelchoice',
    category: 'Inference',
    usesSimulation: false,
    questions: ['Which of these models should I believe?', 'Can this data tell them apart at all?', 'Should I average over models instead of choosing?', 'How strong is this evidence, really?'],
    methods: ['AIC, AICc, BIC and WAIC', 'Deviance information criterion', 'K-fold and exact leave-one-out cross-validation', 'elpd differences with standard errors', 'Bayesian model averaging', 'Stacking and pseudo-BMA weights', 'Marginal likelihood estimation', 'Bayes factors with conventional interpretation bands'],
  },
  {
    id: 'quasi-monte-carlo',
    name: 'Quasi-Monte Carlo',
    summary: 'Deliberately even point sets that converge faster than random ones \u2014 and the discrepancy that says why.',
    description:
      'Halton, Faure and lattice sequences, quasi-Monte Carlo integration, discrepancy measures and convergence comparison. Random sampling clumps and leaves gaps; a low-discrepancy set does neither, and the error falls closer to 1/N than to 1/\u221aN. The honest catch is reported rather than glossed: plain QMC has no probabilistic error bar at all, only a deterministic bound, so a confidence interval appears solely for the randomised variant.',
    icon: 'qmc',
    category: 'Simulation',
    usesSimulation: true,
    questions: ['Can I get the same accuracy from fewer points?', 'How even is this point set really?', 'What is my actual convergence rate?', 'How do I get an error bar for a QMC estimate?'],
    methods: ['Halton sequences with scrambling and leaping', 'Faure sequences', 'Rank-1 lattice rules with generator search', 'Randomised QMC with shifts', 'L2 star and centred discrepancy', 'Koksma-Hlawka error bounds', 'Log-log convergence rate fitting'],
  },
  {
    id: 'hidden-markov',
    name: 'Hidden Markov models',
    summary: 'A chain you cannot see directly, inferred from what it emits \u2014 plus deep diagnostics for chains you can.',
    description:
      'Forward-backward inference, Viterbi decoding, Baum-Welch fitting, and chain analysis: first passage times, hitting probabilities, mixing rate, periodicity and reversibility. Two distinctions are kept visible because conflating them is the usual mistake: the Viterbi path is the single most likely sequence and need not agree with the pointwise most likely state at each step, and Baum-Welch finds a local optimum rather than the maximum likelihood.',
    icon: 'hmm',
    category: 'Inference',
    usesSimulation: false,
    questions: ['What state was the system in when I saw this?', 'What is the most likely sequence of hidden states?', 'How long until this chain reaches that state?', 'How quickly does this chain forget where it started?'],
    methods: ['Forward-backward with scaling', 'Viterbi decoding', 'Baum-Welch parameter estimation', 'Mean first passage times', 'Hitting probabilities and the fundamental matrix', 'Second-largest eigenvalue modulus and mixing rate', 'Periodicity and reversibility checks', 'Markov property testing and order selection'],
  },
  {
    id: 'copula',
    name: 'Dependence and copulas',
    summary: 'Separating what each variable does from how they move together \u2014 especially in the tail.',
    description:
      'Pseudo-observations, empirical copulas, rank correlations, copula fitting and family comparison, and tail dependence. This is the screen for the standing rule that independence is never assumed by default. The result to take away is that a Gaussian copula has zero tail dependence at any correlation whatsoever, so fitting one to calm data and extrapolating understates joint extremes \u2014 and two families matching the same Kendall tau can disagree sharply about exactly that, which the tool shows rather than hides behind a single fit.',
    icon: 'copula',
    category: 'Analysis',
    usesSimulation: true,
    questions: ['How do these variables move together?', 'What happens to both of them in a crisis?', 'Which dependence structure does my data support?', 'How much does the copula choice change the joint tail?'],
    methods: ['Pseudo-observations and empirical copulas', 'Kendall tau and Spearman rho', 'Gaussian, t, Clayton, Gumbel and Frank copulas', 'Fitting by inversion of Kendall tau', 'Family comparison on the same rank correlation', 'Upper and lower tail dependence coefficients', 'Gaussian and t copula sampling'],
  },
  {
    id: 'imprecise',
    name: 'Imprecise probability',
    summary: 'For when you genuinely do not know the probability: bounds instead of a number you cannot justify.',
    description:
      'Possibility and necessity measures, Dempster-Shafer belief functions, probability boxes, credal sets and fuzzy numbers. Every answer is an interval, because a single number would be a claim the evidence does not support. Two results here matter beyond this tool: combining highly conflicting evidence with Dempster\u2019s rule can produce a conclusion neither source held, and a sum computed without assuming independence is far wider than one that assumes it \u2014 which is the honest width when the dependence is unknown.',
    icon: 'imprecise',
    category: 'Uncertainty',
    usesSimulation: false,
    questions: ['What can I say when I do not know the probability?', 'How wide is this interval really?', 'What happens if I do not assume independence?', 'Which of these formalisms answers my question?'],
    methods: ['Possibility and necessity measures', 'Dempster-Shafer belief and plausibility', 'Dempster, Yager and disjunctive combination', 'Probability boxes from intervals, moments or data', 'Williamson-Downs bounds without a dependence assumption', 'Credal sets and robust Bayes', 'Imprecise Dirichlet model', 'Fuzzy arithmetic by alpha-cuts'],
  },
];

export const TOOLS_BY_ID = new Map(TOOLS.map((t) => [t.id, t]));

export function getTool(id: ToolId): ToolInfo {
  const t = TOOLS_BY_ID.get(id);
  if (!t) throw new Error(`Unknown tool "${id}".`);
  return t;
}

export const TOOL_CATEGORIES: ToolCategory[] = [
  'Probability',
  'Distributions',
  'Experiments',
  'Simulation',
  'Analysis',
  'Inference',
  'Decisions',
  'Systems',
  'Time',
  'Data',
  'Uncertainty',
];

/** Routes: a tool page, or one of the library screens. */
export type Route =
  | { kind: 'home' }
  | { kind: 'tool'; toolId: ToolId; investigationId?: string }
  | { kind: 'saved' }
  | { kind: 'templates' }
  | { kind: 'examples' }
  | { kind: 'settings' };

export function routeToHash(route: Route): string {
  switch (route.kind) {
    case 'home':
      return '#/';
    case 'tool':
      return route.investigationId ? `#/tool/${route.toolId}/${route.investigationId}` : `#/tool/${route.toolId}`;
    default:
      return `#/${route.kind}`;
  }
}

export function hashToRoute(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '');
  if (!clean) return { kind: 'home' };
  const parts = clean.split('/').filter(Boolean);
  if (parts[0] === 'tool' && parts[1]) {
    const toolId = parts[1] as ToolId;
    if (TOOLS_BY_ID.has(toolId)) return { kind: 'tool', toolId, investigationId: parts[2] };
    return { kind: 'home' };
  }
  if (parts[0] === 'saved' || parts[0] === 'templates' || parts[0] === 'settings' || parts[0] === 'examples') {
    return { kind: parts[0] };
  }
  return { kind: 'home' };
}
