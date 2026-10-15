/**
 * Distribution fitting: "which distribution describes my data, and how well?"
 *
 * Fitting (maximum likelihood, method of moments, censored data, mixtures),
 * uncertainty (Hessian standard errors, Wald and profile-likelihood intervals,
 * parametric bootstrap), goodness of fit (KS, Anderson–Darling,
 * Cramér–von Mises, chi-square with the correct degrees of freedom,
 * Shapiro–Wilk, Jarque–Bera), model selection by AIC/AICc/BIC, diagnostic plot
 * data with a Q–Q envelope, and the non-parametric alternatives (KDE, ECDF
 * with DKW bands).
 */
export * from './types';
export * from './analytic';
export * from './optimize';
export * from './moments';
export * from './mle';
export * from './compare';
export * from './bootstrap';
export * from './gof';
export * from './selection';
export * from './diagnostics';
export * from './censored';
export * from './mixture';
export * from './kde';
export * from './ecdf';
