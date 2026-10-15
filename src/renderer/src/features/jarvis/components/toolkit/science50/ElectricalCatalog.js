import { lazy } from 'react';
import { CircuitBoard } from 'lucide-react';
const entries = [
  ['series-rlc-frequency-response','Series RLC Frequency Response','RLC impedance, phase, RMS current, resonance and bandwidth.',()=>import('@jarvis/components/toolkit/science50/tools/SeriesRLC')],
  ['opamp-gain-rail-clipping','Op-Amp Gain & Rail Clipping','Inverting/non-inverting amplifier gain, transfer curve and rail saturation.',()=>import('@jarvis/components/toolkit/science50/tools/OpAmpRails')],
  ['rf-l-network-match','RF L-Network Impedance Match','Low-pass inductor/capacitor matching between real RF impedances.',()=>import('@jarvis/components/toolkit/science50/tools/RFMatch')],
  ['transmission-line-vswr','Transmission-Line VSWR & Input Impedance','Reflection coefficient, mismatch loss, return loss and line input impedance.',()=>import('@jarvis/components/toolkit/science50/tools/LineVSWR')],
  ['conductor-skin-depth','Conductor Skin Depth','AC penetration depth, conductivity, permeability and surface resistance.',()=>import('@jarvis/components/toolkit/science50/tools/SkinDepth')],
  ['johnson-thermal-noise','Johnson–Nyquist Thermal Noise','Resistor voltage-noise density, RMS noise and available matched-load power.',()=>import('@jarvis/components/toolkit/science50/tools/ThermalNoise')],
  ['adc-quantisation-snr','ADC Quantisation & Ideal SNR','Digital code, quantisation error, LSB size and ideal sine SNR.',()=>import('@jarvis/components/toolkit/science50/tools/ADCQuantisation')],
  ['r2r-dac-output-loading','R–2R DAC Output & Loading','Digital code to voltage, ladder output resistance and resistive loading.',()=>import('@jarvis/components/toolkit/science50/tools/R2RDAC')],
  ['buck-converter-ccm-sizing','Buck Converter CCM Sizing','Duty ratio, inductor ripple, capacitor ripple and current limits.',()=>import('@jarvis/components/toolkit/science50/tools/BuckSizing')],
  ['flyback-dcm-magnetics','Flyback DCM Magnetics','Flyback current ramp, reset interval, energy transfer and core flux.',()=>import('@jarvis/components/toolkit/science50/tools/FlybackMagnetics')],
];
export default { id:'circuit-design-tools',label:'Circuit & RF Design',icon:CircuitBoard,tools:entries.map(([id,label,desc,loader])=>({id,label,desc,icon:CircuitBoard,component:lazy(loader),isNew:true})) };