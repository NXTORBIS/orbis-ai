# J.A.R.V.I.S. — Physics Studio (`/physics`) — all 245 simulators

> "Interactive simulations with real numerical models — classical → quantum → astrophysics → research.
> **Every live topic runs genuine computation, not canned animation.**"

Header controls: **Auto-explain: ON** toggle, and a counter reading `245 topics · all open`.

Every topic card carries: a title, a one-line parameter summary, **What it means** (plain-language definition),
**What you explore** (the quantities), and **OPEN SIMULATOR →**.

Fifteen areas:

## 1. Classical Mechanics (14)
Kinematics (1D/2D Motion) — position, velocity, acceleration vs time; 1D & 2D trajectories ·
Projectile Motion — launch angle, speed, gravity, trajectory & range ·
Newton's Laws — F=ma, applied force, friction, net force & equilibrium ·
Friction & Inclined Planes — incline angle, normal force, static & kinetic friction, gravity decomposition ·
Circular Motion — centripetal force, angular velocity, period, tangential & radial vectors ·
Collision Simulator — elastic/inelastic, momentum & energy ·
Work & Energy — KE/PE bars, work-energy theorem, power, conservation ·
Spring–Mass System — Hooke's law, spring constant, amplitude, period, energy oscillation ·
Simple Pendulum — nonlinear pendulum, period, phase ·
SHM Simulator — displacement, velocity, acceleration curves & phase circle ·
Damped Oscillations — under/critical/over-damped regimes, decay envelope, Q factor ·
Resonance — driven oscillator, frequency response curve, phase shift, resonance peak ·
Rotational Motion — torque, angular acceleration, moment of inertia, angular momentum ·
Double Pendulum — chaotic motion, phase space

## 2. Electromagnetism (18)
Electric Field (movable point charges, live field vectors) · Electric Potential (scalar heatmap, equipotential
contours, V probe) · Point Charges (1/r² falloff plot) · Electric Dipole (p = qd, far-field 1/r³) ·
Multiple Charge Systems (field-line tracing, null points, superposition) · Gauss's Law (Gaussian surface,
flux = Q/ε₀) · Capacitors (RC charging/discharging, Q(t), V(t), energy) · **RC / RL / RLC Circuits (transient & AC
response, RK4)** · Kirchhoff's Laws (two-loop KVL solver, branch currents) · Magnetic Fields (bar magnet, current
loop, straight wire) · **Biot–Savart Law (numerical dB integration)** · Lorentz Force q(v×B) — Plasma Lab ·
Charged Particle Motion (cyclotron, E×B drift, magnetic mirror) · Electromagnetic Induction (magnet through coil,
EMF = −N dΦ/dt) · Faraday's Law (rotating loop) · Lenz's Law · Transformers (mutual induction, Vs/Vp = Ns/Np) ·
Electromagnetic Waves (oscillating E & B, polarization, spectrum)

## 3. Waves & Optics (19)
**Wave on a String (FDTD wave equation, real propagation)** · Transverse / Longitudinal Waves · Superposition ·
Interference (two-source 2D pattern, path difference) · Standing Waves (harmonics, nodes & antinodes) ·
Beats (f_beat = |f1−f2|) · Doppler Effect (f′ = fc/(c−v)) · Sound Waves (speed in media, dB scale) · Reflection ·
Refraction (n₁sinθ₁ = n₂sinθ₂, TIR) · Snell's Law (sinθ plot, slope = n₁/n₂, critical angle) ·
Convex / Concave Lenses (thin-lens ray tracing, 1/f = 1/d_o + 1/d_i) · Mirrors (f = R/2) ·
Lens Combinations (M = M₁×M₂, telescope/microscope) · **Double-Slit Experiment (real Fraunhofer interference)** ·
Single-Slit Diffraction (sinc², minima at a sinθ = mλ) · Diffraction Grating (N-slit, d sinθ = mλ, width ∝ 1/N) ·
Polarization (Malus I = I₁cos²θ) · Michelson Interferometer (Δm = 2ΔL/λ)

## 4. Thermodynamics & Statistical Physics (16)
Ideal Gas Simulator · Boyle's Law · Charles's Law · Ideal Gas Law (PV = NkT state space, isotherm family) ·
Maxwell–Boltzmann Distribution (v_p, ⟨v⟩, v_rms markers) · Heat Transfer (conduction + radiation) ·
Thermal Expansion (ΔL = α L₀ ΔT) · Carnot Engine (P–V cycle, maximum efficiency) ·
Heat Engine (Q_h → W + Q_c Sankey flow, η below Carnot) · Refrigerator / Heat Pump (COP) ·
Entropy Simulator (two-gas mixing, S = −Σ p ln p) · Random Walk (⟨r²⟩ ∝ t) · Brownian Motion (MSD ∝ t) ·
Monte Carlo Physics (π and ∫sin x dx) · **Ising Model (2D lattice, phase transition at Tc)** ·
Partition Function (two-level Z, F, U, S vs T)

## 5. Quantum Mechanics (19)
Particle in a Box · Infinite Potential Well (n² ladder) · **Finite Potential Well (transcendental bound-state
solver)** · Quantum Tunneling (wave packet, T(E) vs analytic) · Potential Barrier (resonances above V₀) ·
Step Potential · Quantum Harmonic Oscillator (Hermite–Gaussian, ZPE) · Free Particle (Gaussian dispersion, σ(t)) ·
Double-Well Potential (tunneling splitting) · Hydrogen Atom (Eₙ=−13.6/n², radial Rₙₗ, Balmer) ·
**Schrödinger Equation Solver (split-step Fourier)** · Wavefunction Visualizer (Re/Im/|ψ|² + phase colour wheel) ·
Probability Density (heatmap, peak tracking) · Quantum Superposition (colliding packets) ·
Quantum Measurement (Born rule histogram, collapse) · Energy Eigenvalues ·
**Quantum Many-Body Simulator (Heisenberg spin-chain exact diagonalisation)** ·
Quantum Error Correction (stabilizer codes & decoders) · Fault-Tolerant Decoding (syndrome decoding under noise)

## 6. Quantum Information (20)
Qubit Laboratory (Bloch sphere, SU(2)) · Multi-Qubit Simulator (tensor products, entanglement entropy) ·
Quantum Gates (X, Y, Z, H, S, T matrices, rotation axes) · CNOT / CZ / SWAP (truth tables, entangling power) ·
**Quantum Circuit Builder (add/move/run/step/measure)** · Quantum Teleportation (real 3-qubit protocol) ·
Superdense Coding · Deutsch Algorithm · Deutsch–Jozsa · Bernstein–Vazirani ·
**Grover's Algorithm (√N search, amplitude amplification iteration-by-iteration)** ·
Quantum Fourier Transform (real QFT on 3 qubits) · Quantum Phase Estimation ·
**Shor's Algorithm (N=15, order-finding → 3·5)** · Entanglement (Bell state, correlation analysis) ·
Density Matrices & Channels (ρ, Kraus ops, purity) · Von Neumann Entropy · Quantum Fidelity & Trace Distance ·
Bell-State Analysis · Quantum Tomography (reconstruct ρ from ⟨X⟩⟨Y⟩⟨Z⟩)

## 7. Computational Physics (17)
Numerical Integration (trapezoid, Simpson, Gauss–Legendre convergence) · Numerical Differentiation (truncation vs
round-off) · Root Finding (Newton/bisection/secant convergence orders) · **ODE Solver (Euler, RK2, RK4, adaptive
RK45 — accuracy vs cost)** · PDE Solver (1D heat FTCS, CFL stability) · Eigenvalue Solver (Jacobi vs power
iteration) · Matrix Laboratory (LU, determinant, Ax=b, residual) · Fourier Transform (DFT, Nyquist) ·
**FFT (radix-2 Cooley–Tukey, O(N log N) vs O(N²) with timing & speedup)** · Monte Carlo Methods (Metropolis,
1/√N) · Finite Difference Method (leapfrog wave, CFL) · **Finite Element Method (1D Poisson, hat basis, Galerkin
weak form, O(h²))** · Numerical Linear Algebra (LU, QR Gram-Schmidt, condition number κ, digits lost) ·
Error & Convergence Analysis (Kahan summation) · Differential Equation Visualizer (phase portrait, vector field) ·
Cellular Automata (rules 30/90/110, Game of Life) · Numerical Optimisation (gradient descent, momentum, Newton on
Rosenbrock)

## 8. Astrophysics & Space Physics (20)
Solar System Simulator · Orbital Mechanics (two-body & N-body) · Kepler's Laws (T²∝a³) ·
**N-Body Gravity (velocity-Verlet integrator)** · Three-Body Problem (figure-8 & chaotic) · Binary Stars ·
Planetary Orbits · Stellar Evolution (HR track) · Hertzsprung–Russell Diagram · **Black Hole Simulator
(Schwarzschild geodesics)** · Gravitational Lensing · Neutron Stars · Pulsars (spin-down) ·
Exoplanet Transit (light-curve dip) · Radial Velocity Simulator (stellar wobble) ·
**Gravitational Waves (chirp h(t), f(t), spectrogram)** · Cosmic Expansion (Hubble flow) · Redshift ·
Dark Matter Rotation Curves · Gravitational Time Dilation

## 9. Nuclear & Particle Physics (14)
Radioactive Decay (Monte Carlo, half-life) · Half-Life Simulator · **Decay Chains (Bateman equations)** ·
Alpha / Beta / Gamma Decay (Q-values) · **Nuclear Binding Energy (semi-empirical mass formula)** · Fission ·
Fusion · Nuclear Reactions (Q-value, cross-section) · Particle Collision Simulator (centre-of-mass kinematics) ·
Particle Detector (track reconstruction) · Standard Model Explorer (fermions & bosons with quantum numbers) ·
Particle Properties (mass, spin, charge, colour, generation) · Interaction Analyser (conservation-law checker) ·
**Feynman Diagram Builder (vertices & vertex-rule validation)**

## 10. Fluid & Continuum Physics (14)
Fluid Flow (2D velocity field — sources, sinks, vortices, streamlines) · Fluid Pressure (ρgh & ½ρv²) ·
Buoyancy (Archimedes) · Bernoulli Equation (Venturi) · Viscosity (Couette, τ = μ du/dy, no-slip) ·
Laminar Flow (parabolic Poiseuille) · **Turbulent Flow (high-Re vortex shedding, Kármán street)** ·
Reynolds Number (Re = ρvL/μ regimes) · Pipe Flow (Q = πR⁴ΔP/8μL — the R⁴ law) · Drag (Stokes & quadratic,
terminal velocity) · Atmospheric Pressure (barometric formula, scale height) · Wave Propagation (c = √(B/ρ)) ·
**Shock Waves (Mach cone, Rankine–Hugoniot)** · **Navier–Stokes Visualisation (2D stable-fluids with dye)**

## 11. Condensed Matter & Materials (18)
Crystal Structure Viewer (3D SC, BCC, FCC, diamond) · Unit Cell Builder (primitive vectors, APF) ·
**Bravais Lattices (all 14 types across 7 systems)** · Reciprocal Lattice (b_i = 2π(a_j×a_k)/V, Brillouin zone) ·
**Band Structure (tight-binding E(k) along Γ→X→M→Γ)** · Density of States (van Hove singularities) ·
Semiconductor Simulator (n_i = √(Nc·Nv)exp(−Eg/2kT), doping, Fermi level) · PN Junction (depletion width, band
bending) · Diode I–V (Shockley, breakdown) · Hall Effect (V_H = IB/(nqt)) · Ferromagnetism (mean-field M(T),
hysteresis, coercivity) · Antiferromagnetism (two-sublattice Ising, Néel T_N) · **Ising Model (Metropolis/Wolff,
Onsager Tc ≈ 2.269)** · Heisenberg Model (classical O(3), Mermin-Wagner) · XY Model (vortices, KT at ≈0.89) ·
Superconductivity (BCS gap Δ(T), R(T)→0) · Phase Transitions (exact Onsager: M, E, C_V, χ, critical exponents) ·
**Topological Materials (SSH model, winding number, edge states)**

## 12. Virtual Experimental Physics Lab (17) — *measure, don't just watch*
Simple Pendulum (measure g from period) · Projectile Motion (range vs angle) · Newton's Laws ·
Conservation of Momentum · Conservation of Energy · SHM (k from period) · Young's Modulus (stress–strain) ·
Ohm's Law · Kirchhoff's Laws (multi-loop KVL/KCL solver) · **Wheatstone Bridge (null measurement, ratio arms)** ·
**Meter Bridge (slide-wire, balance point)** · Convex Lens · Concave Mirror · Prism (minimum deviation) ·
Resonance Tube (speed of sound) · RC Circuit (τ = RC) · Electromagnetic Induction

## 13. Physics Data Laboratory (13) — *bring your own data*
CSV / TXT / JSON Import · Data Cleaning & Sorting · Scientific Graphing (line, scatter, bar, histogram) ·
Linear Regression (y = mx + c with uncertainties) · Polynomial Fitting · Curve Fitting (nonlinear) · Error Bars ·
Residual Analysis · Mean & Standard Deviation · **Uncertainty Propagation** · Unit Conversion with dimension
check · Slope & Intercept · Best-Fit Equations

## 14. Advanced Research Physics (15)
Quantum Field Theory · **Tensor Networks (MPS / PEPS)** · **DMRG** · Quantum Monte Carlo ·
**Molecular Dynamics (Lennard–Jones, velocity-Verlet, RDF)** · Computational Fluid Dynamics ·
Plasma Physics · Numerical Relativity (Einstein equations — geodesics) · Gravitational Waves ·
Many-Body Localisation · Topological Phases · Quantum Information Research · Quantum Many-Body Research ·
Advanced Quantum Error Correction (surface codes) · Fault-Tolerant Quantum Computing (threshold studies)

## 15. Scientific Methods & Tools (11)
**Physics Constants & Units (CODATA values, prefixes, conversion)** · **Dimensional Analysis (verify equations
dimensionally)** · Uncertainty & Error Lab (propagation, quadrature, CI) · Numerical Methods Lab ·
Scientific Visualization (plots, heatmaps, spectrograms) · **Research Notebook (reproducible experiment records)** ·
**Experiment Comparison (side-by-side)** · **High-Performance Computing (Web Worker sweeps with cancel)** ·
**Scientific Validation (numerical vs analytic error)** · **Reproducibility (save & re-run configurations)** ·
**Research-Style Export (CSV / JSON / PNG)**

---

## What this means for Orbis

Orbis's thirteen physics/science engines map onto maybe 25 of these 245. The last four areas are the interesting
part: JARVIS treats **measurement, data, reproducibility and export** as first-class physics topics — a Research
Notebook, an Experiment Comparison, saved configurations you can re-run, and a worker-based sweep runner with
cancellation. Orbis has the honesty rules but none of that apparatus.
