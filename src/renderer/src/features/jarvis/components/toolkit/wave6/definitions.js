export default [
{ id:'navigation', label:'Navigation & Coordinate Planning', tone:'cyan', tools:[
['great-circle-route-distance','Great-Circle Route Distance','Spherical surface distance, central angle and straight chord.','GreatCircleDistance'],
['great-circle-initial-bearing','Great-Circle Initial Bearing','Departure heading between two coordinates on a spherical Earth.','InitialBearing'],
['great-circle-destination','Great-Circle Destination Point','Forward position from a departure coordinate, heading and distance.','DestinationPoint'],
['great-circle-cross-track','Route Cross-Track Error','Signed offset and along-track position against a great-circle route.','CrossTrackError'],
['great-circle-midpoint','Great-Circle Route Midpoint','Shortest-route midpoint with correct antimeridian handling.','RouteMidpoint'],
['slippy-map-tile-address','Slippy Map Tile Address','Web-map tile indices, zoom level and within-tile pixel offsets.','MapTileAddress'],
['wgs84-earth-centred-point','WGS84 Earth-Centred Coordinates','Geodetic latitude, longitude and height into ECEF coordinates.','EarthCentredPoint'],
['ecef-local-enu-vector','ECEF to Local ENU Vector','Rotate coordinate differences into east, north and up offsets.','LocalENUVector'],
['coordinate-rounding-resolution','Coordinate Rounding Resolution','Decimal precision into latitude-dependent positional rounding.','CoordinateResolution'],
['spherical-earth-tangent-drop','Earth Tangent Curvature Drop','Stable spherical sagitta from ground-arc distance and radius.','CurvatureDrop']
]},
{ id:'instrument', label:'Sensors & Industrial Instrumentation', tone:'violet', tools:[
['industrial-current-loop-scale','4–20 mA Loop Scaling','Live-zero current, engineering span and current-loop loading.','CurrentLoopScale'],
['iec-platinum-rtd-resistance','Platinum RTD Resistance','IEC 60751 Callendar–Van Dusen resistance including negative temperatures.','PlatinumRTD'],
['beta-thermistor-resistance','Beta Thermistor Resistance','Temperature, beta coefficient and reference resistance response.','BetaThermistor'],
['quarter-bridge-strain-signal','Quarter-Bridge Strain Signal','Exact ideal bridge imbalance, gauge factor and amplifier output.','StrainBridge'],
['dp-transmitter-flow-scale','Differential-Pressure Flow Scaling','Square-root differential-pressure extraction and flow indication.','DPFlowScale'],
['pulse-tachometer-rpm','Pulse Tachometer RPM','Pulse frequency, pulses per revolution and shaft period.','PulseTachometer'],
['load-cell-millivolt-signal','Load Cell Millivolt Signal','Rated sensitivity, excitation, applied load and amplification.','LoadCellSignal'],
['quadrature-encoder-count-rate','Quadrature Encoder Count Rate','Encoder lines, decoding mode, angular resolution and pulse demand.','EncoderRate'],
['static-accelerometer-orientation','Static Accelerometer Orientation','Gravity-vector pitch, roll, magnitude and calibration residual.','AccelerometerOrientation'],
['lvdt-linear-displacement','LVDT Linear Displacement','Demodulated voltage, excitation sensitivity and displacement.','LVDTDisplacement']
]},
{ id:'systems', label:'Data Systems & Capacity Engineering', tone:'emerald', tools:[
['bloom-filter-capacity','Bloom Filter Capacity','Target false-positive rate, optimal memory and integer hash count.','BloomFilterCapacity'],
['count-min-sketch-sizing','Count-Min Sketch Sizing','Approximation bounds, sketch width, depth and counter memory.','CountMinSizing'],
['hyperloglog-register-budget','HyperLogLog Register Budget','Precision exponent, register memory and relative cardinality error.','HyperLogLogBudget'],
['raid-array-usable-capacity','RAID Array Usable Capacity','RAID topology, drive count, redundancy and usable capacity.','RAIDCapacity'],
['storage-rebuild-duration','Storage Rebuild Duration','Data to rebuild, sustained throughput and competing workload.','StorageRebuild'],
['nand-write-endurance','NAND Write Endurance','Physical write budget, host writes and write amplification.','WriteEndurance'],
['tcp-window-throughput-limit','TCP Window Throughput Limit','Receive window, round-trip time and link-capacity ceiling.','TCPWindowLimit'],
['fluid-backlog-drain-time','Backlog Drain Time','Existing work, continuing arrivals and spare service capacity.','BacklogDrain'],
['replication-quorum-overlap','Replication Quorum Overlap','Read/write intersection and unavailable-replica budgets.','QuorumOverlap'],
['packet-serialization-budget','Packet Serialization Budget','Payload, framing overhead, line rate and serialization delay.','PacketSerialization']
]},
{ id:'power', label:'Power Quality & Electrical Operations', tone:'amber', tools:[
['harmonic-current-thd','Harmonic Current THD','Fundamental and odd-harmonic currents into distortion and RMS current.','CurrentTHD'],
['triplen-neutral-current','Triplen Neutral Current','Balanced third, ninth and fifteenth harmonics in a four-wire system.','NeutralHarmonics'],
['star-delta-start-current','Star–Delta Starting Current','Ideal winding impedance, reduced-voltage current and torque ratio.','StarDeltaStart'],
['induction-rotor-slip-loss','Induction Rotor Slip Loss','Air-gap power, rotor copper loss and converted mechanical power.','RotorSlipLoss'],
['parallel-generator-droop-share','Parallel Generator Droop Sharing','Two no-load setpoints and droop slopes into shared load and frequency.','GeneratorDroop'],
['lead-acid-peukert-runtime','Lead-Acid Peukert Runtime','Rated-hour capacity and discharge-rate-dependent usable capacity.','PeukertRuntime'],
['dc-bus-capacitor-hold-up','DC Bus Capacitor Hold-Up','Stored bus energy, permitted voltage fall and constant-power ride-through.','DCBusHoldUp'],
['rectifier-capacitor-ripple','Rectifier Capacitor Ripple','Rectification topology, charging frequency and approximate ripple.','RectifierRipple'],
['transformer-harmonic-k-factor','Transformer Harmonic K-Factor','Frequency-weighted current heating index for supplied harmonics.','HarmonicKFactor'],
['facility-demand-diversity','Facility Demand & Diversity','Coincident peak, connected load, energy and demand factors.','DemandDiversity']
]},
{ id:'agriculture', label:'Irrigation & Agricultural Operations', tone:'emerald', tools:[
['crop-irrigation-net-gross','Crop Irrigation Net & Gross','Crop coefficient, rain credit, application efficiency and water volume.','CropIrrigation'],
['root-zone-refill-storage','Root-Zone Refill Storage','Field capacity, wilting point, rooting depth and allowable depletion.','RootZoneStorage'],
['drip-field-emitter-layout','Drip Field Emitter Layout','Row geometry, emitter spacing, total flow and application rate.','DripEmitterLayout'],
['sprinkler-application-runtime','Sprinkler Application Runtime','Grid spacing, nozzle flow, precipitation intensity and watering time.','SprinklerRuntime'],
['irrigation-salinity-leaching','Irrigation Salinity Leaching','Steady salinity leaching fraction and extra irrigation demand.','SalinityLeaching'],
['grain-aeration-airflow','Grain Aeration Airflow','Grain mass, fan flow, static pressure and fan power demand.','GrainAeration'],
['fertilizer-nutrient-budget','Fertilizer Nutrient Budget','Supplied nutrient target, labeled composition and field product mass.','FertilizerBudget'],
['field-water-tank-coverage','Field Water Tank Coverage','Application rate, tank capacity, full loads and final partial load.','WaterTankCoverage'],
['conductivity-temperature-correction','Conductivity Temperature Correction','Measured solution conductivity and linear reference-temperature correction.','ConductivityCorrection'],
['aquaculture-biomass-feed-budget','Aquaculture Biomass Feed Budget','Measured stock biomass and a supplied daily feed allocation.','AquacultureFeed']
]},
{ id:'renewables', label:'Renewable & Thermal Energy Planning', tone:'rose', tools:[
['deep-water-wave-energy-flux','Deep-Water Wave Energy Flux','Significant wave height, energy period and capture-width estimate.','WaveEnergyFlux'],
['tidal-basin-potential-energy','Tidal Basin Potential Energy','Basin area, tidal range and ideal stored gravitational energy.','TidalBasinEnergy'],
['seasonal-hydro-energy-yield','Seasonal Hydro Energy Yield','Three seasonal flow bands, head, rated flow and annual generation.','HydroSeasonalYield'],
['seebeck-matched-load-power','Seebeck Matched-Load Power','Thermoelectric coefficient, temperature difference and electrical maximum power.','ThermoelectricPower'],
['piezo-discharge-energy-harvest','Piezo Discharge Energy Harvest','Ideal capacitive discharge events and collection-efficiency power.','PiezoEnergy'],
['flat-plate-solar-thermal','Flat-Plate Solar Thermal Collector','Irradiance, fitted collector loss coefficients and useful heat.','SolarThermalCollector'],
['phase-change-heat-storage','Phase-Change Heat Storage','Sensible temperature span, latent heat and deliverable storage energy.','PhaseChangeStorage'],
['geothermal-line-source-response','Geothermal Line-Source Response','Long-time borehole thermal response and effective borehole resistance.','BoreholeResponse'],
['biogas-combined-heat-power','Biogas Combined Heat & Power','Normal methane volume, electrical yield and recovered thermal energy.','BiogasCHP'],
['wet-biomass-fuel-heat','Wet Biomass Fuel Heat','Dry-fuel heating value, moisture penalty and useful combustion heat.','BiomassHeat']
]},
{ id:'probability', label:'Bayesian & Probability Models', tone:'violet', tools:[
['bayesian-binary-test-posterior','Bayesian Binary Test Posterior','Prior frequency, sensitivity and false positives into posterior probability.','BinaryTestPosterior'],
['beta-bernoulli-posterior','Beta–Bernoulli Posterior','Conjugate prior, observed outcomes and predictive probability uncertainty.','BetaPosterior'],
['dirichlet-three-class-posterior','Dirichlet Three-Class Posterior','Symmetric pseudocounts and observed class frequencies.','DirichletPosterior'],
['negative-binomial-failure-count','Negative Binomial Failure Count','Failures before a specified number of independent successes.','NegativeBinomial'],
['finite-population-hypergeometric','Finite-Population Hypergeometric','Sampling without replacement and exact success-count probability.','HypergeometricSample'],
['geometric-first-success-horizon','Geometric First-Success Horizon','Repeated independent attempts and chance of success by a given trial.','FirstSuccessHorizon'],
['gumbel-extreme-return-level','Gumbel Extreme Return Level','Fitted location/scale parameters into annual-extreme return levels.','GumbelReturnLevel'],
['logistic-odds-ratio-shift','Logistic Odds Ratio Shift','Baseline probability and an odds-ratio multiplier into adjusted probability.','OddsRatioShift'],
['shannon-source-entropy','Shannon Source Entropy','Three source-symbol frequencies, information entropy and effective alphabet.','SourceEntropy'],
['two-state-markov-equilibrium','Two-State Markov Equilibrium','Transition rates, equilibrium occupancy and relaxation envelope.','MarkovEquilibrium']
]},
{ id:'imaging', label:'Photography & Production Planning', tone:'cyan', tools:[
['camera-exposure-value','Camera Exposure Value','Aperture, shutter duration, ISO and equivalent EV100 brightness.','ExposureValue'],
['neutral-density-exposure-time','Neutral-Density Exposure Time','ND stops, optical density and compensated shutter duration.','NDExposure'],
['flash-guide-number-range','Flash Guide Number Range','ISO-adjusted guide number, aperture and ideal flash reach.','FlashRange'],
['anamorphic-angle-of-view','Anamorphic Angle of View','Sensor dimensions, squeeze and horizontal/vertical framing geometry.','AnamorphicView'],
['macro-bellows-exposure-factor','Macro Bellows Exposure Factor','Magnification, pupil ratio, effective aperture and exposure extension.','MacroBellows'],
['macro-focus-stack-spacing','Macro Focus-Stack Spacing','Approximate object-space depth of field, overlap and frame count.','FocusStackSpacing'],
['unguided-star-trail-exposure','Unguided Star-Trail Exposure','Pixel pitch, focal length, declination and allowed sidereal motion.','StarTrailExposure'],
['cinema-shutter-angle-time','Cinema Shutter Angle & Time','Frame rate, shutter angle, exposure duration and closed interval.','CinemaShutter'],
['video-recording-storage-budget','Video Recording Storage Budget','Average stream bitrate, recording time, cameras and overhead.','VideoStorageBudget'],
['timelapse-capture-schedule','Timelapse Capture Schedule','Playback duration, frame rate, capture interval and shooting span.','TimelapseSchedule']
]}
];