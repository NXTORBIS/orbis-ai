import { lazy } from 'react';
import { SlidersHorizontal } from 'lucide-react';
const tools=[
 ['first-order-response','First-Order Step Response','Process gain, time constant, transport delay, plant pole and settling.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/FirstOrderResponse'))],
 ['second-order-response','Second-Order Step Response','Underdamped, critical and overdamped transfer-function step dynamics.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/SecondOrderResponse'))],
 ['pid-effort','PID Control Effort Workbench','Proportional, integral and derivative control contributions and actuator clipping.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/PidEffort'))],
 ['butterworth-response','Butterworth Filter Response','Analog low-pass filter cutoff, order, attenuation and asymptotic roll-off.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/ButterworthResponse'))],
 ['chebyshev-response','Chebyshev-I Filter Response','Passband ripple and frequency rejection from a Type-I analog filter.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/ChebyshevResponse'))],
 ['moving-average-fir','Moving-Average FIR Analyzer','Boxcar filter magnitude, linear-phase group delay and spectral nulls.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/MovingAverageFir'))],
 ['sampling-alias','Sampling & Aliasing Explorer','Sampled sinusoid frequency folding into the Nyquist interval.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/SamplingAlias'))],
 ['friis-noise-cascade','Cascaded Amplifier Noise Figure','Receiver cascade input-referred noise using Friis gains and noise factors.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/FriisNoiseCascade'))],
 ['charge-pump-pll','Charge-Pump PLL Loop Parameters','Type-II loop natural frequency, damping and passive PI filter zero.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/ChargePumpPll'))],
 ['two-point-calibration','Two-Point Sensor Calibration','Raw sensor readings, calibrated engineering values, slope and offset.',lazy(()=>import('@jarvis/components/toolkit/wave2/tools/TwoPointCalibration'))]
];
export default {id:'wave2-controls',label:'Controls & Signals',icon:SlidersHorizontal,tools:tools.map(([id,label,desc,component])=>({id,label,desc,component,icon:SlidersHorizontal,isNew:true}))};