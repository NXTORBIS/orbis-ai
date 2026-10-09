// Master registry for the Physics Studio. Every topic is wired to a real,
// working computational model — no locked or placeholder entries.
import ProjectileMotion from '../sims/ProjectileMotion.jsx';
import SimplePendulum from '../sims/SimplePendulum.jsx';
import DoublePendulum from '../sims/DoublePendulum.jsx';
import SpringMass from '../sims/SpringMass.jsx';
import Collision from '../sims/Collision.jsx';
import KinematicsSim from '../sims/KinematicsSim.jsx';
import NewtonsLaws from '../sims/NewtonsLaws.jsx';
import FrictionIncline from '../sims/FrictionIncline.jsx';
import CircularMotion from '../sims/CircularMotion.jsx';
import WorkEnergy from '../sims/WorkEnergy.jsx';
import SpringMassSystem from '../sims/SpringMassSystem.jsx';
import SHMSim from '../sims/SHMSim.jsx';
import DampedOscillations from '../sims/DampedOscillations.jsx';
import ResonanceSim from '../sims/ResonanceSim.jsx';
import RotationalMotion from '../sims/RotationalMotion.jsx';
import ElectricField from '../sims/ElectricField.jsx';
import WaveString from '../sims/WaveString.jsx';
import IdealGas from '../sims/IdealGas.jsx';
import ParticleInBox from '../sims/ParticleInBox.jsx';
import NBody from '../sims/NBody.jsx';
import RadioactiveDecay from '../sims/RadioactiveDecay.jsx';
import QubitLab from '../sims/QubitLab.jsx';
import QuantumCircuits from '../sims/QuantumCircuits.jsx';
import QuantumAlgorithms from '../sims/QuantumAlgorithms.jsx';
import Schrodinger from '../sims/Schrodinger.jsx';
import CompPhysics from '../sims/CompPhysics.jsx';
import IsingModel from '../sims/IsingModel.jsx';
import DoubleSlit from '../sims/DoubleSlit.jsx';
import CarnotEngine from '../sims/CarnotEngine.jsx';
// Part C — research layer
import ConstantsLab from '../sims/ConstantsLab.jsx';
import DimensionalLab from '../sims/DimensionalLab.jsx';
import UncertaintyLab from '../sims/UncertaintyLab.jsx';
import NumericsLab from '../sims/NumericsLab.jsx';
import DataLab from '../sims/DataLab.jsx';
import MolecularDynamics from '../sims/MolecularDynamics.jsx';
import PlasmaLab from '../sims/PlasmaLab.jsx';
import CfdLab from '../sims/CfdLab.jsx';
import GravityRelativity from '../sims/GravityRelativity.jsx';
import GravitationalWaves from '../sims/GravitationalWaves.jsx';
import AstrophysicsLab from '../sims/AstrophysicsLab.jsx';
import ParticlePhysics from '../sims/ParticlePhysics.jsx';
import FeynmanLab from '../sims/FeynmanLab.jsx';
import LatticeLab from '../sims/LatticeLab.jsx';
import PhaseTransitionLab from '../sims/PhaseTransitionLab.jsx';
import QuantumInfoLab from '../sims/QuantumInfoLab.jsx';
import QuantumManyBodyResearch from '../sims/QuantumManyBodyResearch.jsx';
import VirtualExperiments from '../sims/VirtualExperiments.jsx';
import ResearchNotebook from '../sims/ResearchNotebook.jsx';
import ExperimentComparison from '../sims/ExperimentComparison.jsx';
// New labs covering the remaining suite topics
import CircuitsLab from '../sims/CircuitsLab.jsx';
import OpticsLab from '../sims/OpticsLab.jsx';
import NuclearLab from '../sims/NuclearLab.jsx';
import CondensedMatterLab from '../sims/CondensedMatterLab.jsx';
import StellarLab from '../sims/StellarLab.jsx';
import CosmoLab from '../sims/CosmoLab.jsx';
// Virtual Experimental Physics Lab — 17 unique engines (one per topic, zero sharing)
import VLPendulumSim from '../sims/VLPendulumSim.jsx';
import VLProjectileSim from '../sims/VLProjectileSim.jsx';
import VLNewtonSim from '../sims/VLNewtonSim.jsx';
import VLMomentumSim from '../sims/VLMomentumSim.jsx';
import VLEnergySim from '../sims/VLEnergySim.jsx';
import VLSHMSim from '../sims/VLSHMSim.jsx';
import VLYoungModulusSim from '../sims/VLYoungModulusSim.jsx';
import VLOhmsLawSim from '../sims/VLOhmsLawSim.jsx';
import VLKirchhoffSim from '../sims/VLKirchhoffSim.jsx';
import VLWheatstoneSim from '../sims/VLWheatstoneSim.jsx';
import VLMeterBridgeSim from '../sims/VLMeterBridgeSim.jsx';
import VLConvexLensSim from '../sims/VLConvexLensSim.jsx';
import VLConcaveMirrorSim from '../sims/VLConcaveMirrorSim.jsx';
import VLPrismSim from '../sims/VLPrismSim.jsx';
import VLResonanceTubeSim from '../sims/VLResonanceTubeSim.jsx';
import VLRCcircuitSim from '../sims/VLRCcircuitSim.jsx';
import VLEMImsim from '../sims/VLEMImsim.jsx';
// Astrophysics — 20 unique engines (one per topic, zero sharing)
import SolarSystemSim from '../sims/SolarSystemSim.jsx';
import OrbitalMechanicsSim from '../sims/OrbitalMechanicsSim.jsx';
import KeplersLawsSim from '../sims/KeplersLawsSim.jsx';
import NBodyGravitySim from '../sims/NBodyGravitySim.jsx';
import ThreeBodyProblemSim from '../sims/ThreeBodyProblemSim.jsx';
import BinaryStarsSim from '../sims/BinaryStarsSim.jsx';
import PlanetaryOrbitsSim from '../sims/PlanetaryOrbitsSim.jsx';
import StellarEvolutionSim from '../sims/StellarEvolutionSim.jsx';
import HertzsprungRussellSim from '../sims/HertzsprungRussellSim.jsx';
import BlackHoleSim from '../sims/BlackHoleSim.jsx';
import GravitationalLensingSim from '../sims/GravitationalLensingSim.jsx';
import NeutronStarsSim from '../sims/NeutronStarsSim.jsx';
import PulsarsSim from '../sims/PulsarsSim.jsx';
import ExoplanetTransitSim from '../sims/ExoplanetTransitSim.jsx';
import RadialVelocitySim from '../sims/RadialVelocitySim.jsx';
import GravitationalWavesSim from '../sims/GravitationalWavesSim.jsx';
import CosmicExpansionSim from '../sims/CosmicExpansionSim.jsx';
import RedshiftSim from '../sims/RedshiftSim.jsx';
import DarkMatterCurvesSim from '../sims/DarkMatterCurvesSim.jsx';
import GravitationalTimeDilationSim from '../sims/GravitationalTimeDilationSim.jsx';
import ElectricPotential from '../sims/ElectricPotential.jsx';
import PointCharges from '../sims/PointCharges.jsx';
import ElectricDipole from '../sims/ElectricDipole.jsx';
import MultichargeSystem from '../sims/MultichargeSystem.jsx';
import GaussLaw from '../sims/GaussLaw.jsx';
import CapacitorSim from '../sims/CapacitorSim.jsx';
import KirchhoffLaw from '../sims/KirchhoffLaw.jsx';
import InductionSim from '../sims/InductionSim.jsx';
import FaradayLaw from '../sims/FaradayLaw.jsx';
import LenzLaw from '../sims/LenzLaw.jsx';
import TransformerSim from '../sims/TransformerSim.jsx';
import MagneticField from '../sims/MagneticField.jsx';
import BiotSavart from '../sims/BiotSavart.jsx';
import ChargedMotion from '../sims/ChargedMotion.jsx';
import EMWaves from '../sims/EMWaves.jsx';
import TransverseLongitudinal from '../sims/TransverseLongitudinal.jsx';
import WaveSuperposition from '../sims/WaveSuperposition.jsx';
import StandingWaves from '../sims/StandingWaves.jsx';
import BeatsSim from '../sims/BeatsSim.jsx';
import DopplerEffect from '../sims/DopplerEffect.jsx';
import SoundWaves from '../sims/SoundWaves.jsx';
import WaveInterference from '../sims/WaveInterference.jsx';
import ReflectionSim from '../sims/ReflectionSim.jsx';
import RefractionSim from '../sims/RefractionSim.jsx';
import SnellLaw from '../sims/SnellLaw.jsx';
import LensSim from '../sims/LensSim.jsx';
import MirrorSim from '../sims/MirrorSim.jsx';
import LensCombo from '../sims/LensCombo.jsx';
import SingleSlit from '../sims/SingleSlit.jsx';
import DiffractionGrating from '../sims/DiffractionGrating.jsx';
import PolarizationSim from '../sims/PolarizationSim.jsx';
import MichelsonSim from '../sims/MichelsonSim.jsx';
import BoylesLaw from '../sims/BoylesLaw.jsx';
import CharlesLaw from '../sims/CharlesLaw.jsx';
import IdealGasLaw from '../sims/IdealGasLaw.jsx';
import MaxwellBoltzmann from '../sims/MaxwellBoltzmann.jsx';
import HeatTransfer from '../sims/HeatTransfer.jsx';
import ThermalExpansion from '../sims/ThermalExpansion.jsx';
import HeatEngine from '../sims/HeatEngine.jsx';
import Refrigerator from '../sims/Refrigerator.jsx';
import EntropySim from '../sims/EntropySim.jsx';
import RandomWalk from '../sims/RandomWalk.jsx';
import BrownianMotion from '../sims/BrownianMotion.jsx';
import MonteCarloPhysics from '../sims/MonteCarloPhysics.jsx';
import PartitionFunction from '../sims/PartitionFunction.jsx';
import InfiniteWell from '../sims/InfiniteWell.jsx';
import FiniteWell from '../sims/FiniteWell.jsx';
import QuantumTunneling from '../sims/QuantumTunneling.jsx';
import PotentialBarrier from '../sims/PotentialBarrier.jsx';
import StepPotential from '../sims/StepPotential.jsx';
import QuantumHO from '../sims/QuantumHO.jsx';
import FreeParticle from '../sims/FreeParticle.jsx';
import DoubleWell from '../sims/DoubleWell.jsx';
import HydrogenAtom from '../sims/HydrogenAtom.jsx';
import WavefunctionViz from '../sims/WavefunctionViz.jsx';
import ProbabilityDensity from '../sims/ProbabilityDensity.jsx';
import QuantumSuperposition from '../sims/QuantumSuperposition.jsx';
import QuantumMeasurement from '../sims/QuantumMeasurement.jsx';
import EnergyEigenvalues from '../sims/EnergyEigenvalues.jsx';
import QuantumGates from '../sims/QuantumGates.jsx';
import MultiQubitSim from '../sims/MultiQubitSim.jsx';
import CnotCzSwap from '../sims/CnotCzSwap.jsx';
import EntanglementLab from '../sims/EntanglementLab.jsx';
import SuperdenseCoding from '../sims/SuperdenseCoding.jsx';
import DeutschAlgorithm from '../sims/DeutschAlgorithm.jsx';
import DeutschJozsa from '../sims/DeutschJozsa.jsx';
import BernsteinVazirani from '../sims/BernsteinVazirani.jsx';
import GroversAlgorithm from '../sims/GroversAlgorithm.jsx';
import QuantumFourierTransform from '../sims/QuantumFourierTransform.jsx';
import QuantumPhaseEstimation from '../sims/QuantumPhaseEstimation.jsx';
import ShorsAlgorithm from '../sims/ShorsAlgorithm.jsx';
import VonNeumannEntropy from '../sims/VonNeumannEntropy.jsx';
import QuantumFidelity from '../sims/QuantumFidelity.jsx';
import BellStateAnalysis from '../sims/BellStateAnalysis.jsx';
import QuantumTomography from '../sims/QuantumTomography.jsx';
// Computational Physics — 17 unique engines (one per topic, zero sharing)
import NumericalIntegrationSim from '../sims/NumericalIntegrationSim.jsx';
import NumericalDifferentiationSim from '../sims/NumericalDifferentiationSim.jsx';
import RootFindingSim from '../sims/RootFindingSim.jsx';
import ODESolverSim from '../sims/ODESolverSim.jsx';
import PDESolverSim from '../sims/PDESolverSim.jsx';
import EigenvalueSolverSim from '../sims/EigenvalueSolverSim.jsx';
import MatrixLabSim from '../sims/MatrixLabSim.jsx';
import FourierTransformSim from '../sims/FourierTransformSim.jsx';
import FFTSim from '../sims/FFTSim.jsx';
import MonteCarloMethodsSim from '../sims/MonteCarloMethodsSim.jsx';
import FiniteDifferenceSim from '../sims/FiniteDifferenceSim.jsx';
import FiniteElementSim from '../sims/FiniteElementSim.jsx';
import NumericalLinearAlgebraSim from '../sims/NumericalLinearAlgebraSim.jsx';
import ErrorConvergenceSim from '../sims/ErrorConvergenceSim.jsx';
import DiffEqVisualizerSim from '../sims/DiffEqVisualizerSim.jsx';
import CellularAutomataSim from '../sims/CellularAutomataSim.jsx';
import NumericalOptimizationSim from '../sims/NumericalOptimizationSim.jsx';
// Nuclear & Particle Physics — 14 unique engines (one per topic, zero sharing)
import RadioactiveDecaySim from '../sims/RadioactiveDecaySim.jsx';
import HalfLifeSim from '../sims/HalfLifeSim.jsx';
import DecayChainsSim from '../sims/DecayChainsSim.jsx';
import AlphaBetaGammaSim from '../sims/AlphaBetaGammaSim.jsx';
import NuclearBindingEnergySim from '../sims/NuclearBindingEnergySim.jsx';
import FissionSim from '../sims/FissionSim.jsx';
import FusionSim from '../sims/FusionSim.jsx';
import NuclearReactionsSim from '../sims/NuclearReactionsSim.jsx';
import ParticleCollisionSim from '../sims/ParticleCollisionSim.jsx';
import ParticleDetectorSim from '../sims/ParticleDetectorSim.jsx';
import StandardModelSim from '../sims/StandardModelSim.jsx';
import ParticlePropertiesSim from '../sims/ParticlePropertiesSim.jsx';
import InteractionAnalyserSim from '../sims/InteractionAnalyserSim.jsx';
import FeynmanDiagramSim from '../sims/FeynmanDiagramSim.jsx';
// Fluid & Continuum Physics — 14 unique engines (one per topic, zero sharing)
import FluidFlowSim from '../sims/FluidFlowSim.jsx';
import FluidPressureSim from '../sims/FluidPressureSim.jsx';
import BuoyancySim from '../sims/BuoyancySim.jsx';
import BernoulliSim from '../sims/BernoulliSim.jsx';
import ViscositySim from '../sims/ViscositySim.jsx';
import LaminarFlowSim from '../sims/LaminarFlowSim.jsx';
import TurbulentFlowSim from '../sims/TurbulentFlowSim.jsx';
import ReynoldsNumberSim from '../sims/ReynoldsNumberSim.jsx';
import PipeFlowSim from '../sims/PipeFlowSim.jsx';
import DragSim from '../sims/DragSim.jsx';
import AtmosphericPressureSim from '../sims/AtmosphericPressureSim.jsx';
import WavePropagationSim from '../sims/WavePropagationSim.jsx';
import ShockWavesSim from '../sims/ShockWavesSim.jsx';
import NavierStokesVizSim from '../sims/NavierStokesVizSim.jsx';
// Condensed Matter & Materials — 18 unique engines (one per topic, zero sharing)
import CrystalStructureSim from '../sims/CrystalStructureSim.jsx';
import UnitCellSim from '../sims/UnitCellSim.jsx';
import BravaisLatticesSim from '../sims/BravaisLatticesSim.jsx';
import ReciprocalLatticeSim from '../sims/ReciprocalLatticeSim.jsx';
import BandStructureSim from '../sims/BandStructureSim.jsx';
import DensityOfStatesSim from '../sims/DensityOfStatesSim.jsx';
import SemiconductorSim from '../sims/SemiconductorSim.jsx';
import PNJunctionSim from '../sims/PNJunctionSim.jsx';
import DiodeIVSim from '../sims/DiodeIVSim.jsx';
import HallEffectSim from '../sims/HallEffectSim.jsx';
import FerromagnetismSim from '../sims/FerromagnetismSim.jsx';
import AntiferromagnetismSim from '../sims/AntiferromagnetismSim.jsx';
import IsingModelSim from '../sims/IsingModelSim.jsx';
import HeisenbergModelSim from '../sims/HeisenbergModelSim.jsx';
import XYModelSim from '../sims/XYModelSim.jsx';
import SuperconductivitySim from '../sims/SuperconductivitySim.jsx';
import PhaseTransitionsSim from '../sims/PhaseTransitionsSim.jsx';
import TopologicalMaterialsSim from '../sims/TopologicalMaterialsSim.jsx';

import QECLab from '../QECLab.jsx';
import QuantumSimulator from '../QuantumSimulator.jsx';

const L = 'live';
const t = (id, name, component, to, desc) => ({ id, name, status: L, component, to, desc });

export const SECTIONS = [
  {
    id: 'classical', name: 'Classical Mechanics', accent: '#22d3ee',
    topics: [
      t('kinematics', 'Kinematics (1D/2D Motion)', KinematicsSim, null, 'Position, velocity, acceleration vs time; 1D & 2D trajectories'),
      t('projectile', 'Projectile Motion', ProjectileMotion, null, 'Launch angle, speed, gravity, trajectory & range'),
      t('newton', "Newton's Laws", NewtonsLaws, null, 'F=ma, applied force, friction, net force & equilibrium'),
      t('friction', 'Friction & Inclined Planes', FrictionIncline, null, 'Incline angle, normal force, static & kinetic friction, gravity decomposition'),
      t('circular', 'Circular Motion', CircularMotion, null, 'Centripetal force, angular velocity, period, tangential & radial vectors'),
      t('collision', 'Collision Simulator', Collision, null, 'Elastic/inelastic, momentum & energy'),
      t('workenergy', 'Work & Energy', WorkEnergy, null, 'KE/PE bars, work-energy theorem, power, conservation'),
      t('spring', 'Spring–Mass System', SpringMassSystem, null, 'Hooke’s law, spring constant, amplitude, period, energy oscillation'),
      t('pendulum', 'Simple Pendulum', SimplePendulum, null, 'Nonlinear pendulum, period, phase'),
      t('shm', 'SHM Simulator', SHMSim, null, 'Displacement, velocity, acceleration curves & phase circle'),
      t('damped', 'Damped Oscillations', DampedOscillations, null, 'Under/critical/over-damped regimes, decay envelope, Q factor'),
      t('resonance', 'Resonance', ResonanceSim, null, 'Driven oscillator, frequency response curve, phase shift, resonance peak'),
      t('rotational', 'Rotational Motion', RotationalMotion, null, 'Torque, angular acceleration, moment of inertia, angular momentum'),
      t('double', 'Double Pendulum', DoublePendulum, null, 'Chaotic motion, phase space'),
    ],
  },
  {
    id: 'em', name: 'Electromagnetism', accent: '#f97316',
    topics: [
      t('efield', 'Electric Field', ElectricField, null, 'Movable point charges, live field vectors'),
      t('epotential', 'Electric Potential', ElectricPotential, null, 'Scalar potential heatmap, equipotential contours, V probe'),
      t('pointcharges', 'Point Charges', PointCharges, null, 'Single-charge Coulomb field, 1/r² falloff plot'),
      t('dipole', 'Electric Dipole', ElectricDipole, null, 'Dipole field lines, p = qd, far-field 1/r³'),
      t('multicharge', 'Multiple Charge Systems', MultichargeSystem, null, 'Field-line tracing, null points, vector superposition'),
      t('gauss', "Gauss's Law", GaussLaw, null, 'Gaussian surface, enclosed charge, flux = Q/ε₀'),
      t('capacitors', 'Capacitors', CapacitorSim, null, 'RC charging/discharging, Q(t), V(t), energy'),
      t('rc', 'RC / RL / RLC Circuits', CircuitsLab, null, 'Transient & AC response (RK4)'),
      t('kirchhoff', "Kirchhoff's Laws", KirchhoffLaw, null, 'Two-loop KVL solver, branch currents'),
      t('bfield', 'Magnetic Fields', MagneticField, null, 'Bar magnet, current loop, straight wire field lines'),
      t('biotsavart', 'Biot–Savart Law', BiotSavart, null, 'Numerical dB integration, straight/loop/square wire'),
      t('lorentz', 'Lorentz Force', PlasmaLab, null, 'q(v×B) on charges — Plasma Lab'),
      t('chargedmotion', 'Charged Particle Motion', ChargedMotion, null, 'Cyclotron, E×B drift, magnetic mirror'),
      t('induction', 'Electromagnetic Induction', InductionSim, null, 'Magnet through coil, EMF = −N dΦ/dt'),
      t('faraday', "Faraday's Law", FaradayLaw, null, 'Rotating loop, Φ(t) and EMF = −N dΦ/dt'),
      t('lenz', "Lenz's Law", LenzLaw, null, 'Induced current direction, energy conservation'),
      t('transformer', 'Transformers', TransformerSim, null, 'Mutual induction, Vs/Vp = Ns/Np, AC drive'),
      t('emwaves', 'Electromagnetic Waves', EMWaves, null, 'Oscillating E & B fields, polarization, spectrum'),
    ],
  },
  {
    id: 'waves', name: 'Waves & Optics', accent: '#a855f7',
    topics: [
      t('string', 'Wave on a String', WaveString, null, 'FDTD wave equation, real propagation'),
      t('translong', 'Transverse / Longitudinal Waves', TransverseLongitudinal, null, 'Transverse vs longitudinal oscillation, particle density'),
      t('superposition', 'Superposition', WaveSuperposition, null, 'Two travelling waves adding point-by-point, constructive/destructive'),
      t('interference', 'Interference', WaveInterference, null, 'Two-source circular wave 2D pattern, path difference'),
      t('standing', 'Standing Waves', StandingWaves, null, 'Harmonics, nodes & antinodes on bounded string'),
      t('beats', 'Beats', BeatsSim, null, 'Two close frequencies, beat envelope, f_beat = |f1−f2|'),
      t('doppler', 'Doppler Effect', DopplerEffect, null, 'Moving source, wavefront compression/expansion, f′ = fc/(c−v)'),
      t('sound', 'Sound Waves', SoundWaves, null, 'Longitudinal pressure wave, speed in media, dB scale'),
      t('reflection', 'Reflection', ReflectionSim, null, 'Law of reflection, specular vs diffuse, angle from normal'),
      t('refraction', 'Refraction', RefractionSim, null, 'Ray bending at interface, n₁sinθ₁ = n₂sinθ₂, TIR'),
      t('snell', "Snell's Law", SnellLaw, null, 'sinθ₁ vs sinθ₂ plot, slope = n₁/n₂, critical angle'),
      t('lenses', 'Convex / Concave Lenses', LensSim, null, 'Thin-lens ray tracing, 1/f = 1/d_o + 1/d_i, real/virtual image'),
      t('mirrors', 'Mirrors', MirrorSim, null, 'Concave/convex mirror, f = R/2, ray tracing, image formation'),
      t('lenscombo', 'Lens Combinations', LensCombo, null, 'Two-lens system, M = M₁×M₂, telescope/microscope'),
      t('doubleslit', 'Double-Slit Experiment', DoubleSlit, null, 'Real Fraunhofer interference'),
      t('singleslit', 'Single-Slit Diffraction', SingleSlit, null, 'sinc² pattern, minima at a sinθ = mλ, central width'),
      t('grating', 'Diffraction Grating', DiffractionGrating, null, 'N-slit sharp peaks, d sinθ = mλ, width ∝ 1/N'),
      t('polarization', 'Polarization', PolarizationSim, null, "Malus's law I = I₁cos²θ, crossed polarizers"),
      t('michelson', 'Michelson Interferometer', MichelsonSim, null, 'Two-arm beam splitter, Δm = 2ΔL/λ fringe shifts'),
    ],
  },
  {
    id: 'thermo', name: 'Thermodynamics & Statistical Physics', accent: '#84cc16',
    topics: [
      t('idealgas', 'Ideal Gas Simulator', IdealGas, null, 'Particles, pressure, temperature'),
      t('boyle', "Boyle's Law", BoylesLaw, null, 'PV at constant T — isothermal piston compression'),
      t('charles', "Charles's Law", CharlesLaw, null, 'V vs T at constant P — isobaric expansion'),
      t('idealgaslaw', 'Ideal Gas Law', IdealGasLaw, null, 'PV = NkT — state-space diagram with isotherm family'),
      t('mb', 'Maxwell–Boltzmann Distribution', MaxwellBoltzmann, null, 'Speed distribution with v_p, ⟨v⟩, v_rms markers'),
      t('heat', 'Heat Transfer', HeatTransfer, null, 'Conduction + radiation, T(t) convergence to equilibrium'),
      t('expansion', 'Thermal Expansion', ThermalExpansion, null, 'Linear expansion ΔL = α L₀ ΔT with rod visualisation'),
      t('carnot', 'Carnot Engine', CarnotEngine, null, 'P–V cycle, maximum efficiency'),
      t('heatengine', 'Heat Engine', HeatEngine, null, 'Q_h → W + Q_c Sankey flow, η below Carnot limit'),
      t('fridge', 'Refrigerator / Heat Pump', Refrigerator, null, 'Reverse cycle, COP = Q_c/W or Q_h/W'),
      t('entropy', 'Entropy Simulator', EntropySim, null, 'Two-gas mixing, S = −Σ p ln p rising to equilibrium'),
      t('randomwalk', 'Random Walk', RandomWalk, null, '2D walkers, ⟨r²⟩ ∝ t diffusion law'),
      t('brownian', 'Brownian Motion', BrownianMotion, null, 'Tracer bombarded by fluid, MSD ∝ t'),
      t('mc', 'Monte Carlo Physics', MonteCarloPhysics, null, 'π estimation and ∫sin(x)dx via random sampling'),
      t('ising', 'Ising Model', LatticeLab, null, '2D lattice, phase transition at Tc'),
      t('partition', 'Partition Function', PartitionFunction, null, 'Two-level system Z, F, U, S vs T'),
    ],
  },
  {
    id: 'quantum', name: 'Quantum Mechanics', accent: '#06b6d4',
    topics: [
      t('pib', 'Particle in a Box', ParticleInBox, null, 'Eigenstates, superposition, time evolution'),
      t('infwell', 'Infinite Potential Well', InfiniteWell, null, 'Energy level ladder with n² scaling, eigenstate viewer'),
      t('finwell', 'Finite Potential Well', FiniteWell, null, 'Transcendental bound-state solver, wavefunction leakage into walls'),
      t('tunneling', 'Quantum Tunneling', QuantumTunneling, null, 'Wave packet through barrier, T(E) vs analytical formula'),
      t('barrier', 'Potential Barrier', PotentialBarrier, null, 'T(E) curve: tunneling below V₀, resonances above'),
      t('step', 'Step Potential', StepPotential, null, 'E > V₀ partial reflection, E < V₀ evanescent decay'),
      t('qho', 'Quantum Harmonic Oscillator', QuantumHO, null, 'Hermite–Gaussian eigenfunctions, evenly-spaced levels, ZPE'),
      t('freeparticle', 'Free Particle', FreeParticle, null, 'Gaussian packet dispersion, group velocity, σ(t) spreading'),
      t('doublewell', 'Double-Well Potential', DoubleWell, null, 'Symmetric/antisymmetric pairs, tunneling splitting'),
      t('hydrogen', 'Hydrogen Atom', HydrogenAtom, null, 'Coulomb Eₙ=−13.6/n², radial Rₙₗ, Balmer series'),
      t('schrodinger', 'Schrödinger Equation Solver', Schrodinger, null, 'Split-step Fourier, time evolution'),
      t('wavefn', 'Wavefunction Visualizer', WavefunctionViz, null, 'Re/Im/|ψ|² + phase colour wheel'),
      t('probdens', 'Probability Density', ProbabilityDensity, null, '|ψ(x,t)|² heatmap with peak tracking'),
      t('quantum-superposition', 'Quantum Superposition', QuantumSuperposition, null, 'Two colliding wave packets, interference fringes'),
      t('measurement', 'Quantum Measurement', QuantumMeasurement, null, 'Born rule histogram, collapse & statistics'),
      t('eigen', 'Energy Eigenvalues', EnergyEigenvalues, null, 'Discrete vs continuous spectra comparison'),
      t('qmb', 'Quantum Many-Body Simulator', QuantumSimulator, null, 'Heisenberg spin-chain exact diagonalisation'),
      t('qec', 'Quantum Error Correction', QECLab, null, 'Stabilizer codes & decoders'),
      t('ft', 'Fault-Tolerant Decoding', QECLab, null, 'Syndrome decoding under noise'),
    ],
  },
  {
    id: 'qinfo', name: 'Quantum Information', accent: '#22d3ee',
    topics: [
      t('qubit', 'Qubit Laboratory (Bloch Sphere)', QubitLab, null, 'Single-qubit gates, SU(2), Bloch vector'),
      t('multiqubit', 'Multi-Qubit Simulator', MultiQubitSim, null, 'Tensor-product states, entanglement entropy of subsystems'),
      t('gates', 'Quantum Gates', QuantumGates, null, 'X, Y, Z, H, S, T gate matrices, rotation axes, Bloch sphere'),
      t('cnot', 'CNOT / CZ / SWAP', CnotCzSwap, null, 'Truth tables, control–target structure, entangling power'),
      t('circuits', 'Quantum Circuit Builder', QuantumCircuits, null, 'Add/move/run/step/measure circuits'),
      t('teleport', 'Quantum Teleportation', QuantumAlgorithms, null, 'Real 3-qubit protocol'),
      t('superdense', 'Superdense Coding', SuperdenseCoding, null, '2 bits via 1 qubit — Bell-state encoding/decoding'),
      t('deutsch', 'Deutsch Algorithm', DeutschAlgorithm, null, 'Constant vs balanced, single query, interference'),
      t('dj', 'Deutsch–Jozsa', DeutschJozsa, null, 'n=2 inputs, constant vs balanced in one query'),
      t('bv', 'Bernstein–Vazirani', BernsteinVazirani, null, 'Find hidden string s in one query'),
      t('grover', "Grover's Algorithm", GroversAlgorithm, null, '√N search, amplitude amplification iteration-by-iteration'),
      t('qft', 'Quantum Fourier Transform', QuantumFourierTransform, null, 'Real QFT on 3 qubits, phases carry the information'),
      t('qpe', 'Quantum Phase Estimation', QuantumPhaseEstimation, null, 'Estimate eigenphase θ via counting qubits + inverse QFT'),
      t('shor', "Shor's Algorithm (N=15)", ShorsAlgorithm, null, 'Order-finding → factor 15 = 3·5'),
      t('entangle', 'Entanglement', EntanglementLab, null, 'Build a Bell state, correlation analysis'),
      t('density', 'Density Matrices & Channels', QuantumInfoLab, null, 'ρ, Kraus ops, purity, channels'),
      t('vonNeumann', 'Von Neumann Entropy', VonNeumannEntropy, null, 'S = −Tr(ρ log ρ), mixedness & entanglement entropy'),
      t('fidelity', 'Quantum Fidelity & Trace Distance', QuantumFidelity, null, 'F(ρ,σ), D(ρ,σ), operational meanings'),
      t('bell', 'Bell-State Analysis', BellStateAnalysis, null, 'Four Bell states, amplitudes, correlations'),
      t('tomo', 'Quantum Tomography', QuantumTomography, null, 'Reconstruct ρ from ⟨X⟩⟨Y⟩⟨Z⟩, exponential cost'),
    ],
  },
  {
    id: 'comp', name: 'Computational Physics', accent: '#3b82f6',
    topics: [
      t('numint', 'Numerical Integration', NumericalIntegrationSim, null, 'Trapezoid, Simpson, Gauss–Legendre convergence vs exact'),
      t('numdiff', 'Numerical Differentiation', NumericalDifferentiationSim, null, 'Forward/central differences, truncation vs round-off trade-off'),
      t('rootfind', 'Root Finding', RootFindingSim, null, 'Newton (quadratic), bisection (linear), secant (superlinear) convergence'),
      t('ode', 'ODE Solver', ODESolverSim, null, 'Euler, RK2, RK4, adaptive RK45 — accuracy vs cost comparison'),
      t('pde', 'PDE Solver', PDESolverSim, null, '1D heat equation FTCS, CFL stability, animated diffusion'),
      t('eig', 'Eigenvalue Solver', EigenvalueSolverSim, null, 'Jacobi (full spectrum) vs power iteration (dominant λ) convergence'),
      t('matrix', 'Matrix Laboratory', MatrixLabSim, null, 'LU decomposition, determinant, solve Ax=b, residual analysis'),
      t('fourier', 'Fourier Transform', FourierTransformSim, null, 'DFT of pulse/sine signals, frequency spectrum, Nyquist'),
      t('fft', 'FFT', FFTSim, null, 'Radix-2 Cooley–Tukey O(N log N) vs O(N²) DFT, timing & speedup'),
      t('mcmc', 'Monte Carlo Methods', MonteCarloMethodsSim, null, 'Metropolis sampling, π estimation, 1/√N convergence'),
      t('fdm', 'Finite Difference Method', FiniteDifferenceSim, null, '1D wave equation leapfrog, CFL condition, string vibration'),
      t('fem', 'Finite Element Method', FiniteElementSim, null, '1D Poisson −u″=f, hat basis, Galerkin weak form, O(h²) convergence'),
      t('numlinalg', 'Numerical Linear Algebra', NumericalLinearAlgebraSim, null, 'LU, QR (Gram-Schmidt), condition number κ, digits lost'),
      t('erranalysis', 'Error & Convergence Analysis', ErrorConvergenceSim, null, 'Truncation vs round-off, convergence rates, Kahan summation'),
      t('deviz', 'Differential Equation Visualizer', DiffEqVisualizerSim, null, 'Phase portrait, vector field, RK4 trajectory, time series'),
      t('ca', 'Cellular Automata', CellularAutomataSim, null, '1D elementary rules (30/90/110), 2D Game of Life, emergence'),
      t('optim', 'Numerical Optimisation', NumericalOptimizationSim, null, 'Gradient descent, momentum, Newton on Rosenbrock & quadratics'),
    ],
  },
  {
    id: 'astro', name: 'Astrophysics & Space Physics', accent: '#8b5cf6',
    topics: [
      t('solar', 'Solar System Simulator', SolarSystemSim, null, 'Sun + planets, real gravity'),
      t('orbital', 'Orbital Mechanics', OrbitalMechanicsSim, null, 'Two-body & N-body orbits'),
      t('kepler', "Kepler's Laws", KeplersLawsSim, null, 'Elliptical orbits, T²∝a³'),
      t('nbody', 'N-Body Gravity', NBodyGravitySim, null, 'Velocity-Verlet integrator'),
      t('threebody', 'Three-Body Problem', ThreeBodyProblemSim, null, 'Figure-8 & chaotic solutions'),
      t('binary', 'Binary Stars', BinaryStarsSim, null, 'Two-body orbit preset'),
      t('planets', 'Planetary Orbits', PlanetaryOrbitsSim, null, 'Stable Keplerian orbits'),
      t('stellar', 'Stellar Evolution', StellarEvolutionSim, null, 'HR track of a star'),
      t('hr', 'Hertzsprung–Russell Diagram', HertzsprungRussellSim, null, 'Luminosity vs temperature'),
      t('blackhole', 'Black Hole Simulator', BlackHoleSim, null, 'Schwarzschild geodesics'),
      t('lensing', 'Gravitational Lensing', GravitationalLensingSim, null, 'Light deflection'),
      t('neutron', 'Neutron Stars', NeutronStarsSim, null, 'Compact objects'),
      t('pulsar', 'Pulsars', PulsarsSim, null, 'Rotating beams & spin-down'),
      t('exoplanet', 'Exoplanet Transit', ExoplanetTransitSim, null, 'Light-curve dip'),
      t('rv', 'Radial Velocity Simulator', RadialVelocitySim, null, 'Stellar wobble curve'),
      t('gw', 'Gravitational Waves', GravitationalWavesSim, null, 'Chirp waveform h(t), f(t), spectrogram'),
      t('cosmic-expansion', 'Cosmic Expansion', CosmicExpansionSim, null, 'Hubble flow'),
      t('redshift', 'Redshift', RedshiftSim, null, 'z from recession'),
      t('darkmatter', 'Dark Matter Rotation Curves', DarkMatterCurvesSim, null, 'Flat galactic curves'),
      t('timedilation', 'Gravitational Time Dilation', GravitationalTimeDilationSim, null, 'Clocks in gravity wells'),
    ],
  },
  {
    id: 'nuclear', name: 'Nuclear & Particle Physics', accent: '#ef4444',
    topics: [
      t('decay', 'Radioactive Decay', RadioactiveDecaySim, null, 'Monte Carlo, half-life'),
      t('halflife', 'Half-Life Simulator', HalfLifeSim, null, 'Exponential decay'),
      t('chain', 'Decay Chains', DecayChainsSim, null, 'Sequential decays — Bateman equations'),
      t('alphabeta', 'Alpha / Beta / Gamma Decay', AlphaBetaGammaSim, null, 'Disintegration modes & Q-values'),
      t('binding', 'Nuclear Binding Energy', NuclearBindingEnergySim, null, 'Semi-empirical mass formula curve'),
      t('fission', 'Fission', FissionSim, null, 'Chain reaction & Q-value'),
      t('fusion', 'Fusion', FusionSim, null, 'Light-nuclei merging & Q-value'),
      t('nucrxn', 'Nuclear Reactions', NuclearReactionsSim, null, 'Q-value, cross-section'),
      t('collider', 'Particle Collision Simulator', ParticleCollisionSim, null, 'Centre-of-mass kinematics'),
      t('detector', 'Particle Detector', ParticleDetectorSim, null, 'Track reconstruction'),
      t('sm', 'Standard Model Explorer', StandardModelSim, null, 'Fermions & bosons with quantum numbers'),
      t('pprops', 'Particle Properties', ParticlePropertiesSim, null, 'Mass, spin, charge, color, generation'),
      t('interactions', 'Interaction Analyser', InteractionAnalyserSim, null, 'Conservation-law checker'),
      t('feynman', 'Feynman Diagram Builder', FeynmanDiagramSim, null, 'Vertices & vertex-rule validation'),
    ],
  },
  {
    id: 'fluid', name: 'Fluid & Continuum Physics', accent: '#0ea5e9',
    topics: [
      t('flow', 'Fluid Flow', FluidFlowSim, null, '2D velocity field — sources, sinks, vortices, streamlines'),
      t('pressure', 'Fluid Pressure', FluidPressureSim, null, 'Static (ρgh) & dynamic (½ρv²) pressure'),
      t('buoyancy', 'Buoyancy', BuoyancySim, null, "Archimedes' principle — float/sink, displaced weight"),
      t('bernoulli', 'Bernoulli Equation', BernoulliSim, null, 'Venturi — pressure–speed trade-off along a streamline'),
      t('viscosity', 'Viscosity', ViscositySim, null, 'Couette flow — shear stress τ = μ du/dy, no-slip'),
      t('laminar', 'Laminar Flow', LaminarFlowSim, null, 'Parabolic Poiseuille profile, low Re, parallel layers'),
      t('turbulent', 'Turbulent Flow', TurbulentFlowSim, null, 'High-Re vortex shedding, Kármán street, mixing'),
      t('reynolds', 'Reynolds Number', ReynoldsNumberSim, null, 'Re = ρvL/μ — laminar/transitional/turbulent regimes'),
      t('pipe', 'Pipe Flow', PipeFlowSim, null, 'Poiseuille Q = πR⁴ΔP/8μL — the R⁴ law'),
      t('drag', 'Drag', DragSim, null, 'Linear (Stokes) & quadratic drag, terminal velocity'),
      t('atmos', 'Atmospheric Pressure', AtmosphericPressureSim, null, 'Barometric formula, scale height, layers'),
      t('waveprop', 'Wave Propagation', WavePropagationSim, null, 'Sound — longitudinal pressure wave, c = √(B/ρ)'),
      t('shock', 'Shock Waves', ShockWavesSim, null, 'Mach cone, Rankine–Hugoniot jump conditions'),
      t('navier', 'Navier–Stokes Visualisation', NavierStokesVizSim, null, '2D stable-fluids solver with dye injection'),
    ],
  },
  {
    id: 'condensed', name: 'Condensed Matter & Materials', accent: '#14b8a6',
    topics: [
      t('crystal', 'Crystal Structure Viewer', CrystalStructureSim, null, '3D lattice + basis rendering for SC, BCC, FCC, diamond'),
      t('unitcell', 'Unit Cell Builder', UnitCellSim, null, 'Primitive vectors, lattice points, APF from hard-sphere geometry'),
      t('bravais', 'Bravais Lattices', BravaisLatticesSim, null, 'All 14 Bravais types across 7 crystal systems'),
      t('reciprocal', 'Reciprocal Lattice', ReciprocalLatticeSim, null, 'Real→reciprocal via b_i = 2π(a_j×a_k)/V, Brillouin zone'),
      t('band', 'Band Structure', BandStructureSim, null, 'Tight-binding E(k) along Γ→X→M→Γ, multi-band, gap'),
      t('dos', 'Density of States', DensityOfStatesSim, null, 'g(E) by k-mesh histogramming, van Hove singularities'),
      t('semicon', 'Semiconductor Simulator', SemiconductorSim, null, 'n_i = √(Nc·Nv)exp(−Eg/2kT), doping, Fermi level'),
      t('pn', 'PN Junction', PNJunctionSim, null, 'Depletion width, field profile, band bending, bias'),
      t('diode', 'Diode I–V', DiodeIVSim, null, 'Shockley I=Is(exp(qV/nkT)−1), breakdown, series R'),
      t('hall', 'Hall Effect', HallEffectSim, null, 'V_H = IB/(nqt), carrier sign & density'),
      t('ferro', 'Ferromagnetism', FerromagnetismSim, null, 'Mean-field M(T), hysteresis loop, coercivity & remanence'),
      t('antiferro', 'Antiferromagnetism', AntiferromagnetismSim, null, 'Two-sublattice Ising J<0, staggered M_s, Néel T_N'),
      t('ising2', 'Ising Model', IsingModelSim, null, '2D Metropolis/Wolff MC, Onsager Tc ≈ 2.269'),
      t('heisenberg', 'Heisenberg Model', HeisenbergModelSim, null, 'Classical O(3) vector spins, Mermin-Wagner in 2D'),
      t('xy', 'XY Model', XYModelSim, null, 'Planar rotors, vortices, KT transition at T_KT ≈ 0.89'),
      t('supercon', 'Superconductivity', SuperconductivitySim, null, 'BCS gap Δ(T), R(T)→0, gapped DOS N(E)'),
      t('phases', 'Phase Transitions', PhaseTransitionsSim, null, 'Exact Onsager 2D Ising: M, E, C_V, χ with critical exponents'),
      t('topo', 'Topological Materials', TopologicalMaterialsSim, null, 'SSH model, winding number, zero-energy edge states'),
    ],
  },
  {
    id: 'vlab', name: 'Virtual Experimental Physics Lab', accent: '#f59e0b',
    topics: [
      t('vl-pendulum', 'Simple Pendulum', VLPendulumSim, null, 'Measure g from period'),
      t('vl-projectile', 'Projectile Motion', VLProjectileSim, null, 'Range vs angle'),
      t('vl-newton', "Newton's Laws", VLNewtonSim, null, 'Force & acceleration'),
      t('vl-momentum', 'Conservation of Momentum', VLMomentumSim, null, 'Before/after'),
      t('vl-energy', 'Conservation of Energy', VLEnergySim, null, 'KE+PE constant'),
      t('vl-shm', 'SHM', VLSHMSim, null, 'k from period'),
      t('vl-young', "Young's Modulus", VLYoungModulusSim, null, 'Stress–strain'),
      t('vl-ohm', "Ohm's Law", VLOhmsLawSim, null, 'V=IR'),
      t('vl-kirchhoff', "Kirchhoff's Laws", VLKirchhoffSim, null, 'Multi-loop KVL/KCL solver'),
      t('vl-wheatstone', 'Wheatstone Bridge', VLWheatstoneSim, null, 'Null measurement, ratio arms'),
      t('vl-meter', 'Meter Bridge', VLMeterBridgeSim, null, 'Slide-wire, balance point'),
      t('vl-convex', 'Convex Lens', VLConvexLensSim, null, 'Image formation, focal length'),
      t('vl-concave', 'Concave Mirror', VLConcaveMirrorSim, null, 'Reflection imaging, focal length'),
      t('vl-prism', 'Prism', VLPrismSim, null, 'Dispersion, minimum deviation'),
      t('vl-resonance', 'Resonance Tube', VLResonanceTubeSim, null, 'Speed of sound'),
      t('vl-rc', 'RC Circuit', VLRCcircuitSim, null, 'Charging curve, τ = RC'),
      t('vl-emi', 'Electromagnetic Induction', VLEMImsim, null, 'Induced EMF, Faraday law'),
    ],
  },
  {
    id: 'datalab', name: 'Physics Data Laboratory', accent: '#0891b2',
    topics: [
      t('dl-csv', 'CSV / TXT / JSON Import', DataLab, null, 'Upload experimental data'),
      t('dl-clean', 'Data Cleaning & Sorting', DataLab, null, 'Filter, sort, search'),
      t('dl-graph', 'Scientific Graphing', DataLab, null, 'Line, scatter, bar, histogram'),
      t('dl-linreg', 'Linear Regression', DataLab, null, 'y = mx + c with uncertainties'),
      t('dl-poly', 'Polynomial Fitting', DataLab, null, 'Least-squares polynomial'),
      t('dl-curve', 'Curve Fitting', DataLab, null, 'Nonlinear fits'),
      t('dl-errbars', 'Error Bars', DataLab, null, 'Uncertainty on plots'),
      t('dl-residual', 'Residual Analysis', DataLab, null, 'Fit quality'),
      t('dl-mean', 'Mean & Standard Deviation', DataLab, null, 'Summary stats'),
      t('dl-uncert', 'Uncertainty Propagation', UncertaintyLab, null, 'Error formulas'),
      t('dl-units', 'Unit Conversion', ConstantsLab, null, 'Convert units with dim check'),
      t('dl-slope', 'Slope & Intercept', DataLab, null, 'From data'),
      t('dl-bestfit', 'Best-Fit Equations', DataLab, null, 'Report the model'),
    ],
  },
  {
    id: 'research', name: 'Advanced Research Physics', accent: '#d946ef',
    topics: [
      t('quantum-field-theory', 'Quantum Field Theory', QuantumManyBodyResearch, null, 'Field modes — many-body view'),
      t('tn', 'Tensor Networks', QuantumManyBodyResearch, null, 'MPS / PEPS — many-body view'),
      t('dmrg', 'DMRG', QuantumManyBodyResearch, null, 'Many-body diagonalisation'),
      t('qmc', 'Quantum Monte Carlo', PhaseTransitionLab, null, 'Stochastic quantum sampling'),
      t('md', 'Molecular Dynamics', MolecularDynamics, null, 'Lennard–Jones, velocity-Verlet, RDF'),
      t('cfd', 'Computational Fluid Dynamics', CfdLab, null, '2D Navier–Stokes stable fluids'),
      t('plasma', 'Plasma Physics', PlasmaLab, null, 'Lorentz force, E×B, cyclotron'),
      t('numrel', 'Numerical Relativity', GravityRelativity, null, 'Einstein equations — geodesics'),
      t('gw-chirp', 'Gravitational Waves (chirp)', GravitationalWaves, null, 'Chirp waveform & spectrogram'),
      t('mbl', 'Many-Body Localisation', QuantumManyBodyResearch, null, 'Disorder & entanglement'),
      t('topo2', 'Topological Phases', CondensedMatterLab, null, 'Invariants & edge modes — band view'),
      t('qinfo2', 'Quantum Information Research', QuantumInfoLab, null, 'Density matrices, channels, tomography'),
      t('qmb2', 'Quantum Many-Body Research', QuantumManyBodyResearch, null, 'Entanglement entropy & gap scaling'),
      t('aqec', 'Advanced Quantum Error Correction', QECLab, null, 'Surface codes & decoders'),
      t('ftqc', 'Fault-Tolerant Quantum Computing', QECLab, null, 'Threshold studies'),
    ],
  },
  {
    id: 'meta', name: 'Scientific Methods & Tools', accent: '#64748b',
    topics: [
      t('constants', 'Physics Constants & Units', ConstantsLab, null, 'CODATA values, prefixes, unit conversion'),
      t('dimensional', 'Dimensional Analysis', DimensionalLab, null, 'Verify equations dimensionally'),
      t('uncertainty', 'Uncertainty & Error Lab', UncertaintyLab, null, 'Propagation, quadrature, CI'),
      t('numerics', 'Numerical Methods Lab', NumericsLab, null, 'ODE, integration, roots, eigen, MC'),
      t('viz', 'Scientific Visualization', DataLab, null, 'Plots, heatmaps, spectrograms'),
      t('notebook', 'Research Notebook', ResearchNotebook, null, 'Reproducible experiment records'),
      t('compare', 'Experiment Comparison', ExperimentComparison, null, 'Side-by-side result comparison'),
      t('hpc', 'High-Performance Computing', PhaseTransitionLab, null, 'Web Worker sweeps with cancel'),
      t('validation', 'Scientific Validation', NumericsLab, null, 'Numerical vs analytic error'),
      t('reproducibility', 'Reproducibility', ResearchNotebook, null, 'Save & re-run configurations'),
      t('export', 'Research-Style Export', DataLab, null, 'CSV / JSON / PNG export'),
    ],
  },
];

export const ALL_TOPICS = SECTIONS.flatMap((s) => s.topics.map((tp) => ({ ...tp, section: s.id, sectionName: s.name })));
export const LIVE_COUNT = ALL_TOPICS.length;
export const TOTAL_COUNT = ALL_TOPICS.length;