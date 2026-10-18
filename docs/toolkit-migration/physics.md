Summary: 13 laboratories, 451 features in total.

# Physics laboratories: features and where each one lives

Each laboratory is a screen a person can open. Each numbered feature is one thing a person can do or see on it. Line numbers point at the code that makes the feature happen. Settings marked as declared are the values the laboratory accepts from a sentence or from Orion.

Not counted: the modern physics engines in src/main/pages/modernPhysicsEngines.ts (heat, molecules, fast particles, quantum states). They run as calculations for Pages, but no screen in this build opens them, so a person cannot use them as a laboratory.

## 1. Quantum Studio

- Id: `quantum-studio`
- Screen file: `src/renderer/src/components/native/QuantumStudio.tsx` (line 129)
- Catalogue entry: `src/shared/native/phase12.ts:304`
- Declared settings: Declared in src/shared/native/phase12.ts from line 40 (STUDIO): section 42, qubits 59, preset 70, gate 91, target 99, control 100, angle 102, shots 114, seed 125, basis 136, noise 149, error rate 158, algorithm 169.
- Features: 18

1. **Section tabs**. Switch between the seven areas: circuit, state, Bloch sphere, measurement, algorithms, noise and error correction. Where: `src/renderer/src/components/native/QuantumStudio.tsx:275-293`.
2. **Circuit-will-not-run warning**. Tells you in words which step stops a circuit from running, instead of showing a broken result. Where: `src/renderer/src/components/native/QuantumStudio.tsx:291-302`.
3. **Circuit designer**. Build a quantum circuit gate by gate, then undo, invert or clear it. Where: `src/renderer/src/components/native/QuantumStudio.tsx:357-441`.
4. **Gate, target and control picker**. Choose which gate to add and which qubits it acts on, with an angle for rotation gates. Where: `src/renderer/src/components/native/QuantumStudio.tsx:385-424`.
5. **Starting circuits**. Load a ready-made circuit such as a Bell pair, GHZ state, Fourier transform or interference test. Where: `src/renderer/src/components/native/QuantumStudio.tsx:442-450 (presets from line 83)`.
6. **Cost of the circuit**. Shows how many gates, how many layers and how deep the circuit is. Where: `src/renderer/src/components/native/QuantumStudio.tsx:451-483`.
7. **Step-through timeline**. Move a slider through the circuit one step at a time and watch the state change. Where: `src/renderer/src/components/native/QuantumStudio.tsx:484-508`.
8. **Circuit diagram**. Draws the circuit as wires and gate symbols on each qubit. Where: `src/renderer/src/components/native/QuantumStudio.tsx:520-540`.
9. **Amplitude table**. Lists every amplitude of the whole state, with its phase and probability. Where: `src/renderer/src/components/native/QuantumStudio.tsx:578-616`.
10. **Whole-state summary**. Describes the full quantum state in one place. Where: `src/renderer/src/components/native/QuantumStudio.tsx:629-655`.
11. **Each qubit on its own**. Shows the state of one qubit at a time, ignoring the others. Where: `src/renderer/src/components/native/QuantumStudio.tsx:656-692`.
12. **Bloch sphere**. Draws one qubit as a point on a sphere, with a note on what the picture means and how long the arrow is. Where: `src/renderer/src/components/native/QuantumStudio.tsx:693-764`.
13. **Shots and counts against theory**. Measures the circuit many times and sets the counted results beside what theory predicts. Where: `src/renderer/src/components/native/QuantumStudio.tsx:765-866 (shots 788-800, counts 812)`.
14. **Algorithms**. Runs Deutsch, Deutsch-Jozsa, Bernstein-Vazirani, Grover, Fourier transform, phase estimation, Shor, teleportation or superdense coding and shows the result. Where: `src/renderer/src/components/native/QuantumStudio.tsx:867-1033 (choices 976-983)`.
15. **Grover success curve**. Plots how the chance of finding the marked answer rises and falls with each search iteration. Where: `src/renderer/src/components/native/QuantumStudio.tsx:1034-1077 (chart 1052)`.
16. **Noise and fidelity**. Applies a noise channel to the circuit and compares the noisy result with the ideal one, with fidelity and depth. Where: `src/renderer/src/components/native/QuantumStudio.tsx:1078-1162`.
17. **Error correction encode and break**. Encodes a qubit into a correcting code, adds a chosen error, and repairs it. Where: `src/renderer/src/components/native/QuantumStudio.tsx:1163-1219 (error choices 1190-1196, buttons 1212-1215)`.
18. **Every single-qubit error survey**. Tries every possible single-qubit error on a code and reports whether each one is repaired. Where: `src/renderer/src/components/native/QuantumStudio.tsx:1220-1280 (table 1250)`.

## 2. Field Lab

- Id: `field-lab`
- Screen file: `src/renderer/src/components/native/FieldLab.tsx` (line 78)
- Catalogue entry: `src/shared/native/phase3.ts:430`
- Declared settings: Declared in src/shared/native/phase3.ts (FIELD_LAB block, lines 215-272): kind 222, sources 234, half-width 241, resolution 243, show 253, normalise 266.
- Features: 13

1. **Electric or gravitational field**. Choose whether the field comes from electric charges or from masses. Where: `src/renderer/src/components/native/FieldLab.tsx:82 (setting src/shared/native/phase3.ts:222)`.
2. **Source list**. Type each source as strength, x and y, one per line, to place charges or masses on the map. Where: `src/renderer/src/components/native/FieldLab.tsx:53-76 (setting src/shared/native/phase3.ts:234)`.
3. **Field arrows over a grid**. Draws the field direction at every grid point, each arrow from its own full calculation. Where: `src/renderer/src/components/native/FieldLab.tsx:213-308 (arrows 267-295)`.
4. **Shaded potential map**. Shades each grid point by how strong the potential is there, so you can see the strength the arrows hide. Where: `src/renderer/src/components/native/FieldLab.tsx:246-264`.
5. **Show arrows, shading or both**. Switch the picture between arrows, the shaded potential, or both. Where: `src/renderer/src/components/native/FieldLab.tsx:247, 267 (setting src/shared/native/phase3.ts:253)`.
6. **Equal-length arrows**. Draws every arrow the same length so direction is easy to read, and says that this hides strength. Where: `src/renderer/src/components/native/FieldLab.tsx:86, 156-158 (setting src/shared/native/phase3.ts:266)`.
7. **Grid size**. Sets how many points make up the grid, and says how many field calculations that means. Where: `src/renderer/src/components/native/FieldLab.tsx:84, 120-121 (setting src/shared/native/phase3.ts:243)`.
8. **Map width**. Sets how far from the centre the map reaches in each direction. Where: `src/renderer/src/components/native/FieldLab.tsx:83 (setting src/shared/native/phase3.ts:241)`.
9. **Plus and minus markers**. Marks each source with its sign, so a positive and negative charge are told apart by more than colour. Where: `src/renderer/src/components/native/FieldLab.tsx:297-305`.
10. **Measured panel**. Shows how many points were computed, the strongest field, how many points were skipped on a source, and the potential range. Where: `src/renderer/src/components/native/FieldLab.tsx:164-187`.
11. **Assumptions panel**. Lists what the picture assumes: point sources in a plane, no conductors, the physics model used, and that nothing moves. Where: `src/renderer/src/components/native/FieldLab.tsx:189-197`.
12. **Source problems warning**. Says which line of the source list could not be read and why. Where: `src/renderer/src/components/native/FieldLab.tsx:125-134`.
13. **Settings panel**. Holds the same settings as the lab itself so they can be changed in one place. Where: `src/renderer/src/components/native/FieldLab.tsx:201-206`.

## 3. Physics Studio

- Id: `physics-studio`
- Screen file: `src/renderer/src/components/native/PhysicsStudio.tsx` (line 29)
- Catalogue entry: `src/shared/native/phase8.ts:94`
- Declared settings: Declared in src/shared/native/phase8.ts (PHASE8_PARAMETERS, from line 77): topic 30, settings 40, speed 56, playing 68.
- Features: 366

1. **The studio itself**. The full physics studio with 245 topics in 15 sections, each one a simulation you can run, pause, step and change. Where: `src/renderer/src/components/native/PhysicsStudio.tsx:121-127; src/renderer/src/physics/StudioPage.jsx:1-144`.
2. **Section tabs**. Switch between the physics sections, such as mechanics, quantum and astrophysics. Where: `src/renderer/src/physics/StudioPage.jsx:53-60`.
3. **Search within a section**. Type to narrow the topics in the section you are looking at. Where: `src/renderer/src/physics/StudioPage.jsx:23-29, 71-72`.
4. **Search across all sections**. When you search, matching topics from every section are listed, each labelled with its section. Where: `src/renderer/src/physics/StudioPage.jsx:88-89`.
5. **What does this mean? explainer**. Opens a plain explanation of the topic you are looking at, beside the simulation. Where: `src/renderer/src/physics/StudioPage.jsx:119-120, 136-138`.
6. **Auto-explain setting**. Opens the explanation by itself whenever you open a topic, and remembers that choice on this computer. Where: `src/renderer/src/physics/StudioPage.jsx:16-17, 37-39, 76-78`.
7. **Orion opens and sets a topic**. Lets Orion open a topic, set its speed, play or pause it, and change its own settings. Where: `src/renderer/src/components/native/PhysicsStudio.tsx:43-81`.
8. **Status line for requests**. Says which requested changes were carried out and which could not be, on screen. Where: `src/renderer/src/components/native/PhysicsStudio.tsx:103-119`.
9. **Formula vault tab**. Opens the formula vault beside the studio. Where: `src/renderer/src/components/native/PhysicsStudio.tsx:95, 129, 141-146`.
10. **Formula search**. Search the vault by name, symbol or unit and see how many formulas match. Where: `src/renderer/src/components/native/PhysicsStudio.tsx:147, 176-184`.
11. **Pick a formula and see related ones**. Choose a formula to work with, and jump to the formulas that sit nearest to it. Where: `src/renderer/src/components/native/PhysicsStudio.tsx:150-156, 292-308`.
12. **Choose the quantity to work out**. Pick which quantity you want. Quantities the vault cannot rearrange are greyed out, not guessed at. Where: `src/renderer/src/components/native/PhysicsStudio.tsx:226-246`.
13. **Enter the known values**. Type the values you know. A blank box counts as missing, never as zero. Where: `src/renderer/src/components/native/PhysicsStudio.tsx:158-166, 248-266`.
14. **Answer with the working shown**. Gives the answer with its working written out, and any warning, so you can check it. Where: `src/renderer/src/components/native/PhysicsStudio.tsx:268-283`.
15. **When this holds**. Lists the conditions under which the chosen formula is true. Where: `src/renderer/src/components/native/PhysicsStudio.tsx:285-290`.
16. **Simulation: Kinematics (1D/2D Motion) (kinematics)**. Position, velocity, acceleration vs time; 1D & 2D trajectories. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:252 (component src/renderer/src/physics/sims/KinematicsSim.jsx)`.
17. **Simulation: Projectile Motion (projectile)**. Launch angle, speed, gravity, trajectory & range. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:253 (component src/renderer/src/physics/sims/ProjectileMotion.jsx)`.
18. **Simulation: Newton's Laws (newton)**. F=ma, applied force, friction, net force & equilibrium. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:254 (component src/renderer/src/physics/sims/NewtonsLaws.jsx)`.
19. **Simulation: Friction & Inclined Planes (friction)**. Incline angle, normal force, static & kinetic friction, gravity decomposition. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:255 (component src/renderer/src/physics/sims/FrictionIncline.jsx)`.
20. **Simulation: Circular Motion (circular)**. Centripetal force, angular velocity, period, tangential & radial vectors. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:256 (component src/renderer/src/physics/sims/CircularMotion.jsx)`.
21. **Simulation: Collision Simulator (collision)**. Elastic/inelastic, momentum & energy. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:257 (component src/renderer/src/physics/sims/Collision.jsx)`.
22. **Simulation: Work & Energy (workenergy)**. KE/PE bars, work-energy theorem, power, conservation. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:258 (component src/renderer/src/physics/sims/WorkEnergy.jsx)`.
23. **Simulation: Spring–Mass System (spring)**. Hooke’s law, spring constant, amplitude, period, energy oscillation. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:259 (component src/renderer/src/physics/sims/SpringMassSystem.jsx)`.
24. **Simulation: Simple Pendulum (pendulum)**. Nonlinear pendulum, period, phase. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:260 (component src/renderer/src/physics/sims/SimplePendulum.jsx)`.
25. **Simulation: SHM Simulator (shm)**. Displacement, velocity, acceleration curves & phase circle. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:261 (component src/renderer/src/physics/sims/SHMSim.jsx)`.
26. **Simulation: Damped Oscillations (damped)**. Under/critical/over-damped regimes, decay envelope, Q factor. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:262 (component src/renderer/src/physics/sims/DampedOscillations.jsx)`.
27. **Simulation: Resonance (resonance)**. Driven oscillator, frequency response curve, phase shift, resonance peak. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:263 (component src/renderer/src/physics/sims/ResonanceSim.jsx)`.
28. **Simulation: Rotational Motion (rotational)**. Torque, angular acceleration, moment of inertia, angular momentum. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:264 (component src/renderer/src/physics/sims/RotationalMotion.jsx)`.
29. **Simulation: Double Pendulum (double)**. Chaotic motion, phase space. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:265 (component src/renderer/src/physics/sims/DoublePendulum.jsx)`.
30. **Simulation: Electric Field (efield)**. Movable point charges, live field vectors. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:271 (component src/renderer/src/physics/sims/ElectricField.jsx)`.
31. **Simulation: Electric Potential (epotential)**. Scalar potential heatmap, equipotential contours, V probe. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:272 (component src/renderer/src/physics/sims/ElectricPotential.jsx)`.
32. **Simulation: Point Charges (pointcharges)**. Single-charge Coulomb field, 1/r² falloff plot. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:273 (component src/renderer/src/physics/sims/PointCharges.jsx)`.
33. **Simulation: Electric Dipole (dipole)**. Dipole field lines, p = qd, far-field 1/r³. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:274 (component src/renderer/src/physics/sims/ElectricDipole.jsx)`.
34. **Simulation: Multiple Charge Systems (multicharge)**. Field-line tracing, null points, vector superposition. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:275 (component src/renderer/src/physics/sims/MultichargeSystem.jsx)`.
35. **Simulation: Gauss's Law (gauss)**. Gaussian surface, enclosed charge, flux = Q/ε₀. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:276 (component src/renderer/src/physics/sims/GaussLaw.jsx)`.
36. **Simulation: Capacitors (capacitors)**. RC charging/discharging, Q(t), V(t), energy. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:277 (component src/renderer/src/physics/sims/CapacitorSim.jsx)`.
37. **Simulation: RC / RL / RLC Circuits (rc)**. Transient & AC response (RK4). Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:278 (component src/renderer/src/physics/sims/CircuitsLab.jsx)`.
38. **Simulation: Kirchhoff's Laws (kirchhoff)**. Two-loop KVL solver, branch currents. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:279 (component src/renderer/src/physics/sims/KirchhoffLaw.jsx)`.
39. **Simulation: Magnetic Fields (bfield)**. Bar magnet, current loop, straight wire field lines. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:280 (component src/renderer/src/physics/sims/MagneticField.jsx)`.
40. **Simulation: Biot–Savart Law (biotsavart)**. Numerical dB integration, straight/loop/square wire. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:281 (component src/renderer/src/physics/sims/BiotSavart.jsx)`.
41. **Simulation: Lorentz Force (lorentz)**. q(v×B) on charges — Plasma Lab. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:282 (component src/renderer/src/physics/sims/PlasmaLab.jsx)`.
42. **Simulation: Charged Particle Motion (chargedmotion)**. Cyclotron, E×B drift, magnetic mirror. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:283 (component src/renderer/src/physics/sims/ChargedMotion.jsx)`.
43. **Simulation: Electromagnetic Induction (induction)**. Magnet through coil, EMF = −N dΦ/dt. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:284 (component src/renderer/src/physics/sims/InductionSim.jsx)`.
44. **Simulation: Faraday's Law (faraday)**. Rotating loop, Φ(t) and EMF = −N dΦ/dt. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:285 (component src/renderer/src/physics/sims/FaradayLaw.jsx)`.
45. **Simulation: Lenz's Law (lenz)**. Induced current direction, energy conservation. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:286 (component src/renderer/src/physics/sims/LenzLaw.jsx)`.
46. **Simulation: Transformers (transformer)**. Mutual induction, Vs/Vp = Ns/Np, AC drive. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:287 (component src/renderer/src/physics/sims/TransformerSim.jsx)`.
47. **Simulation: Electromagnetic Waves (emwaves)**. Oscillating E & B fields, polarization, spectrum. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:288 (component src/renderer/src/physics/sims/EMWaves.jsx)`.
48. **Simulation: Wave on a String (string)**. FDTD wave equation, real propagation. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:294 (component src/renderer/src/physics/sims/WaveString.jsx)`.
49. **Simulation: Transverse / Longitudinal Waves (translong)**. Transverse vs longitudinal oscillation, particle density. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:295 (component src/renderer/src/physics/sims/TransverseLongitudinal.jsx)`.
50. **Simulation: Superposition (superposition)**. Two travelling waves adding point-by-point, constructive/destructive. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:296 (component src/renderer/src/physics/sims/WaveSuperposition.jsx)`.
51. **Simulation: Interference (interference)**. Two-source circular wave 2D pattern, path difference. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:297 (component src/renderer/src/physics/sims/WaveInterference.jsx)`.
52. **Simulation: Standing Waves (standing)**. Harmonics, nodes & antinodes on bounded string. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:298 (component src/renderer/src/physics/sims/StandingWaves.jsx)`.
53. **Simulation: Beats (beats)**. Two close frequencies, beat envelope, f_beat = |f1−f2|. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:299 (component src/renderer/src/physics/sims/BeatsSim.jsx)`.
54. **Simulation: Doppler Effect (doppler)**. Moving source, wavefront compression/expansion, f′ = fc/(c−v). Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:300 (component src/renderer/src/physics/sims/DopplerEffect.jsx)`.
55. **Simulation: Sound Waves (sound)**. Longitudinal pressure wave, speed in media, dB scale. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:301 (component src/renderer/src/physics/sims/SoundWaves.jsx)`.
56. **Simulation: Reflection (reflection)**. Law of reflection, specular vs diffuse, angle from normal. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:302 (component src/renderer/src/physics/sims/ReflectionSim.jsx)`.
57. **Simulation: Refraction (refraction)**. Ray bending at interface, n₁sinθ₁ = n₂sinθ₂, TIR. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:303 (component src/renderer/src/physics/sims/RefractionSim.jsx)`.
58. **Simulation: Snell's Law (snell)**. sinθ₁ vs sinθ₂ plot, slope = n₁/n₂, critical angle. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:304 (component src/renderer/src/physics/sims/SnellLaw.jsx)`.
59. **Simulation: Convex / Concave Lenses (lenses)**. Thin-lens ray tracing, 1/f = 1/d_o + 1/d_i, real/virtual image. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:305 (component src/renderer/src/physics/sims/LensSim.jsx)`.
60. **Simulation: Mirrors (mirrors)**. Concave/convex mirror, f = R/2, ray tracing, image formation. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:306 (component src/renderer/src/physics/sims/MirrorSim.jsx)`.
61. **Simulation: Lens Combinations (lenscombo)**. Two-lens system, M = M₁×M₂, telescope/microscope. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:307 (component src/renderer/src/physics/sims/LensCombo.jsx)`.
62. **Simulation: Double-Slit Experiment (doubleslit)**. Real Fraunhofer interference. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:308 (component src/renderer/src/physics/sims/DoubleSlit.jsx)`.
63. **Simulation: Single-Slit Diffraction (singleslit)**. sinc² pattern, minima at a sinθ = mλ, central width. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:309 (component src/renderer/src/physics/sims/SingleSlit.jsx)`.
64. **Simulation: Diffraction Grating (grating)**. N-slit sharp peaks, d sinθ = mλ, width ∝ 1/N. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:310 (component src/renderer/src/physics/sims/DiffractionGrating.jsx)`.
65. **Simulation: Polarization (polarization)**. Malus's law I = I₁cos²θ, crossed polarizers. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:311 (component src/renderer/src/physics/sims/PolarizationSim.jsx)`.
66. **Simulation: Michelson Interferometer (michelson)**. Two-arm beam splitter, Δm = 2ΔL/λ fringe shifts. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:312 (component src/renderer/src/physics/sims/MichelsonSim.jsx)`.
67. **Simulation: Ideal Gas Simulator (idealgas)**. Particles, pressure, temperature. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:318 (component src/renderer/src/physics/sims/IdealGas.jsx)`.
68. **Simulation: Boyle's Law (boyle)**. PV at constant T — isothermal piston compression. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:319 (component src/renderer/src/physics/sims/BoylesLaw.jsx)`.
69. **Simulation: Charles's Law (charles)**. V vs T at constant P — isobaric expansion. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:320 (component src/renderer/src/physics/sims/CharlesLaw.jsx)`.
70. **Simulation: Ideal Gas Law (idealgaslaw)**. PV = NkT — state-space diagram with isotherm family. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:321 (component src/renderer/src/physics/sims/IdealGasLaw.jsx)`.
71. **Simulation: Maxwell–Boltzmann Distribution (mb)**. Speed distribution with v_p, ⟨v⟩, v_rms markers. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:322 (component src/renderer/src/physics/sims/MaxwellBoltzmann.jsx)`.
72. **Simulation: Heat Transfer (heat)**. Conduction + radiation, T(t) convergence to equilibrium. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:323 (component src/renderer/src/physics/sims/HeatTransfer.jsx)`.
73. **Simulation: Thermal Expansion (expansion)**. Linear expansion ΔL = α L₀ ΔT with rod visualisation. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:324 (component src/renderer/src/physics/sims/ThermalExpansion.jsx)`.
74. **Simulation: Carnot Engine (carnot)**. P–V cycle, maximum efficiency. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:325 (component src/renderer/src/physics/sims/CarnotEngine.jsx)`.
75. **Simulation: Heat Engine (heatengine)**. Q_h → W + Q_c Sankey flow, η below Carnot limit. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:326 (component src/renderer/src/physics/sims/HeatEngine.jsx)`.
76. **Simulation: Refrigerator / Heat Pump (fridge)**. Reverse cycle, COP = Q_c/W or Q_h/W. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:327 (component src/renderer/src/physics/sims/Refrigerator.jsx)`.
77. **Simulation: Entropy Simulator (entropy)**. Two-gas mixing, S = −Σ p ln p rising to equilibrium. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:328 (component src/renderer/src/physics/sims/EntropySim.jsx)`.
78. **Simulation: Random Walk (randomwalk)**. 2D walkers, ⟨r²⟩ ∝ t diffusion law. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:329 (component src/renderer/src/physics/sims/RandomWalk.jsx)`.
79. **Simulation: Brownian Motion (brownian)**. Tracer bombarded by fluid, MSD ∝ t. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:330 (component src/renderer/src/physics/sims/BrownianMotion.jsx)`.
80. **Simulation: Monte Carlo Physics (mc)**. π estimation and ∫sin(x)dx via random sampling. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:331 (component src/renderer/src/physics/sims/MonteCarloPhysics.jsx)`.
81. **Simulation: Ising Model (ising)**. 2D lattice, phase transition at Tc. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:332 (component src/renderer/src/physics/sims/LatticeLab.jsx)`.
82. **Simulation: Partition Function (partition)**. Two-level system Z, F, U, S vs T. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:333 (component src/renderer/src/physics/sims/PartitionFunction.jsx)`.
83. **Simulation: Particle in a Box (pib)**. Eigenstates, superposition, time evolution. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:339 (component src/renderer/src/physics/sims/ParticleInBox.jsx)`.
84. **Simulation: Infinite Potential Well (infwell)**. Energy level ladder with n² scaling, eigenstate viewer. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:340 (component src/renderer/src/physics/sims/InfiniteWell.jsx)`.
85. **Simulation: Finite Potential Well (finwell)**. Transcendental bound-state solver, wavefunction leakage into walls. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:341 (component src/renderer/src/physics/sims/FiniteWell.jsx)`.
86. **Simulation: Quantum Tunneling (tunneling)**. Wave packet through barrier, T(E) vs analytical formula. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:342 (component src/renderer/src/physics/sims/QuantumTunneling.jsx)`.
87. **Simulation: Potential Barrier (barrier)**. T(E) curve: tunneling below V₀, resonances above. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:343 (component src/renderer/src/physics/sims/PotentialBarrier.jsx)`.
88. **Simulation: Step Potential (step)**. E > V₀ partial reflection, E < V₀ evanescent decay. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:344 (component src/renderer/src/physics/sims/StepPotential.jsx)`.
89. **Simulation: Quantum Harmonic Oscillator (qho)**. Hermite–Gaussian eigenfunctions, evenly-spaced levels, ZPE. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:345 (component src/renderer/src/physics/sims/QuantumHO.jsx)`.
90. **Simulation: Free Particle (freeparticle)**. Gaussian packet dispersion, group velocity, σ(t) spreading. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:346 (component src/renderer/src/physics/sims/FreeParticle.jsx)`.
91. **Simulation: Double-Well Potential (doublewell)**. Symmetric/antisymmetric pairs, tunneling splitting. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:347 (component src/renderer/src/physics/sims/DoubleWell.jsx)`.
92. **Simulation: Hydrogen Atom (hydrogen)**. Coulomb Eₙ=−13.6/n², radial Rₙₗ, Balmer series. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:348 (component src/renderer/src/physics/sims/HydrogenAtom.jsx)`.
93. **Simulation: Schrödinger Equation Solver (schrodinger)**. Split-step Fourier, time evolution. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:349 (component src/renderer/src/physics/sims/Schrodinger.jsx)`.
94. **Simulation: Wavefunction Visualizer (wavefn)**. Re/Im/|ψ|² + phase colour wheel. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:350 (component src/renderer/src/physics/sims/WavefunctionViz.jsx)`.
95. **Simulation: Probability Density (probdens)**. |ψ(x,t)|² heatmap with peak tracking. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:351 (component src/renderer/src/physics/sims/ProbabilityDensity.jsx)`.
96. **Simulation: Quantum Superposition (quantum-superposition)**. Two colliding wave packets, interference fringes. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:352 (component src/renderer/src/physics/sims/QuantumSuperposition.jsx)`.
97. **Simulation: Quantum Measurement (measurement)**. Born rule histogram, collapse & statistics. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:353 (component src/renderer/src/physics/sims/QuantumMeasurement.jsx)`.
98. **Simulation: Energy Eigenvalues (eigen)**. Discrete vs continuous spectra comparison. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:354 (component src/renderer/src/physics/sims/EnergyEigenvalues.jsx)`.
99. **Simulation: Quantum Many-Body Simulator (qmb)**. Heisenberg spin-chain exact diagonalisation. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:355 (component src/renderer/src/physics/sims/QuantumSimulator.jsx)`.
100. **Simulation: Quantum Error Correction (qec)**. Stabilizer codes & decoders. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:356 (component src/renderer/src/physics/sims/QECLab.jsx)`.
101. **Simulation: Fault-Tolerant Decoding (ft)**. Syndrome decoding under noise. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:357 (component src/renderer/src/physics/sims/QECLab.jsx)`.
102. **Simulation: Qubit Laboratory (Bloch Sphere) (qubit)**. Single-qubit gates, SU(2), Bloch vector. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:363 (component src/renderer/src/physics/sims/QubitLab.jsx)`.
103. **Simulation: Multi-Qubit Simulator (multiqubit)**. Tensor-product states, entanglement entropy of subsystems. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:364 (component src/renderer/src/physics/sims/MultiQubitSim.jsx)`.
104. **Simulation: Quantum Gates (gates)**. X, Y, Z, H, S, T gate matrices, rotation axes, Bloch sphere. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:365 (component src/renderer/src/physics/sims/QuantumGates.jsx)`.
105. **Simulation: CNOT / CZ / SWAP (cnot)**. Truth tables, control–target structure, entangling power. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:366 (component src/renderer/src/physics/sims/CnotCzSwap.jsx)`.
106. **Simulation: Quantum Circuit Builder (circuits)**. Add/move/run/step/measure circuits. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:367 (component src/renderer/src/physics/sims/QuantumCircuits.jsx)`.
107. **Simulation: Quantum Teleportation (teleport)**. Real 3-qubit protocol. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:368 (component src/renderer/src/physics/sims/QuantumAlgorithms.jsx)`.
108. **Simulation: Superdense Coding (superdense)**. 2 bits via 1 qubit — Bell-state encoding/decoding. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:369 (component src/renderer/src/physics/sims/SuperdenseCoding.jsx)`.
109. **Simulation: Deutsch Algorithm (deutsch)**. Constant vs balanced, single query, interference. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:370 (component src/renderer/src/physics/sims/DeutschAlgorithm.jsx)`.
110. **Simulation: Deutsch–Jozsa (dj)**. n=2 inputs, constant vs balanced in one query. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:371 (component src/renderer/src/physics/sims/DeutschJozsa.jsx)`.
111. **Simulation: Bernstein–Vazirani (bv)**. Find hidden string s in one query. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:372 (component src/renderer/src/physics/sims/BernsteinVazirani.jsx)`.
112. **Simulation: Grover's Algorithm (grover)**. √N search, amplitude amplification iteration-by-iteration. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:373 (component src/renderer/src/physics/sims/GroversAlgorithm.jsx)`.
113. **Simulation: Quantum Fourier Transform (qft)**. Real QFT on 3 qubits, phases carry the information. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:374 (component src/renderer/src/physics/sims/QuantumFourierTransform.jsx)`.
114. **Simulation: Quantum Phase Estimation (qpe)**. Estimate eigenphase θ via counting qubits + inverse QFT. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:375 (component src/renderer/src/physics/sims/QuantumPhaseEstimation.jsx)`.
115. **Simulation: Shor's Algorithm (N=15) (shor)**. Order-finding → factor 15 = 3·5. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:376 (component src/renderer/src/physics/sims/ShorsAlgorithm.jsx)`.
116. **Simulation: Entanglement (entangle)**. Build a Bell state, correlation analysis. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:377 (component src/renderer/src/physics/sims/EntanglementLab.jsx)`.
117. **Simulation: Density Matrices & Channels (density)**. ρ, Kraus ops, purity, channels. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:378 (component src/renderer/src/physics/sims/QuantumInfoLab.jsx)`.
118. **Simulation: Von Neumann Entropy (vonNeumann)**. S = −Tr(ρ log ρ), mixedness & entanglement entropy. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:379 (component src/renderer/src/physics/sims/VonNeumannEntropy.jsx)`.
119. **Simulation: Quantum Fidelity & Trace Distance (fidelity)**. F(ρ,σ), D(ρ,σ), operational meanings. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:380 (component src/renderer/src/physics/sims/QuantumFidelity.jsx)`.
120. **Simulation: Bell-State Analysis (bell)**. Four Bell states, amplitudes, correlations. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:381 (component src/renderer/src/physics/sims/BellStateAnalysis.jsx)`.
121. **Simulation: Quantum Tomography (tomo)**. Reconstruct ρ from ⟨X⟩⟨Y⟩⟨Z⟩, exponential cost. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:382 (component src/renderer/src/physics/sims/QuantumTomography.jsx)`.
122. **Simulation: Numerical Integration (numint)**. Trapezoid, Simpson, Gauss–Legendre convergence vs exact. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:388 (component src/renderer/src/physics/sims/NumericalIntegrationSim.jsx)`.
123. **Simulation: Numerical Differentiation (numdiff)**. Forward/central differences, truncation vs round-off trade-off. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:389 (component src/renderer/src/physics/sims/NumericalDifferentiationSim.jsx)`.
124. **Simulation: Root Finding (rootfind)**. Newton (quadratic), bisection (linear), secant (superlinear) convergence. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:390 (component src/renderer/src/physics/sims/RootFindingSim.jsx)`.
125. **Simulation: ODE Solver (ode)**. Euler, RK2, RK4, adaptive RK45 — accuracy vs cost comparison. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:391 (component src/renderer/src/physics/sims/ODESolverSim.jsx)`.
126. **Simulation: PDE Solver (pde)**. 1D heat equation FTCS, CFL stability, animated diffusion. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:392 (component src/renderer/src/physics/sims/PDESolverSim.jsx)`.
127. **Simulation: Eigenvalue Solver (eig)**. Jacobi (full spectrum) vs power iteration (dominant λ) convergence. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:393 (component src/renderer/src/physics/sims/EigenvalueSolverSim.jsx)`.
128. **Simulation: Matrix Laboratory (matrix)**. LU decomposition, determinant, solve Ax=b, residual analysis. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:394 (component src/renderer/src/physics/sims/MatrixLabSim.jsx)`.
129. **Simulation: Fourier Transform (fourier)**. DFT of pulse/sine signals, frequency spectrum, Nyquist. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:395 (component src/renderer/src/physics/sims/FourierTransformSim.jsx)`.
130. **Simulation: FFT (fft)**. Radix-2 Cooley–Tukey O(N log N) vs O(N²) DFT, timing & speedup. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:396 (component src/renderer/src/physics/sims/FFTSim.jsx)`.
131. **Simulation: Monte Carlo Methods (mcmc)**. Metropolis sampling, π estimation, 1/√N convergence. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:397 (component src/renderer/src/physics/sims/MonteCarloMethodsSim.jsx)`.
132. **Simulation: Finite Difference Method (fdm)**. 1D wave equation leapfrog, CFL condition, string vibration. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:398 (component src/renderer/src/physics/sims/FiniteDifferenceSim.jsx)`.
133. **Simulation: Finite Element Method (fem)**. 1D Poisson −u″=f, hat basis, Galerkin weak form, O(h²) convergence. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:399 (component src/renderer/src/physics/sims/FiniteElementSim.jsx)`.
134. **Simulation: Numerical Linear Algebra (numlinalg)**. LU, QR (Gram-Schmidt), condition number κ, digits lost. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:400 (component src/renderer/src/physics/sims/NumericalLinearAlgebraSim.jsx)`.
135. **Simulation: Error & Convergence Analysis (erranalysis)**. Truncation vs round-off, convergence rates, Kahan summation. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:401 (component src/renderer/src/physics/sims/ErrorConvergenceSim.jsx)`.
136. **Simulation: Differential Equation Visualizer (deviz)**. Phase portrait, vector field, RK4 trajectory, time series. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:402 (component src/renderer/src/physics/sims/DiffEqVisualizerSim.jsx)`.
137. **Simulation: Cellular Automata (ca)**. 1D elementary rules (30/90/110), 2D Game of Life, emergence. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:403 (component src/renderer/src/physics/sims/CellularAutomataSim.jsx)`.
138. **Simulation: Numerical Optimisation (optim)**. Gradient descent, momentum, Newton on Rosenbrock & quadratics. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:404 (component src/renderer/src/physics/sims/NumericalOptimizationSim.jsx)`.
139. **Simulation: Solar System Simulator (solar)**. Sun + planets, real gravity. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:410 (component src/renderer/src/physics/sims/SolarSystemSim.jsx)`.
140. **Simulation: Orbital Mechanics (orbital)**. Two-body & N-body orbits. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:411 (component src/renderer/src/physics/sims/OrbitalMechanicsSim.jsx)`.
141. **Simulation: Kepler's Laws (kepler)**. Elliptical orbits, T²∝a³. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:412 (component src/renderer/src/physics/sims/KeplersLawsSim.jsx)`.
142. **Simulation: N-Body Gravity (nbody)**. Velocity-Verlet integrator. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:413 (component src/renderer/src/physics/sims/NBodyGravitySim.jsx)`.
143. **Simulation: Three-Body Problem (threebody)**. Figure-8 & chaotic solutions. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:414 (component src/renderer/src/physics/sims/ThreeBodyProblemSim.jsx)`.
144. **Simulation: Binary Stars (binary)**. Two-body orbit preset. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:415 (component src/renderer/src/physics/sims/BinaryStarsSim.jsx)`.
145. **Simulation: Planetary Orbits (planets)**. Stable Keplerian orbits. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:416 (component src/renderer/src/physics/sims/PlanetaryOrbitsSim.jsx)`.
146. **Simulation: Stellar Evolution (stellar)**. HR track of a star. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:417 (component src/renderer/src/physics/sims/StellarEvolutionSim.jsx)`.
147. **Simulation: Hertzsprung–Russell Diagram (hr)**. Luminosity vs temperature. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:418 (component src/renderer/src/physics/sims/HertzsprungRussellSim.jsx)`.
148. **Simulation: Black Hole Simulator (blackhole)**. Schwarzschild geodesics. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:419 (component src/renderer/src/physics/sims/BlackHoleSim.jsx)`.
149. **Simulation: Gravitational Lensing (lensing)**. Light deflection. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:420 (component src/renderer/src/physics/sims/GravitationalLensingSim.jsx)`.
150. **Simulation: Neutron Stars (neutron)**. Compact objects. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:421 (component src/renderer/src/physics/sims/NeutronStarsSim.jsx)`.
151. **Simulation: Pulsars (pulsar)**. Rotating beams & spin-down. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:422 (component src/renderer/src/physics/sims/PulsarsSim.jsx)`.
152. **Simulation: Exoplanet Transit (exoplanet)**. Light-curve dip. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:423 (component src/renderer/src/physics/sims/ExoplanetTransitSim.jsx)`.
153. **Simulation: Radial Velocity Simulator (rv)**. Stellar wobble curve. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:424 (component src/renderer/src/physics/sims/RadialVelocitySim.jsx)`.
154. **Simulation: Gravitational Waves (gw)**. Chirp waveform h(t), f(t), spectrogram. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:425 (component src/renderer/src/physics/sims/GravitationalWavesSim.jsx)`.
155. **Simulation: Cosmic Expansion (cosmic-expansion)**. Hubble flow. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:426 (component src/renderer/src/physics/sims/CosmicExpansionSim.jsx)`.
156. **Simulation: Redshift (redshift)**. z from recession. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:427 (component src/renderer/src/physics/sims/RedshiftSim.jsx)`.
157. **Simulation: Dark Matter Rotation Curves (darkmatter)**. Flat galactic curves. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:428 (component src/renderer/src/physics/sims/DarkMatterCurvesSim.jsx)`.
158. **Simulation: Gravitational Time Dilation (timedilation)**. Clocks in gravity wells. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:429 (component src/renderer/src/physics/sims/GravitationalTimeDilationSim.jsx)`.
159. **Simulation: Radioactive Decay (decay)**. Monte Carlo, half-life. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:435 (component src/renderer/src/physics/sims/RadioactiveDecaySim.jsx)`.
160. **Simulation: Half-Life Simulator (halflife)**. Exponential decay. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:436 (component src/renderer/src/physics/sims/HalfLifeSim.jsx)`.
161. **Simulation: Decay Chains (chain)**. Sequential decays — Bateman equations. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:437 (component src/renderer/src/physics/sims/DecayChainsSim.jsx)`.
162. **Simulation: Alpha / Beta / Gamma Decay (alphabeta)**. Disintegration modes & Q-values. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:438 (component src/renderer/src/physics/sims/AlphaBetaGammaSim.jsx)`.
163. **Simulation: Nuclear Binding Energy (binding)**. Semi-empirical mass formula curve. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:439 (component src/renderer/src/physics/sims/NuclearBindingEnergySim.jsx)`.
164. **Simulation: Fission (fission)**. Chain reaction & Q-value. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:440 (component src/renderer/src/physics/sims/FissionSim.jsx)`.
165. **Simulation: Fusion (fusion)**. Light-nuclei merging & Q-value. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:441 (component src/renderer/src/physics/sims/FusionSim.jsx)`.
166. **Simulation: Nuclear Reactions (nucrxn)**. Q-value, cross-section. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:442 (component src/renderer/src/physics/sims/NuclearReactionsSim.jsx)`.
167. **Simulation: Particle Collision Simulator (collider)**. Centre-of-mass kinematics. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:443 (component src/renderer/src/physics/sims/ParticleCollisionSim.jsx)`.
168. **Simulation: Particle Detector (detector)**. Track reconstruction. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:444 (component src/renderer/src/physics/sims/ParticleDetectorSim.jsx)`.
169. **Simulation: Standard Model Explorer (sm)**. Fermions & bosons with quantum numbers. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:445 (component src/renderer/src/physics/sims/StandardModelSim.jsx)`.
170. **Simulation: Particle Properties (pprops)**. Mass, spin, charge, color, generation. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:446 (component src/renderer/src/physics/sims/ParticlePropertiesSim.jsx)`.
171. **Simulation: Interaction Analyser (interactions)**. Conservation-law checker. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:447 (component src/renderer/src/physics/sims/InteractionAnalyserSim.jsx)`.
172. **Simulation: Feynman Diagram Builder (feynman)**. Vertices & vertex-rule validation. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:448 (component src/renderer/src/physics/sims/FeynmanDiagramSim.jsx)`.
173. **Simulation: Fluid Flow (flow)**. 2D velocity field — sources, sinks, vortices, streamlines. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:454 (component src/renderer/src/physics/sims/FluidFlowSim.jsx)`.
174. **Simulation: Fluid Pressure (pressure)**. Static (ρgh) & dynamic (½ρv²) pressure. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:455 (component src/renderer/src/physics/sims/FluidPressureSim.jsx)`.
175. **Simulation: Buoyancy (buoyancy)**. Archimedes' principle — float/sink, displaced weight. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:456 (component src/renderer/src/physics/sims/BuoyancySim.jsx)`.
176. **Simulation: Bernoulli Equation (bernoulli)**. Venturi — pressure–speed trade-off along a streamline. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:457 (component src/renderer/src/physics/sims/BernoulliSim.jsx)`.
177. **Simulation: Viscosity (viscosity)**. Couette flow — shear stress τ = μ du/dy, no-slip. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:458 (component src/renderer/src/physics/sims/ViscositySim.jsx)`.
178. **Simulation: Laminar Flow (laminar)**. Parabolic Poiseuille profile, low Re, parallel layers. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:459 (component src/renderer/src/physics/sims/LaminarFlowSim.jsx)`.
179. **Simulation: Turbulent Flow (turbulent)**. High-Re vortex shedding, Kármán street, mixing. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:460 (component src/renderer/src/physics/sims/TurbulentFlowSim.jsx)`.
180. **Simulation: Reynolds Number (reynolds)**. Re = ρvL/μ — laminar/transitional/turbulent regimes. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:461 (component src/renderer/src/physics/sims/ReynoldsNumberSim.jsx)`.
181. **Simulation: Pipe Flow (pipe)**. Poiseuille Q = πR⁴ΔP/8μL — the R⁴ law. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:462 (component src/renderer/src/physics/sims/PipeFlowSim.jsx)`.
182. **Simulation: Drag (drag)**. Linear (Stokes) & quadratic drag, terminal velocity. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:463 (component src/renderer/src/physics/sims/DragSim.jsx)`.
183. **Simulation: Atmospheric Pressure (atmos)**. Barometric formula, scale height, layers. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:464 (component src/renderer/src/physics/sims/AtmosphericPressureSim.jsx)`.
184. **Simulation: Wave Propagation (waveprop)**. Sound — longitudinal pressure wave, c = √(B/ρ). Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:465 (component src/renderer/src/physics/sims/WavePropagationSim.jsx)`.
185. **Simulation: Shock Waves (shock)**. Mach cone, Rankine–Hugoniot jump conditions. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:466 (component src/renderer/src/physics/sims/ShockWavesSim.jsx)`.
186. **Simulation: Navier–Stokes Visualisation (navier)**. 2D stable-fluids solver with dye injection. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:467 (component src/renderer/src/physics/sims/NavierStokesVizSim.jsx)`.
187. **Simulation: Crystal Structure Viewer (crystal)**. 3D lattice + basis rendering for SC, BCC, FCC, diamond. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:473 (component src/renderer/src/physics/sims/CrystalStructureSim.jsx)`.
188. **Simulation: Unit Cell Builder (unitcell)**. Primitive vectors, lattice points, APF from hard-sphere geometry. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:474 (component src/renderer/src/physics/sims/UnitCellSim.jsx)`.
189. **Simulation: Bravais Lattices (bravais)**. All 14 Bravais types across 7 crystal systems. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:475 (component src/renderer/src/physics/sims/BravaisLatticesSim.jsx)`.
190. **Simulation: Reciprocal Lattice (reciprocal)**. Real→reciprocal via b_i = 2π(a_j×a_k)/V, Brillouin zone. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:476 (component src/renderer/src/physics/sims/ReciprocalLatticeSim.jsx)`.
191. **Simulation: Band Structure (band)**. Tight-binding E(k) along Γ→X→M→Γ, multi-band, gap. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:477 (component src/renderer/src/physics/sims/BandStructureSim.jsx)`.
192. **Simulation: Density of States (dos)**. g(E) by k-mesh histogramming, van Hove singularities. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:478 (component src/renderer/src/physics/sims/DensityOfStatesSim.jsx)`.
193. **Simulation: Semiconductor Simulator (semicon)**. n_i = √(Nc·Nv)exp(−Eg/2kT), doping, Fermi level. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:479 (component src/renderer/src/physics/sims/SemiconductorSim.jsx)`.
194. **Simulation: PN Junction (pn)**. Depletion width, field profile, band bending, bias. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:480 (component src/renderer/src/physics/sims/PNJunctionSim.jsx)`.
195. **Simulation: Diode I–V (diode)**. Shockley I=Is(exp(qV/nkT)−1), breakdown, series R. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:481 (component src/renderer/src/physics/sims/DiodeIVSim.jsx)`.
196. **Simulation: Hall Effect (hall)**. V_H = IB/(nqt), carrier sign & density. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:482 (component src/renderer/src/physics/sims/HallEffectSim.jsx)`.
197. **Simulation: Ferromagnetism (ferro)**. Mean-field M(T), hysteresis loop, coercivity & remanence. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:483 (component src/renderer/src/physics/sims/FerromagnetismSim.jsx)`.
198. **Simulation: Antiferromagnetism (antiferro)**. Two-sublattice Ising J<0, staggered M_s, Néel T_N. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:484 (component src/renderer/src/physics/sims/AntiferromagnetismSim.jsx)`.
199. **Simulation: Ising Model (ising2)**. 2D Metropolis/Wolff MC, Onsager Tc ≈ 2.269. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:485 (component src/renderer/src/physics/sims/IsingModelSim.jsx)`.
200. **Simulation: Heisenberg Model (heisenberg)**. Classical O(3) vector spins, Mermin-Wagner in 2D. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:486 (component src/renderer/src/physics/sims/HeisenbergModelSim.jsx)`.
201. **Simulation: XY Model (xy)**. Planar rotors, vortices, KT transition at T_KT ≈ 0.89. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:487 (component src/renderer/src/physics/sims/XYModelSim.jsx)`.
202. **Simulation: Superconductivity (supercon)**. BCS gap Δ(T), R(T)→0, gapped DOS N(E). Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:488 (component src/renderer/src/physics/sims/SuperconductivitySim.jsx)`.
203. **Simulation: Phase Transitions (phases)**. Exact Onsager 2D Ising: M, E, C_V, χ with critical exponents. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:489 (component src/renderer/src/physics/sims/PhaseTransitionsSim.jsx)`.
204. **Simulation: Topological Materials (topo)**. SSH model, winding number, zero-energy edge states. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:490 (component src/renderer/src/physics/sims/TopologicalMaterialsSim.jsx)`.
205. **Simulation: Simple Pendulum (vl-pendulum)**. Measure g from period. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:496 (component src/renderer/src/physics/sims/VLPendulumSim.jsx)`.
206. **Simulation: Projectile Motion (vl-projectile)**. Range vs angle. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:497 (component src/renderer/src/physics/sims/VLProjectileSim.jsx)`.
207. **Simulation: Newton's Laws (vl-newton)**. Force & acceleration. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:498 (component src/renderer/src/physics/sims/VLNewtonSim.jsx)`.
208. **Simulation: Conservation of Momentum (vl-momentum)**. Before/after. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:499 (component src/renderer/src/physics/sims/VLMomentumSim.jsx)`.
209. **Simulation: Conservation of Energy (vl-energy)**. KE+PE constant. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:500 (component src/renderer/src/physics/sims/VLEnergySim.jsx)`.
210. **Simulation: SHM (vl-shm)**. k from period. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:501 (component src/renderer/src/physics/sims/VLSHMSim.jsx)`.
211. **Simulation: Young's Modulus (vl-young)**. Stress–strain. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:502 (component src/renderer/src/physics/sims/VLYoungModulusSim.jsx)`.
212. **Simulation: Ohm's Law (vl-ohm)**. V=IR. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:503 (component src/renderer/src/physics/sims/VLOhmsLawSim.jsx)`.
213. **Simulation: Kirchhoff's Laws (vl-kirchhoff)**. Multi-loop KVL/KCL solver. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:504 (component src/renderer/src/physics/sims/VLKirchhoffSim.jsx)`.
214. **Simulation: Wheatstone Bridge (vl-wheatstone)**. Null measurement, ratio arms. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:505 (component src/renderer/src/physics/sims/VLWheatstoneSim.jsx)`.
215. **Simulation: Meter Bridge (vl-meter)**. Slide-wire, balance point. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:506 (component src/renderer/src/physics/sims/VLMeterBridgeSim.jsx)`.
216. **Simulation: Convex Lens (vl-convex)**. Image formation, focal length. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:507 (component src/renderer/src/physics/sims/VLConvexLensSim.jsx)`.
217. **Simulation: Concave Mirror (vl-concave)**. Reflection imaging, focal length. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:508 (component src/renderer/src/physics/sims/VLConcaveMirrorSim.jsx)`.
218. **Simulation: Prism (vl-prism)**. Dispersion, minimum deviation. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:509 (component src/renderer/src/physics/sims/VLPrismSim.jsx)`.
219. **Simulation: Resonance Tube (vl-resonance)**. Speed of sound. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:510 (component src/renderer/src/physics/sims/VLResonanceTubeSim.jsx)`.
220. **Simulation: RC Circuit (vl-rc)**. Charging curve, τ = RC. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:511 (component src/renderer/src/physics/sims/VLRCcircuitSim.jsx)`.
221. **Simulation: Electromagnetic Induction (vl-emi)**. Induced EMF, Faraday law. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:512 (component src/renderer/src/physics/sims/VLEMImsim.jsx)`.
222. **Simulation: CSV / TXT / JSON Import (dl-csv)**. Upload experimental data. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:518 (component src/renderer/src/physics/sims/DataLab.jsx)`.
223. **Simulation: Data Cleaning & Sorting (dl-clean)**. Filter, sort, search. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:519 (component src/renderer/src/physics/sims/DataLab.jsx)`.
224. **Simulation: Scientific Graphing (dl-graph)**. Line, scatter, bar, histogram. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:520 (component src/renderer/src/physics/sims/DataLab.jsx)`.
225. **Simulation: Linear Regression (dl-linreg)**. y = mx + c with uncertainties. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:521 (component src/renderer/src/physics/sims/DataLab.jsx)`.
226. **Simulation: Polynomial Fitting (dl-poly)**. Least-squares polynomial. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:522 (component src/renderer/src/physics/sims/DataLab.jsx)`.
227. **Simulation: Curve Fitting (dl-curve)**. Nonlinear fits. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:523 (component src/renderer/src/physics/sims/DataLab.jsx)`.
228. **Simulation: Error Bars (dl-errbars)**. Uncertainty on plots. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:524 (component src/renderer/src/physics/sims/DataLab.jsx)`.
229. **Simulation: Residual Analysis (dl-residual)**. Fit quality. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:525 (component src/renderer/src/physics/sims/DataLab.jsx)`.
230. **Simulation: Mean & Standard Deviation (dl-mean)**. Summary stats. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:526 (component src/renderer/src/physics/sims/DataLab.jsx)`.
231. **Simulation: Uncertainty Propagation (dl-uncert)**. Error formulas. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:527 (component src/renderer/src/physics/sims/UncertaintyLab.jsx)`.
232. **Simulation: Unit Conversion (dl-units)**. Convert units with dim check. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:528 (component src/renderer/src/physics/sims/ConstantsLab.jsx)`.
233. **Simulation: Slope & Intercept (dl-slope)**. From data. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:529 (component src/renderer/src/physics/sims/DataLab.jsx)`.
234. **Simulation: Best-Fit Equations (dl-bestfit)**. Report the model. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:530 (component src/renderer/src/physics/sims/DataLab.jsx)`.
235. **Simulation: Quantum Field Theory (quantum-field-theory)**. Field modes — many-body view. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:536 (component src/renderer/src/physics/sims/QuantumManyBodyResearch.jsx)`.
236. **Simulation: Tensor Networks (tn)**. MPS / PEPS — many-body view. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:537 (component src/renderer/src/physics/sims/QuantumManyBodyResearch.jsx)`.
237. **Simulation: DMRG (dmrg)**. Many-body diagonalisation. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:538 (component src/renderer/src/physics/sims/QuantumManyBodyResearch.jsx)`.
238. **Simulation: Quantum Monte Carlo (qmc)**. Stochastic quantum sampling. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:539 (component src/renderer/src/physics/sims/PhaseTransitionLab.jsx)`.
239. **Simulation: Molecular Dynamics (md)**. Lennard–Jones, velocity-Verlet, RDF. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:540 (component src/renderer/src/physics/sims/MolecularDynamics.jsx)`.
240. **Simulation: Computational Fluid Dynamics (cfd)**. 2D Navier–Stokes stable fluids. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:541 (component src/renderer/src/physics/sims/CfdLab.jsx)`.
241. **Simulation: Plasma Physics (plasma)**. Lorentz force, E×B, cyclotron. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:542 (component src/renderer/src/physics/sims/PlasmaLab.jsx)`.
242. **Simulation: Numerical Relativity (numrel)**. Einstein equations — geodesics. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:543 (component src/renderer/src/physics/sims/GravityRelativity.jsx)`.
243. **Simulation: Gravitational Waves (chirp) (gw-chirp)**. Chirp waveform & spectrogram. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:544 (component src/renderer/src/physics/sims/GravitationalWaves.jsx)`.
244. **Simulation: Many-Body Localisation (mbl)**. Disorder & entanglement. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:545 (component src/renderer/src/physics/sims/QuantumManyBodyResearch.jsx)`.
245. **Simulation: Topological Phases (topo2)**. Invariants & edge modes — band view. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:546 (component src/renderer/src/physics/sims/CondensedMatterLab.jsx)`.
246. **Simulation: Quantum Information Research (qinfo2)**. Density matrices, channels, tomography. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:547 (component src/renderer/src/physics/sims/QuantumInfoLab.jsx)`.
247. **Simulation: Quantum Many-Body Research (qmb2)**. Entanglement entropy & gap scaling. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:548 (component src/renderer/src/physics/sims/QuantumManyBodyResearch.jsx)`.
248. **Simulation: Advanced Quantum Error Correction (aqec)**. Surface codes & decoders. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:549 (component src/renderer/src/physics/sims/QECLab.jsx)`.
249. **Simulation: Fault-Tolerant Quantum Computing (ftqc)**. Threshold studies. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:550 (component src/renderer/src/physics/sims/QECLab.jsx)`.
250. **Simulation: Physics Constants & Units (constants)**. CODATA values, prefixes, unit conversion. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:556 (component src/renderer/src/physics/sims/ConstantsLab.jsx)`.
251. **Simulation: Dimensional Analysis (dimensional)**. Verify equations dimensionally. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:557 (component src/renderer/src/physics/sims/DimensionalLab.jsx)`.
252. **Simulation: Uncertainty & Error Lab (uncertainty)**. Propagation, quadrature, CI. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:558 (component src/renderer/src/physics/sims/UncertaintyLab.jsx)`.
253. **Simulation: Numerical Methods Lab (numerics)**. ODE, integration, roots, eigen, MC. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:559 (component src/renderer/src/physics/sims/NumericsLab.jsx)`.
254. **Simulation: Scientific Visualization (viz)**. Plots, heatmaps, spectrograms. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:560 (component src/renderer/src/physics/sims/DataLab.jsx)`.
255. **Simulation: Research Notebook (notebook)**. Reproducible experiment records. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:561 (component src/renderer/src/physics/sims/ResearchNotebook.jsx)`.
256. **Simulation: Experiment Comparison (compare)**. Side-by-side result comparison. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:562 (component src/renderer/src/physics/sims/ExperimentComparison.jsx)`.
257. **Simulation: High-Performance Computing (hpc)**. Web Worker sweeps with cancel. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:563 (component src/renderer/src/physics/sims/PhaseTransitionLab.jsx)`.
258. **Simulation: Scientific Validation (validation)**. Numerical vs analytic error. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:564 (component src/renderer/src/physics/sims/NumericsLab.jsx)`.
259. **Simulation: Reproducibility (reproducibility)**. Save & re-run configurations. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:565 (component src/renderer/src/physics/sims/ResearchNotebook.jsx)`.
260. **Simulation: Research-Style Export (export)**. CSV / JSON / PNG export. Runs as its own interactive simulation. Where: `src/renderer/src/physics/lib/registry.js:566 (component src/renderer/src/physics/sims/DataLab.jsx)`.
261. **Formula: Average velocity (v = Δx / Δt)**. How far it got, divided by how long it took. Says nothing about what happened in between. Where: `src/shared/physics/formulas.ts:109`.
262. **Formula: Average acceleration (a = Δv / Δt)**. How much the velocity changed, divided by how long that took. Where: `src/shared/physics/formulas.ts:120`.
263. **Formula: Velocity after a time (v = u + a·t)**. The first of the four equations of motion. Velocity grows steadily when acceleration is steady. Where: `src/shared/physics/formulas.ts:131`.
264. **Formula: Displacement after a time (s = u·t + ½·a·t²)**. How far it travels: the distance at the starting speed, plus the extra the acceleration adds. Where: `src/shared/physics/formulas.ts:142`.
265. **Formula: Velocity without time (v² = u² + 2·a·s)**. The equation of motion with the time taken out of it. Reach for it when you know the distance but not the duration. Where: `src/shared/physics/formulas.ts:172`.
266. **Formula: Range of a projectile (R = u²·sin(2θ) / g)**. How far a thrown object lands away, for level ground. Longest at 45°, and equal for any two angles adding to 90°. Where: `src/shared/physics/formulas.ts:188`.
267. **Formula: Peak height of a projectile (H = u²·sin²(θ) / (2·g))**. The highest point reached — set by the upward part of the launch speed alone. Where: `src/shared/physics/formulas.ts:204`.
268. **Formula: Time in the air (T = 2·u·sin(θ) / g)**. How long it stays up. Depends only on the upward speed, which is why a flat throw lands quickly however hard you throw it. Where: `src/shared/physics/formulas.ts:220`.
269. **Formula:  (F = m·a)**. The law the whole of mechanics is built on: force is what changes motion, and mass is how much it resists. Where: `src/shared/physics/formulas.ts:238`.
270. **Formula: Weight (W = m·g)**. The force gravity pulls with. Weight is a force and changes with where you are; mass does not. Where: `src/shared/physics/formulas.ts:249`.
271. **Formula: Momentum (p = m·v)**. How much motion something has. Conserved in every collision, which is what makes it so useful. Where: `src/shared/physics/formulas.ts:260`.
272. **Formula: Impulse (J = F·Δt = Δp)**. Force multiplied by how long it acts. Equals the change in momentum, which is why a long crumple zone hurts less than a short one. Where: `src/shared/physics/formulas.ts:271`.
273. **Formula: Kinetic energy (KE = ½·m·v²)**. The energy of motion. Note the square: twice the speed is four times the energy, which is the whole story of road safety. Where: `src/shared/physics/formulas.ts:282`.
274. **Formula: Gravitational potential energy (PE = m·g·h)**. The energy stored by lifting something. Measured from wherever you choose to call zero. Where: `src/shared/physics/formulas.ts:293`.
275. **Formula: Work done (W = F·d·cos(θ))**. Energy transferred by a force. A force at right angles to the motion does no work at all, however large it is. Where: `src/shared/physics/formulas.ts:304`.
276. **Formula: Power (P = W / t)**. How fast energy is transferred. The same job done in half the time needs twice the power. Where: `src/shared/physics/formulas.ts:320`.
277. **Formula:  (F = −k·x)**. A spring pulls back in proportion to how far you stretch it. The minus sign is the "back". Where: `src/shared/physics/formulas.ts:331`.
278. **Formula: Energy in a spring (E = ½·k·x²)**. The work it took to stretch it, stored and ready to come back. Where: `src/shared/physics/formulas.ts:342`.
279. **Formula: Friction (f = μ·N)**. Friction scales with how hard the surfaces are pressed together — and not at all with the contact area, which surprises most people. Where: `src/shared/physics/formulas.ts:353`.
280. **Formula: Centripetal force (F = m·v² / r)**. The inward force needed to keep something going in a circle. Not a new kind of force — something real has to supply it. Where: `src/shared/physics/formulas.ts:364`.
281. **Formula: Angular velocity (ω = 2π / T = v / r)**. How fast it turns, in radians a second. One full turn is 2π of them. Where: `src/shared/physics/formulas.ts:377`.
282. **Formula: Torque (τ = r·F·sin(θ))**. The turning effect of a force. Push at the far end of the spanner, and push at right angles. Where: `src/shared/physics/formulas.ts:388`.
283. **Formula:  (τ = I·α)**. The same law as F = ma, with torque for force, moment of inertia for mass, and angular acceleration for acceleration. Where: `src/shared/physics/formulas.ts:404`.
284. **Formula: Angular momentum (L = I·ω)**. Conserved when nothing twists from outside — which is why a skater pulling their arms in spins faster. Where: `src/shared/physics/formulas.ts:415`.
285. **Formula: Rotational kinetic energy (KE = ½·I·ω²)**. The energy of spinning. A rolling ball has this as well as its straight-line kinetic energy, which is why it accelerates down a slope more slowly than a sliding one. Where: `src/shared/physics/formulas.ts:426`.
286. **Formula:  (F = G·m₁·m₂ / r²)**. Every mass pulls every other. The inverse square is why gravity reaches so far and yet is so weak nearby. Where: `src/shared/physics/formulas.ts:439`.
287. **Formula: Circular orbit speed (v = √(G·M / r))**. The one speed at which gravity exactly bends the path into a circle. Faster and the orbit stretches into an ellipse; faster still and it leaves. Where: `src/shared/physics/formulas.ts:455`.
288. **Formula: Escape velocity (v = √(2·G·M / r))**. The speed that just barely never comes back. Exactly √2 times the circular orbit speed at the same radius. Where: `src/shared/physics/formulas.ts:466`.
289. **Formula:  (T² = 4π²·a³ / (G·M))**. The period squared goes as the radius cubed. Measure a moon and you have weighed the planet. Where: `src/shared/physics/formulas.ts:477`.
290. **Formula: Schwarzschild radius (r = 2·G·M / c²)**. Squeeze a mass inside this radius and not even light gets out. For the Sun it is about 3 km. Where: `src/shared/physics/formulas.ts:492`.
291. **Formula: Period of a spring (T = 2π·√(m / k))**. How long one bounce takes. Heavier is slower, stiffer is faster, and the amplitude makes no difference at all. Where: `src/shared/physics/formulas.ts:505`.
292. **Formula: Period of a pendulum (T = 2π·√(L / g))**. Depends on the length and on gravity, and not on the mass — which is what made pendulum clocks possible. Where: `src/shared/physics/formulas.ts:516`.
293. **Formula: Wave speed (v = f·λ)**. The most used formula in waves. The medium fixes the speed, so raising the frequency shortens the wavelength. Where: `src/shared/physics/formulas.ts:527`.
294. **Formula: Frequency and period (f = 1 / T)**. Two ways of saying the same thing: how often, and how long each one takes. Where: `src/shared/physics/formulas.ts:538`.
295. **Formula: Doppler shift**. Why a siren drops as it passes. Motion toward raises the pitch; motion away lowers it. Where: `src/shared/physics/formulas.ts:549`.
296. **Formula: Standing wave on a string (f = n·v / (2·L))**. Which notes a string can play. Only whole numbers of half-waves fit, and that is why instruments have notes rather than a smear. Where: `src/shared/physics/formulas.ts:565`.
297. **Formula: Wave speed on a string (v = √(T / μ))**. Tighter is faster, heavier is slower. This is what tuning a guitar actually changes. Where: `src/shared/physics/formulas.ts:576`.
298. **Formula: Sound intensity level (L = 10·log₁₀(I / I₀))**. Loudness in decibels, against the quietest audible sound. Ten times the intensity is only 10 dB, because hearing is logarithmic. Where: `src/shared/physics/formulas.ts:587`.
299. **Formula: Pressure (P = F / A)**. Force spread over an area. The same push through a needle and through a palm are very different things. Where: `src/shared/physics/formulas.ts:600`.
300. **Formula: Pressure with depth (P = ρ·g·h)**. Pressure in a fluid grows with depth, and depends on nothing about the shape of the container. Where: `src/shared/physics/formulas.ts:611`.
301. **Formula:  (F = ρ·g·V)**. The upward push equals the weight of the fluid pushed aside. It is why steel ships float. Where: `src/shared/physics/formulas.ts:622`.
302. **Formula: Continuity (A₁·v₁ = A₂·v₂)**. What goes in must come out, so narrowing a pipe speeds up the flow. This is a thumb over a hose. Where: `src/shared/physics/formulas.ts:633`.
303. **Formula: Reynolds number (Re = ρ·v·L / μ)**. Whether flow will be smooth or turbulent. Below about 2,000 in a pipe it is orderly; above about 4,000 it is chaos. Where: `src/shared/physics/formulas.ts:644`.
304. **Formula: Ideal gas law (P·V = n·R·T)**. Pressure, volume, amount and temperature, all in one line. The foundation of every gas calculation. Where: `src/shared/physics/formulas.ts:663`.
305. **Formula: Temperature and particle energy (KE_avg = (3/2)·k_B·T)**. What temperature actually is: the average energy of motion per particle. Nothing more mysterious than that. Where: `src/shared/physics/formulas.ts:674`.
306. **Formula: Root-mean-square speed (v_rms = √(3·R·T / M))**. How fast gas molecules actually move. Air at room temperature is around 500 m/s, which startles most people. Where: `src/shared/physics/formulas.ts:685`.
307. **Formula: Heat needed to warm something (Q = m·c·ΔT)**. How much energy a temperature rise costs. Water's huge value is why the sea moderates climate. Where: `src/shared/physics/formulas.ts:696`.
308. **Formula: Heat to change state (Q = m·L)**. The energy to melt or boil something, all of it going into breaking bonds and none into temperature. Where: `src/shared/physics/formulas.ts:707`.
309. **Formula: Carnot efficiency (η = 1 − T_c / T_h)**. The best any heat engine can ever do, set by the two temperatures alone. No cleverness beats it. Where: `src/shared/physics/formulas.ts:718`.
310. **Formula: Stefan–Boltzmann law (P = σ·A·ε·T⁴)**. Everything warm glows, and the power goes as the fourth power of temperature. Double the temperature, sixteen times the radiation. Where: `src/shared/physics/formulas.ts:729`.
311. **Formula:  (λ_max = 2.898×10⁻³ / T)**. Hotter things glow bluer. This is how a star's colour gives away its temperature. Where: `src/shared/physics/formulas.ts:745`.
312. **Formula: Entropy change (ΔS = Q / T)**. How much disorder a heat transfer adds. The same heat at a low temperature adds far more. Where: `src/shared/physics/formulas.ts:756`.
313. **Formula: Boltzmann entropy (S = k_B·ln(W))**. Entropy counted directly: how many ways the particles could be arranged and still look the same. The formula on Boltzmann's gravestone. Where: `src/shared/physics/formulas.ts:767`.
314. **Formula:  (F = k·q₁·q₂ / r²)**. The electric version of gravity — inverse square again, but about 10³⁶ times stronger, and it can push as well as pull. Where: `src/shared/physics/formulas.ts:780`.
315. **Formula: Electric field of a point charge (E = k·q / r²)**. What the charge does to the space around it, whether or not anything is there to feel it. Where: `src/shared/physics/formulas.ts:796`.
316. **Formula: Electric potential (V = k·q / r)**. Energy per unit charge. Note it falls as 1/r, not 1/r² — potential and field are not the same shape. Where: `src/shared/physics/formulas.ts:807`.
317. **Formula:  (V = I·R)**. The most used formula in electronics. Push harder and more flows, unless something resists. Where: `src/shared/physics/formulas.ts:818`.
318. **Formula: Electrical power (P = V·I = I²·R)**. How fast electrical energy turns into something else — heat, light or motion. Where: `src/shared/physics/formulas.ts:829`.
319. **Formula: Resistance of a wire (R = ρ·L / A)**. Long and thin resists; short and fat does not. This is why mains cable is thick. Where: `src/shared/physics/formulas.ts:840`.
320. **Formula: Capacitance (C = Q / V)**. How much charge it holds per volt. The definition of a capacitor. Where: `src/shared/physics/formulas.ts:851`.
321. **Formula: Energy in a capacitor (E = ½·C·V²)**. The energy stored in the field between the plates, available all at once — which is how a camera flash works. Where: `src/shared/physics/formulas.ts:862`.
322. **Formula: Parallel plate capacitor (C = ε₀·ε_r·A / d)**. Bigger plates closer together store more. The dielectric between them multiplies it further. Where: `src/shared/physics/formulas.ts:873`.
323. **Formula: RC time constant (τ = R·C)**. How long a capacitor takes to charge: about 63% in one time constant, and essentially full in five. Where: `src/shared/physics/formulas.ts:889`.
324. **Formula: Force on a moving charge (F = q·v·B·sin(θ))**. A magnetic field pushes a moving charge sideways — at right angles to both the motion and the field, which is why it curves rather than speeds up. Where: `src/shared/physics/formulas.ts:902`.
325. **Formula: Cyclotron radius (r = m·v / (q·B))**. The circle a charged particle is bent into. Faster is wider, stronger field is tighter — the basis of every particle accelerator. Where: `src/shared/physics/formulas.ts:918`.
326. **Formula: Force on a current-carrying wire (F = B·I·L·sin(θ))**. How every electric motor works. Current in a field gets pushed. Where: `src/shared/physics/formulas.ts:929`.
327. **Formula: Field inside a solenoid (B = μ₀·n·I)**. A coil makes a nearly uniform field inside it, set by the turns per metre and the current — and not by the coil's diameter. Where: `src/shared/physics/formulas.ts:945`.
328. **Formula:  (ε = −N·ΔΦ / Δt)**. A changing magnetic field makes a voltage. Every generator, transformer and induction hob rests on this one line. Where: `src/shared/physics/formulas.ts:956`.
329. **Formula: Transformer (V_s / V_p = N_s / N_p)**. Change the voltage by changing the turns ratio. This is why mains power can travel hundreds of miles. Where: `src/shared/physics/formulas.ts:967`.
330. **Formula: Energy in an inductor (E = ½·L·I²)**. Energy stored in the magnetic field. It is why breaking an inductive circuit makes a spark — the energy has to go somewhere. Where: `src/shared/physics/formulas.ts:978`.
331. **Formula: LC resonance (f = 1 / (2π·√(L·C)))**. The frequency a coil and capacitor ring at together. This is how a radio picks one station out of all of them. Where: `src/shared/physics/formulas.ts:989`.
332. **Formula:  (n₁·sin(θ₁) = n₂·sin(θ₂))**. Why a straw looks bent in water. Light changes direction when it changes speed. Where: `src/shared/physics/formulas.ts:1006`.
333. **Formula: Critical angle (sin(θ_c) = n₂ / n₁)**. Past this angle light cannot get out and reflects completely. This is what makes fibre optics work. Where: `src/shared/physics/formulas.ts:1022`.
334. **Formula: Refractive index (n = c / v)**. How much slower light goes in a material. Water is 1.33, glass about 1.5, diamond 2.42. Where: `src/shared/physics/formulas.ts:1037`.
335. **Formula: Lens equation (1/f = 1/u + 1/v)**. Where the image forms. The single formula behind cameras, glasses, telescopes and your own eye. Where: `src/shared/physics/formulas.ts:1048`.
336. **Formula: Magnification (m = −v / u)**. How much bigger the image is. A negative value means it is upside down. Where: `src/shared/physics/formulas.ts:1059`.
337. **Formula: Lens power (P = 1 / f)**. Dioptres, the number on a spectacle prescription. Shorter focal length means stronger lens. Where: `src/shared/physics/formulas.ts:1070`.
338. **Formula: Double slit (d·sin(θ) = m·λ)**. Where the bright fringes land. The experiment that proved light is a wave, and later that electrons are too. Where: `src/shared/physics/formulas.ts:1081`.
339. **Formula: Rayleigh criterion (θ = 1.22·λ / D)**. The finest detail any telescope or camera can see, set by diffraction and not by the quality of the glass. Where: `src/shared/physics/formulas.ts:1097`.
340. **Formula: Photon energy (E = h·f = h·c / λ)**. Light comes in lumps, and each lump's energy depends only on the colour. This is where quantum mechanics starts. Where: `src/shared/physics/formulas.ts:1110`.
341. **Formula: Photoelectric effect (KE_max = h·f − φ)**. Shine light on metal and electrons come out — but only above a threshold frequency, however bright the light. The observation that forced physics to accept photons. Where: `src/shared/physics/formulas.ts:1121`.
342. **Formula: de Broglie wavelength (λ = h / p)**. Everything is a wave, including you — just with a wavelength far too small to notice. For an electron it is around the size of an atom, which is why electron microscopes work. Where: `src/shared/physics/formulas.ts:1132`.
343. **Formula: Heisenberg uncertainty (Δx·Δp ≥ ℏ/2)**. Not a limit of our instruments — a limit of what "position" and "momentum" can simultaneously mean. Pin one down and the other spreads out. Where: `src/shared/physics/formulas.ts:1143`.
344. **Formula: Hydrogen energy levels (E_n = −13.6 eV / n²)**. Why hydrogen emits exactly the colours it does. The negative sign means the electron is bound. Where: `src/shared/physics/formulas.ts:1154`.
345. **Formula: Particle in a box (E_n = n²·h² / (8·m·L²))**. The simplest quantum problem there is, and the one every other is compared to. Confine something and its energy must come in steps. Where: `src/shared/physics/formulas.ts:1165`.
346. **Formula: Compton wavelength shift (Δλ = (h / (m·c))·(1 − cos θ))**. X-rays bounce off electrons and come back redder. Proof that photons carry momentum like particles. Where: `src/shared/physics/formulas.ts:1181`.
347. **Formula: Mass–energy equivalence (E = m·c²)**. The most famous equation in physics. Mass is a form of energy, and c² is an enormous exchange rate. Where: `src/shared/physics/formulas.ts:1197`.
348. **Formula: Lorentz factor (γ = 1 / √(1 − v²/c²))**. The number behind every relativistic effect. Barely above 1 at everyday speeds, and climbing without limit as you approach light speed. Where: `src/shared/physics/formulas.ts:1208`.
349. **Formula: Time dilation**. A moving clock runs slow. Measured on muons, on GPS satellites and in particle accelerators every day. Where: `src/shared/physics/formulas.ts:1222`.
350. **Formula: Length contraction (L = L₀ / γ)**. A moving object is shorter along its direction of travel. Not an illusion — the measurement really gives a smaller number. Where: `src/shared/physics/formulas.ts:1233`.
351. **Formula: Relativistic momentum (p = γ·m·v)**. Momentum grows without limit as you approach light speed, which is the real reason nothing massive reaches it. Where: `src/shared/physics/formulas.ts:1244`.
352. **Formula: Relativistic Doppler**. The Doppler shift done properly for light. Positive β is receding, which lowers the frequency — this is cosmological redshift. Where: `src/shared/physics/formulas.ts:1255`.
353. **Formula: Radioactive decay (N = N₀·e^(−λt))**. Each nucleus decays at random, and that randomness averages out into an exact exponential. Where: `src/shared/physics/formulas.ts:1275`.
354. **Formula: Half-life (t½ = ln(2) / λ)**. How long until half of it is gone. Then half of the rest in the same time again, for ever. Where: `src/shared/physics/formulas.ts:1291`.
355. **Formula: Activity (A = λ·N)**. Decays per second. A short half-life with few atoms can be more active than a long one with many. Where: `src/shared/physics/formulas.ts:1302`.
356. **Formula: Mass defect and binding energy (E = Δm·c²)**. A nucleus weighs less than its parts, and the missing mass is what holds it together. This is where fission and fusion energy comes from. Where: `src/shared/physics/formulas.ts:1313`.
357. **Formula: Radiation attenuation (I = I₀·e^(−μx))**. How much shielding stops. Exponential, so there is no thickness that stops all of it — only thicknesses that stop enough. Where: `src/shared/physics/formulas.ts:1324`.
358. **Formula:  (v = H₀·d)**. Everything distant is moving away, faster the further off it is. The observation that told us the universe is expanding. Where: `src/shared/physics/formulas.ts:1342`.
359. **Formula: Apparent brightness (b = L / (4π·d²))**. Light spreads over a sphere, so brightness falls as the square of distance. Knowing a star's true output gives you its distance. Where: `src/shared/physics/formulas.ts:1353`.
360. **Formula: Parallax distance (d = 1 / p)**. A nearby star shifts against the background as Earth orbits. The only truly direct way to measure a stellar distance. Where: `src/shared/physics/formulas.ts:1364`.
361. **Formula: Jeans mass (M_J ≈ (5kT/(G·m))^(3/2)·(3/(4πρ))^(1/2))**. How much gas must gather before gravity beats pressure and a star begins to form. Where: `src/shared/physics/formulas.ts:1375`.
362. **Formula: Particles in an amount (N = n·N_A)**. A mole is just a count — about 6.022×10²³ of whatever you are counting. Where: `src/shared/physics/formulas.ts:1388`.
363. **Formula: Charge and electrons (Q = n·e)**. Charge comes in whole multiples of the electron charge. There is no half an electron's worth. Where: `src/shared/physics/formulas.ts:1399`.
364. **Formula: Current (I = Q / t)**. Current is charge flowing past, per second. One amp is one coulomb a second. Where: `src/shared/physics/formulas.ts:1410`.
365. **Formula: Density (ρ = m / V)**. Mass packed into a volume. Water is 1,000; air is about 1.2. Where: `src/shared/physics/formulas.ts:1421`.
366. **Formula:  (E = (F/A) / (ΔL/L))**. How stiff a material is, independent of its shape. Steel is about 200 GPa; rubber is a millionth of that. Where: `src/shared/physics/formulas.ts:1432`.

## 4. Motion Lab

- Id: `motion-lab`
- Screen file: `src/renderer/src/components/PhysicsLabs.tsx` (line 140)
- Catalogue entry: `src/shared/native/catalogue.ts:784`
- Declared settings: Declared in src/shared/native/catalogue.ts (MOTION, from line 198): durations 200, accelerations 209, velocity 217, position 218.
- Features: 6

1. **Phase setup**. Enter how long each stretch lasts and how fast it speeds up or slows down, plus a starting position and speed. Where: `src/renderer/src/components/PhysicsLabs.tsx:181-186 (calculation 146-163)`.
2. **Phase count check**. Warns when the number of durations and accelerations differ, and uses only the matching pairs. Where: `src/renderer/src/components/PhysicsLabs.tsx:188-193`.
3. **Summary figures**. Shows total time, where it ends, net displacement and total distance travelled. Where: `src/renderer/src/components/PhysicsLabs.tsx:198-205`.
4. **Position against time graph**. Plots where the object is at every moment. Where: `src/renderer/src/components/PhysicsLabs.tsx:206-209`.
5. **Velocity and acceleration graph**. Plots speed and acceleration over the same time. Where: `src/renderer/src/components/PhysicsLabs.tsx:210-216`.
6. **Phase-by-phase table**. Lists each stretch with its acceleration, end point, end speed, distance moved and whether it turned back. Where: `src/renderer/src/components/PhysicsLabs.tsx:217-249`.

## 5. Projectile Lab

- Id: `projectile-lab`
- Screen file: `src/renderer/src/components/PhysicsLabs.tsx` (line 258)
- Catalogue entry: `src/shared/native/catalogue.ts:798`
- Declared settings: Declared in src/shared/native/catalogue.ts (PROJECTILE, from line 100): speed 102, angle 115, height 128, gravity 140, drag 153, coefficient 166, mass 179.
- Features: 8

1. **Launch setup**. Enter launch speed, angle above the ground and launch height. Where: `src/renderer/src/components/PhysicsLabs.tsx:297-302 (calculation 267-286)`.
2. **Gravity setting**. Sets the pull of gravity used for the flight. Where: `src/renderer/src/components/PhysicsLabs.tsx:304`.
3. **Air resistance choice**. Choose no air resistance, quadratic (ordinary air) or linear (slow, viscous). Where: `src/renderer/src/components/PhysicsLabs.tsx:305-314`.
4. **Drag coefficient and mass**. Set the drag strength and the object mass; shown only when air resistance is on. Where: `src/renderer/src/components/PhysicsLabs.tsx:315-320`.
5. **Side-by-side table**. Compares range, peak height, flight time and impact speed with and without air resistance, and the difference. Where: `src/renderer/src/components/PhysicsLabs.tsx:326-356`.
6. **Trajectory drawing**. Draws the path of the object through the air. Where: `src/renderer/src/components/PhysicsLabs.tsx:358-362`.
7. **Best launch angle from this height**. Works out the angle that gives the longest range from the chosen height. Where: `src/renderer/src/components/PhysicsLabs.tsx:364-368`.
8. **Notes on each method**. Says what the exact answer assumes and what the step-by-step calculation did. Where: `src/renderer/src/components/PhysicsLabs.tsx:370-371`.

## 6. Oscillator Lab

- Id: `oscillator-lab`
- Screen file: `src/renderer/src/components/PhysicsLabs.tsx` (line 381)
- Catalogue entry: `src/shared/native/catalogue.ts:818`
- Declared settings: No settings are declared in the catalogue; the four inputs are typed on the screen itself.
- Features: 4

1. **Spring setup**. Enter mass, stiffness, damping and driving force for a mass on a spring. Where: `src/renderer/src/components/PhysicsLabs.tsx:408-414`.
2. **Free motion graph and regime**. Plots the spring over time and says whether it oscillates, is critically damped or creeps back, with the damping ratio. Where: `src/renderer/src/components/PhysicsLabs.tsx:417-436`.
3. **Resonance curve**. Plots how large the swing gets at each driving frequency. Where: `src/renderer/src/components/PhysicsLabs.tsx:438-441`.
4. **Resonance figures**. Shows the peak frequency, natural frequency, quality factor and bandwidth. Where: `src/renderer/src/components/PhysicsLabs.tsx:443-456`.

## 7. Pendulum Lab

- Id: `pendulum-lab`
- Screen file: `src/renderer/src/components/PhysicsLabs.tsx` (line 465)
- Catalogue entry: `src/shared/native/catalogue.ts:830`
- Declared settings: No settings are declared in the catalogue; length, gravity and starting angle are typed on the screen.
- Features: 4

1. **Length, gravity and starting angle**. Set the pendulum length, the gravity, and the angle it is released from. Where: `src/renderer/src/components/PhysicsLabs.tsx:513-518`.
2. **Exact period against the simple formula**. Shows the true period beside the small-angle formula and how far out the formula is. Where: `src/renderer/src/components/PhysicsLabs.tsx:521-534`.
3. **Swing graph**. Plots the angle over time from the full nonlinear equation. Where: `src/renderer/src/components/PhysicsLabs.tsx:536-539`.
4. **Double pendulum pair**. Starts two almost identical double pendulums and plots how far apart they drift. Where: `src/renderer/src/components/PhysicsLabs.tsx:541-560`.

## 8. Collision Lab

- Id: `collision-lab`
- Screen file: `src/renderer/src/components/PhysicsLabs.tsx` (line 567)
- Catalogue entry: `src/shared/native/catalogue.ts:842`
- Declared settings: No settings are declared in the catalogue; masses and velocities are typed on the screen.
- Features: 5

1. **Two-body setup**. Enter the mass and velocity of each body. Where: `src/renderer/src/components/PhysicsLabs.tsx:594-600`.
2. **Bounciness choice**. Choose how bouncy the collision is, from perfectly elastic to sticking together. Where: `src/renderer/src/components/PhysicsLabs.tsx:601-613`.
3. **Speeds after the collision**. Shows each body speed after impact and the speeds at approach and separation. Where: `src/renderer/src/components/PhysicsLabs.tsx:618-625`.
4. **Momentum and energy before and after**. Compares momentum and kinetic energy before and after, with the energy lost and its share. Where: `src/renderer/src/components/PhysicsLabs.tsx:626-655`.
5. **Verdict on what was lost**. States in words whether the collision was elastic and why. Where: `src/renderer/src/components/PhysicsLabs.tsx:656`.

## 9. Orbit Lab

- Id: `orbit-lab`
- Screen file: `src/renderer/src/components/PhysicsLabs.tsx` (line 667)
- Catalogue entry: `src/shared/native/catalogue.ts:854`
- Declared settings: No settings are declared in the catalogue; the four inputs are typed on the screen.
- Features: 5

1. **Orbit setup**. Enter the central mass, gravitational constant, starting distance and sideways speed. Where: `src/renderer/src/components/PhysicsLabs.tsx:701-707`.
2. **Orbit shape and period**. Says whether the orbit is a circle, ellipse, parabola or hyperbola, with eccentricity, energy and period. Where: `src/renderer/src/components/PhysicsLabs.tsx:710-719`.
3. **Closest and furthest approach**. Shows the closest and furthest distance and the circular and escape speeds at that point. Where: `src/renderer/src/components/PhysicsLabs.tsx:720-727`.
4. **Orbit drawing**. Draws the path around the central mass. Where: `src/renderer/src/components/PhysicsLabs.tsx:728-730`.
5. **What decided the shape**. Explains which numbers made the orbit the shape it is. Where: `src/renderer/src/components/PhysicsLabs.tsx:731-734`.

## 10. Rotation Lab

- Id: `rotation-lab`
- Screen file: `src/renderer/src/components/PhysicsLabs.tsx` (line 746)
- Catalogue entry: `src/shared/native/catalogue.ts:866`
- Declared settings: No settings are declared in the catalogue; shape, mass and size are picked or typed on the screen.
- Features: 4

1. **Shape picker**. Choose one of six shapes: solid disc, ring, solid sphere, hollow sphere, rod about its centre, or rod about its end. Where: `src/renderer/src/components/PhysicsLabs.tsx:744 and 784-796`.
2. **Moment of inertia**. Works out how hard the shape is to spin, with its formula and radius of gyration. Where: `src/renderer/src/components/PhysicsLabs.tsx:797-813`.
3. **Rolling down a slope**. Shows the acceleration, how the energy splits between moving and spinning, and the friction needed. Where: `src/renderer/src/components/PhysicsLabs.tsx:815-833`.
4. **Race down a slope**. Ranks four shapes by the time each takes to roll the same distance down the same slope. Where: `src/renderer/src/components/PhysicsLabs.tsx:835-861`.

## 11. Wave Lab

- Id: `wave-lab`
- Screen file: `src/renderer/src/components/PhysicsLabs.tsx` (line 868)
- Catalogue entry: `src/shared/native/catalogue.ts:878`
- Declared settings: No settings are declared in the catalogue; values are typed on the screen.
- Features: 5

1. **Travelling wave snapshot**. Draws a wave at one moment from its speed and frequency. Where: `src/renderer/src/components/PhysicsLabs.tsx:917-930 (inputs 919-923)`.
2. **Standing wave on a string or pipe**. Draws a standing wave with its envelope, plus wavelength, fundamental, nodes and antinodes. Where: `src/renderer/src/components/PhysicsLabs.tsx:932-971`.
3. **Ends choice**. Choose whether the ends are fixed, open or one of each, which decides which harmonics can exist. Where: `src/renderer/src/components/PhysicsLabs.tsx:935-944`.
4. **Harmonic picker**. Choose which harmonic to draw. Where: `src/renderer/src/components/PhysicsLabs.tsx:932-934`.
5. **Two-note beats**. Adds two frequencies and shows the beating and its envelope. Where: `src/renderer/src/components/PhysicsLabs.tsx:973-992`.

## 12. Integrator Lab

- Id: `integrator-lab`
- Screen file: `src/renderer/src/components/PhysicsLabs.tsx` (line 999)
- Catalogue entry: `src/shared/native/catalogue.ts:890`
- Declared settings: No settings are declared in the catalogue; step and run length are typed on the screen.
- Features: 5

1. **Time step and run length**. Set the size of each step and how long to run the spring. Where: `src/renderer/src/components/PhysicsLabs.tsx:1043-1047`.
2. **Four-method comparison**. Compares four ways of stepping forward on the same spring: order, whether they conserve energy, energy drift and distance from the exact answer. Where: `src/renderer/src/components/PhysicsLabs.tsx:1056-1085`.
3. **Largest safe step**. Reports the largest time step that is stable for this spring. Where: `src/renderer/src/components/PhysicsLabs.tsx:1026, 1054`.
4. **Euler against velocity Verlet graph**. Plots two methods on the same spring so the difference is visible. Where: `src/renderer/src/components/PhysicsLabs.tsx:1087-1096`.
5. **Energy drift figures**. Shows how much each method changed the energy, and how many steps it took. Where: `src/renderer/src/components/PhysicsLabs.tsx:1097-1111`.

## 13. Simulation Lab

- Id: `simulation-lab`
- Screen file: `src/renderer/src/components/PageTools.tsx` (line 1052)
- Catalogue entry: `src/shared/native/catalogue.ts:907`
- Declared settings: No settings are declared in the catalogue; the variables, starting values, end time and rates are typed on the screen.
- Features: 8

1. **Variables, start and end time**. Name the changing quantities, their starting values, and how long to run. Where: `src/renderer/src/components/PageTools.tsx:1125-1139`.
2. **Rates of change**. Type how fast each quantity changes, one rule per line. Where: `src/renderer/src/components/PageTools.tsx:1140-1143`.
3. **Calculation method**. Choose adaptive, RK4 or Euler stepping. Where: `src/renderer/src/components/PageTools.tsx:1144-1149`.
4. **Quantity that should not change**. Optionally name a quantity that should stay fixed, and check whether it does. Where: `src/renderer/src/components/PageTools.tsx:1150-1155`.
5. **Result graph**. Plots every variable over time with a legend. Where: `src/renderer/src/components/PageTools.tsx:1159-1166`.
6. **Run summary and disclaimer**. Shows the number of steps and evaluations and states that this describes the model typed, not the world. Where: `src/renderer/src/components/PageTools.tsx:1171-1176`.
7. **Conservation verdict**. Says in words whether the quantity that should not change actually held. Where: `src/renderer/src/components/PageTools.tsx:1178-1181`.
8. **Save this model**. Saves the typed model to the project. Where: `src/renderer/src/components/PageTools.tsx:1186-1205`.
