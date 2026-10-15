export default [
{ id:'climate', label:'Refrigeration & Building Systems', tools:[
['refrigeration-enthalpy-cycle','Refrigeration Enthalpy Cycle','Cooling COP, circulation, compressor power and condenser heat.','RefrigerationCycle'],
['refrigeration-pull-down','Product Pull-Down Cooling','Product sensible heat, cooling duration and continuous leakage.','PullDownCooling'],
['compressor-volumetric-capacity','Compressor Volumetric Capacity','Displacement, suction density, speed and volumetric efficiency.','CompressorCapacity'],
['chilled-water-coil-duty','Chilled Water Coil Duty','Water-side flow, temperature rise and heat transfer.','ChilledWaterDuty'],
['humid-air-stream-mix','Humid Air Stream Mixing','Adiabatic dry-air mass and moist-air enthalpy balance.','HumidAirMixing'],
['air-conditioning-shr','Sensible Heat Ratio','Sensible and latent cooling shares and condensate estimate.','SensibleHeatRatio'],
['ventilation-sensible-recovery','Ventilation Heat Recovery','Recovered supply temperature and residual heating demand.','HeatRecovery'],
['duct-pressure-leakage','Duct Leakage Pressure Law','Measured leakage extrapolation and fan power demand.','DuctLeakage'],
['refrigerant-pipe-velocity','Refrigerant Line Velocity','Single-phase circulation, pipe diameter and transit time.','RefrigerantVelocity'],
['degree-day-building-energy','Degree-Day Building Energy','Seasonal envelope heat, fuel energy, efficiency and cost.','DegreeDayEnergy']
]},
{ id:'vehicle', label:'Vehicle Dynamics & EV Systems', tools:[
['vehicle-stopping-distance','Vehicle Stopping Distance','Reaction delay, friction-limited braking and stopping time.','StoppingDistance'],
['cornering-friction-speed','Cornering Grip Speed','Level-road lateral friction, radius and ideal grip limit.','CorneringGrip'],
['vehicle-road-load-power','Vehicle Road-Load Power','Aerodynamic drag, rolling resistance and uphill wheel demand.','RoadLoadPower'],
['driveline-road-speed','Driveline RPM & Road Speed','Engine RPM, gear reduction and effective tire circumference.','DrivelineSpeed'],
['vehicle-aero-downforce','Aerodynamic Downforce','Speed-dependent aero load and front-rear distribution.','AeroDownforce'],
['longitudinal-axle-transfer','Longitudinal Axle Load Transfer','CG height, acceleration and dynamic axle normal loads.','AxleTransfer'],
['tire-contact-area','Tire Contact Patch Estimate','Pressure-supported contact area and nominal footprint length.','TireContactPatch'],
['brake-rotor-temperature','Brake Rotor Temperature Rise','One-stop kinetic energy and front rotor thermal demand.','RotorHeating'],
['ev-charge-window','EV Charging Window','State-of-charge target, average power and wall energy.','EVChargeWindow'],
['regenerative-braking-capture','Regenerative Braking Capture','Speed reduction, conversion efficiency and battery headroom.','RegenCapture']
]},
{ id:'civil', label:'Civil Quantities & Road Geometry', tools:[
['earthwork-end-area','Earthwork Average End Area','Station areas, bank volume, swell and loose haul volume.','EndAreaEarthwork'],
['trapezoidal-ditch-excavation','Trapezoidal Ditch Excavation','Trench side slopes, excavation area and quantity.','DitchExcavation'],
['conical-stockpile-inventory','Conical Stockpile Inventory','Conical pile volume, bulk density and inventory mass.','StockpileInventory'],
['road-superelevation-balance','Road Superelevation Balance','Curve speed, bank, radius and lateral-friction demand.','Superelevation'],
['crest-vertical-curve-sight','Crest Curve Sight Distance','Parabolic curve length in both sight-distance regimes.','CrestCurveSight'],
['horizontal-circular-curve','Horizontal Circular Curve','Arc, tangent, chord and external-distance layout geometry.','CircularCurve'],
['pile-group-rigid-cap','Pile Group Axial Load','Rigid-cap one-axis distribution and maximum pile compression.','PileGroupLoads'],
['reinforcement-area-spacing','Reinforcement Area & Spacing','Provided bar area per metre and geometric steel ratio.','RebarSpacing'],
['concrete-nurse-saul-maturity','Concrete Temperature-Time Maturity','Constant-temperature curing index and equivalent reference time.','ConcreteMaturity'],
['aggregate-moisture-batch','Aggregate Moisture Batch Correction','Wet aggregate mass, absorption and added mixing water.','AggregateMoisture']
]},
{ id:'digital', label:'Digital Hardware & Timing', tools:[
['synchronous-setup-budget','Synchronous Setup Timing Budget','Register delay, combinational path and maximum clock.','SetupTiming'],
['metastability-log-mtbf','Metastability MTBF Sensitivity','Characterized time constants and logarithmic reliability scaling.','MetastabilityMTBF'],
['cmos-switching-power','CMOS Switching Power','Switching activity, capacitance, voltage and leakage demand.','CMOSPower'],
['crystal-load-capacitance','Crystal Load Capacitors','Stray loading, asymmetric capacitors and target sizing.','CrystalLoading'],
['hamming-secded-overhead','Hamming SECDED Word Sizing','Syndrome bits, overall parity and encoded-word overhead.','SECDEDSizing'],
['integer-clock-divider','Integer Clock Divider','Nearest legal divide ratio, output frequency and error.','ClockDivider'],
['pwm-resistive-load','PWM Resistive Load RMS','Duty cycle, RMS voltage, on-state current and heating.','PWMRMS'],
['pcb-differential-skew','PCB Differential Pair Skew','Length mismatch, propagation delay and unit-interval share.','DifferentialSkew'],
['open-drain-pullup-rise','Open-Drain Pull-Up Rise Time','Bus capacitance, 30–70% rise time and sink current.','PullUpRise'],
['sample-hold-aperture-snr','ADC Aperture Jitter SNR','Input frequency and RMS jitter into a timing-noise ceiling.','ApertureJitterSNR']
]},
{ id:'astro', label:'Astrophysics & Observational Astronomy', tools:[
['exoplanet-transit-depth','Exoplanet Transit Depth','Radius ratio, central transit duration and photometric depth.','TransitDepth'],
['exoplanet-radial-amplitude','Exoplanet Radial Velocity','Companion mass, inclination and stellar velocity semi-amplitude.','RadialVelocity'],
['visual-binary-total-mass','Visual Binary Total Mass','Relative orbit and period into both stellar masses.','BinaryMass'],
['einstein-angular-ring','Einstein Angular Ring','Point-lens angular scale and physical Einstein radius.','EinsteinRing'],
['low-redshift-hubble-distance','Low-Redshift Hubble Distance','Nearby cosmological redshift, Hubble distance and travel estimate.','HubbleDistance'],
['gravitational-surface-redshift','Gravitational Surface Redshift','Emission radius, compactness and gravitational wavelength shift.','SurfaceRedshift'],
['schwarzschild-horizon-scale','Schwarzschild Horizon Scale','Black-hole horizon radius, area and light-crossing time.','SchwarzschildRadius'],
['jeans-cloud-instability','Jeans Cloud Instability','Isothermal cloud fragmentation mass, wavelength and free-fall time.','JeansMass'],
['synchrotron-critical-frequency','Synchrotron Critical Frequency','Relativistic electrons, magnetic field and characteristic radiation.','SynchrotronFrequency'],
['astronomy-exposure-snr','Astronomy Exposure SNR','Source, sky and read noise with target-exposure sizing.','ExposureSNR']
]},
{ id:'analytical', label:'Analytical Chemistry & Separations', tools:[
['debye-huckel-ion-activity','Debye–Hückel Ion Activity','Dilute-solution activity, ionic strength and charge dependence.','IonActivity'],
['vanthoff-equilibrium-shift','Van’t Hoff Equilibrium Shift','Temperature-dependent equilibrium constants and reaction enthalpy.','VanthoffEquilibrium'],
['staged-liquid-extraction','Staged Liquid Extraction','Fresh-solvent stages, phase ratios and analyte recovery.','StagedExtraction'],
['chromatography-baseline-resolution','Chromatography Peak Resolution','Retention-time separation and baseline peak widths.','PeakResolution'],
['chromatography-plate-efficiency','Chromatography Plate Efficiency','Gaussian peak-width plate count and column plate height.','PlateEfficiency'],
['mobile-phase-solvent-blend','Mobile Phase Solvent Blend','Two-stock composition balance and required mixing volumes.','SolventBlend'],
['single-spike-standard-addition','Single-Spike Standard Addition','Dilution-corrected signals and original analyte concentration.','StandardAddition'],
['internal-standard-quantitation','Internal Standard Quantitation','Peak-area ratio, calibrated response factor and concentration.','InternalStandard'],
['gravimetric-analyte-factor','Gravimetric Analyte Factor','Precipitate mass, formula stoichiometry and analyte amount.','GravimetricFactor'],
['isotope-zero-point-effect','Isotope Zero-Point Effect','One-mode vibrational energy and temperature-dependent rate heuristic.','IsotopeEffect']
]},
{ id:'materials', label:'Materials, Textiles & Surface Science', tools:[
['wet-basis-drying-balance','Wet-Basis Drying Balance','Conserved dry solids, target moisture and water removal.','DryingBalance'],
['gab-moisture-sorption','GAB Moisture Sorption','Water activity and fitted multilayer equilibrium moisture.','GABSorption'],
['yarn-linear-mass-length','Yarn Linear Mass & Length','Tex, package mass, denier and available yarn length.','YarnLength'],
['woven-fabric-areal-mass','Woven Fabric Areal Mass','Warp/weft density, crimp and fabric mass per square metre.','FabricMass'],
['rubber-network-modulus','Rubber Network Modulus','Ideal crosslink-chain density and temperature-dependent elasticity.','RubberModulus'],
['polymer-chain-degree','Polymer Chain Degree','Number-average molar mass, repeat units and end-group correction.','PolymerDegree'],
['suspension-krieger-viscosity','Suspension Viscosity','Solid loading, maximum packing and Krieger–Dougherty viscosity.','SuspensionViscosity'],
['young-dupre-adhesion','Young–Dupré Adhesion Work','Contact angle, surface tension and equilibrium adhesion energy.','AdhesionWork'],
['washburn-pore-infiltration','Washburn Pore Infiltration','Wetting, pore radius and viscous capillary penetration.','PoreInfiltration'],
['powder-carr-hausner','Powder Carr & Hausner Indices','Tapped and loose bulk densities into packing descriptors.','PowderPacking']
]},
{ id:'business', label:'Business Finance & Production Planning', tools:[
['cumulative-learning-curve','Cumulative Learning Curve','Production scale and learning rate into average labor cost.','LearningCurve'],
['economic-production-quantity','Economic Production Quantity','Finite replenishment rate, optimal batch and cycle inventory.','ProductionBatch'],
['startup-cash-runway','Startup Cash Runway','Operating reserve, monthly receipts and burn-rate runway.','CashRunway'],
['priced-round-equity-dilution','Priced Round Equity Dilution','Pre-money valuation, new investment and shareholder dilution.','EquityDilution'],
['postmoney-safe-cap','Post-Money SAFE Ownership','Cap-implied ownership and simplified later-round dilution.','SAFEOwnership'],
['saas-rule-forty','SaaS Rule of 40','Revenue growth, cash-flow margin and threshold trade-off.','RuleForty'],
['net-revenue-retention','Net Revenue Retention','Expansion, contraction and churn within an existing cohort.','RevenueRetention'],
['sales-funnel-monthly-bookings','Sales Funnel & Monthly Bookings','Stage conversion, expected customers and recurring revenue added.','SalesFunnel'],
['returns-adjusted-contribution','Returns-Adjusted Contribution','Refunds, recovery credit and reverse-logistics unit economics.','ReturnContribution'],
['invoice-early-discount-rate','Invoice Early Payment Discount','Cash savings and simple or compounded annual discount rate.','EarlyPayment']
]}
];