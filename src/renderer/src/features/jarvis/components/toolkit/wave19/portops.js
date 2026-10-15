import { D, F, M, O, T } from '@jarvis/components/toolkit/wave19/model';

const craneCycleS = (hoistHeightM, hoistSpeedMps, trolleyTravelM, trolleySpeedMps, twistlockS, landingS) => 2 * (hoistHeightM / Math.max(hoistSpeedMps, .01) + trolleyTravelM / Math.max(trolleySpeedMps, .01)) + twistlockS + landingS;
const movesPerHourFrom = (cycleS) => 3600 / Math.max(cycleS, .001);
const movesPerCraneHour = (moves, cranes, hours) => moves / Math.max(cranes * hours, .001);
const vesselBerthHours = (moves, cranes, rate, pilotageMin, mooringMin) => moves / Math.max(cranes * rate, .001) + (pilotageMin + mooringMin) / 60;
const yardCapacityTeu = (areaHa, footprintM2, stackingHigh, aislePct) => areaHa * 1e4 * (1 - aislePct / 100) / Math.max(footprintM2, .01) * stackingHigh;
const stackerCycleS = (distanceM, speedKph, liftHeightM, liftSpeedMps, handlingS) => 2 * distanceM / Math.max(speedKph / 3.6, .01) + 1.5 * liftHeightM / Math.max(liftSpeedMps, .01) + handlingS;
const gateTurnaroundMin = (trucksPerHour, lanes, serviceMin, peakFactor) => {
  const capacity = lanes * 60 / Math.max(serviceMin, .01), utilisation = trucksPerHour * peakFactor / Math.max(capacity, .001);
  if (utilisation >= 1) return serviceMin + 60;
  return serviceMin + serviceMin * utilisation / Math.max(1 - utilisation, .01);
};
const gateUtilisationPct = (trucksPerHour, lanes, serviceMin, peakFactor) => trucksPerHour * peakFactor / Math.max(lanes * 60 / Math.max(serviceMin, .01), .001) * 100;
const underKeelM = (chartDepthM, tideM, draftM, squatM) => chartDepthM + tideM - draftM - squatM;
const tideWindowHours = (ukc, requiredUkc, tideRate) => Math.max(0, 2 * (ukc - requiredUkc) / Math.max(tideRate, .001));
const cornerLoadKg = (containerKg, stackHigh) => containerKg * stackHigh / 4;
const groundPressureKpa = (containerKg, stackHigh, footprintM2) => containerKg * stackHigh * 9.81 / 1000 / Math.max(footprintM2, .01);
const reeferLoadKw = (reefers, plugKw, diversityPct) => reefers * plugKw * diversityPct / 100;
const yardVehicleCycleS = (distanceM, speedKph, handlingS) => 2 * distanceM / Math.max(speedKph / 3.6, .01) + handlingS;
const terminalCapacityTeu = (berths, cranesPerBerth, rate, hoursYear, utilisationPct, teuPerMove) => berths * cranesPerBerth * rate * hoursYear * utilisationPct / 100 * teuPerMove;
const gangShifts = (moves, ratePerGangHour, shiftHours, breaksPct) => moves / Math.max(ratePerGangHour * shiftHours * (1 - breaksPct / 100), .001);
const costPerMove = (craneCostPerHour, ratePerCraneHour, labourPerMove, energyPerMove) => craneCostPerHour / Math.max(ratePerCraneHour, .001) + labourPerMove + energyPerMove;
const berthUtilisationPct = (calls, serviceHours, berths, daysYear) => calls * serviceHours / Math.max(berths * daysYear * 24, .001) * 100;
const berthWaitHours = (calls, serviceHours, berths, daysYear) => {
  const u = Math.min(.98, berthUtilisationPct(calls, serviceHours, berths, daysYear) / 100);
  return serviceHours * Math.pow(u, berths) / Math.max(berths * (1 - u), .001);
};

export const portopsTools = [
D({ id: 'port-crane-cycle', sweep: 'hoistHeightM', fields: [F('hoistHeightM','Hoist height (m)',25,5,60,.5),F('hoistSpeedMps','Hoist speed (m/s)',1.2,.3,3,.05),F('trolleyTravelM','Trolley travel (m)',30,5,80,.5),F('trolleySpeedMps','Trolley speed (m/s)',2.5,.5,5,.05),F('twistlockS','Twistlock and landing (s)',20,5,60,1),F('landingS','Approach and set down (s)',25,5,60,1)], equation:'the cycle is the hoist and trolley both ways, plus the handling at each end', note:'The cycle of a quay crane on one container, which is the arithmetic every berth plan is built from. Hoist height and trolley travel are both in the cycle twice, so a crane on a big ship in a wide berth is slower per move than the same crane close in, whatever the nameplate rate says.', calculate: p => {
  const cycle = craneCycleS(p.hoistHeightM, p.hoistSpeedMps, p.trolleyTravelM, p.trolleySpeedMps, p.twistlockS, p.landingS);
  return O('Cycle time', cycle, 's', [
    M('Moves an hour', movesPerHourFrom(cycle), 'moves'),
    M('Moves a shift of eight hours', movesPerHourFrom(cycle) * 8, 'moves'),
    M('Travel share of the cycle', 2 * (p.hoistHeightM / Math.max(p.hoistSpeedMps, .01) + p.trolleyTravelM / Math.max(p.trolleySpeedMps, .01)) / Math.max(cycle, .001) * 100, '%'),
    M('Cycle on a 40 m hoist', craneCycleS(40, p.hoistSpeedMps, p.trolleyTravelM, p.trolleySpeedMps, p.twistlockS, p.landingS), 's'),
    M('Moves an hour at the faster 2 m/s hoist', movesPerHourFrom(craneCycleS(p.hoistHeightM, 2, p.trolleyTravelM, p.trolleySpeedMps, p.twistlockS, p.landingS)), 'moves'),
    M('Reading', cycle > 130 ? 'A slow cycle, the travel is dominating rather than the handling' : 'A cycle a modern quay crane would recognise', '')]);
}, references: [T('A 25 m hoist and a 30 m trolley at typical speeds', {hoistHeightM:25,hoistSpeedMps:1.2,trolleyTravelM:30,trolleySpeedMps:2.5,twistlockS:20,landingS:25}, craneCycleS(25,1.2,30,2.5,20,25)), T('The same crane working a 40 m hoist', {hoistHeightM:40,hoistSpeedMps:1.2,trolleyTravelM:30,trolleySpeedMps:2.5,twistlockS:20,landingS:25}, craneCycleS(40,1.2,30,2.5,20,25))] }),
D({ id: 'port-berth-productivity', sweep: 'moves', fields: [F('moves','Container moves on the call',1800,50,20000,50),F('cranes','Cranes assigned',3,1,12,1),F('hours','Hours worked',14,1,72,.5),F('availabilityPct','Crane availability (%)',85,50,100,1),F('teuPerMove','TEU a move',1.5,1,2,.05)], equation:'productivity=moves÷(cranes×hours); availability comes off the total', note:'The rate a berth actually achieved and the rate it could hold with the cranes working. Productivity a crane hour is the industry measure that lets one terminal be compared with another, and the availability figure is where the difference between a plan and a call usually sits.', calculate: p => {
  const rate = movesPerCraneHour(p.moves, p.cranes, p.hours), availableRate = rate * p.availabilityPct / 100;
  return O('Moves an hour a crane', rate, 'moves', [
    M('Moves an hour with availability', availableRate, 'moves'),
    M('TEU on the call', p.moves * p.teuPerMove, 'TEU'),
    M('Hours the call would need at the available rate', movesPerCraneHour(p.moves, p.cranes * (p.availabilityPct / 100), p.hours), 'h'),
    M('Moves a day at this rate', availableRate * p.cranes * 24, 'moves'),
    M('Rate with a fourth crane', movesPerCraneHour(p.moves, p.cranes + 1, p.hours), 'moves'),
    M('Reading', rate < 22 ? 'Below the rate a modern terminal plans around' : rate > 32 ? 'A strong rate, check the cranes are not being pushed past their rating' : 'A rate in the range most terminals achieve', '')]);
}, references: [T('Eighteen hundred moves with three cranes over fourteen hours', {moves:1800,cranes:3,hours:14,availabilityPct:85,teuPerMove:1.5}, movesPerCraneHour(1800,3,14)), T('The same moves with four cranes', {moves:1800,cranes:4,hours:14,availabilityPct:85,teuPerMove:1.5}, movesPerCraneHour(1800,4,14))] }),
D({ id: 'port-vessel-call', sweep: 'moves', fields: [F('moves','Container moves',1800,50,20000,50),F('cranes','Cranes assigned',3,1,12,1),F('ratePerCraneHour','Moves an hour a crane',28,10,45,.5),F('pilotageMin','Pilotage in and out (min)',90,30,300,10),F('mooringMin','Mooring and unmooring (min)',45,10,120,5),F('berthCostPerHour','Berth cost an hour ($)',900,50,20000,50)], equation:'the call is the cargo hours plus the pilotage and the mooring either side', note:'The hours a vessel occupies a berth from arrival to sailing, and what those hours cost. The cargo work is the visible part and the pilotage and mooring either side are the part that is easy to forget in a schedule, so a berth window that ignores them will always run late.', calculate: p => {
  const hours = vesselBerthHours(p.moves, p.cranes, p.ratePerCraneHour, p.pilotageMin, p.mooringMin), cargo = p.moves / Math.max(p.cranes * p.ratePerCraneHour, .001);
  return O('Hours on the berth', hours, 'h', [
    M('Cargo hours', cargo, 'h'),
    M('Pilotage and mooring', (p.pilotageMin + p.mooringMin) / 60, 'h'),
    M('Berth cost for the call', hours * p.berthCostPerHour, '$'),
    M('Cost saved by one more crane', (hours - vesselBerthHours(p.moves, p.cranes + 1, p.ratePerCraneHour, p.pilotageMin, p.mooringMin)) * p.berthCostPerHour, '$'),
    M('Rate needed for a twelve hour call', p.moves / Math.max(p.cranes * (12 - (p.pilotageMin + p.mooringMin) / 60), .001), 'moves an h'),
    M('Reading', hours > 24 ? 'A call over a full day, the berth will be tied up and the plan will cascade' : 'A call that fits inside a day on the berth', '')]);
}, references: [T('Eighteen hundred moves with three cranes at 28 an hour', {moves:1800,cranes:3,ratePerCraneHour:28,pilotageMin:90,mooringMin:45,berthCostPerHour:900}, vesselBerthHours(1800,3,28,90,45)), T('The same call with four cranes', {moves:1800,cranes:4,ratePerCraneHour:28,pilotageMin:90,mooringMin:45,berthCostPerHour:900}, vesselBerthHours(1800,4,28,90,45))] }),
D({ id: 'port-yard-density', sweep: 'stackingHigh', fields: [F('areaHa','Yard area (hectares)',12,.5,200,.5),F('footprintM2','Ground footprint a TEU needs (m²)',14.9,5,40,.1),F('stackingHigh','Containers high',4,1,8,1),F('aislePct','Lost to aisles and roads (%)',35,10,60,1),F('teuPerSlot','TEU in a ground slot',2,1,2,1)], equation:'capacity=the usable area÷the footprint, then stacked', note:'How many containers a yard holds once the area lost to aisles and roads is taken out and the stacking height is allowed for. Density is the measure that separates two terminals as much as area does, since going from four high to five is worth more than a quarter more ground.', calculate: p => {
  const capacity = yardCapacityTeu(p.areaHa, p.footprintM2, p.stackingHigh, p.aislePct) * p.teuPerSlot / 2, slots = p.areaHa * 1e4 * (1 - p.aislePct / 100) / Math.max(p.footprintM2, .01);
  return O('Yard capacity', capacity, 'TEU', [
    M('Ground slots', slots, 'slots'),
    M('Area a TEU at this density', p.areaHa * 1e4 / Math.max(capacity, 1), 'm²'),
    M('Capacity at five high', yardCapacityTeu(p.areaHa, p.footprintM2, 5, p.aislePct) * p.teuPerSlot / 2, 'TEU'),
    M('Capacity with aisles at 25 %', yardCapacityTeu(p.areaHa, p.footprintM2, p.stackingHigh, 25) * p.teuPerSlot / 2, 'TEU'),
    M('Density', capacity / Math.max(p.areaHa, .001), 'TEU a hectare'),
    M('Reading', capacity / Math.max(p.areaHa, .001) < 1500 ? 'A low density for a container yard, the layout is losing ground' : 'A density in the range a modern yard achieves', '')]);
}, references: [T('Twelve hectares stacked four high', {areaHa:12,footprintM2:14.9,stackingHigh:4,aislePct:35,teuPerSlot:2}, yardCapacityTeu(12,14.9,4,35) * 2 / 2), T('The same yard stacked five high', {areaHa:12,footprintM2:14.9,stackingHigh:5,aislePct:35,teuPerSlot:2}, yardCapacityTeu(12,14.9,5,35) * 2 / 2)] }),
D({ id: 'port-reach-stacker', sweep: 'distanceM', fields: [F('distanceM','Travel distance (m)',180,20,800,5),F('speedKph','Travel speed (km/h)',20,5,40,.5),F('liftHeightM','Lift height (m)',4,1,10,.5),F('liftSpeedMps','Lift speed (m/s)',.4,.1,1.5,.05),F('handlingS','Handling and setting down (s)',35,10,120,5),F('fuelPerHourL','Fuel burn (L an h)',6,1,30,.5),F('fuelCostPerL','Fuel cost ($ a L)',1.1,.3,4,.05)], equation:'the cycle is the travel both ways, the lift and the handling', note:'The cycle of a yard machine moving one container, which decides how many it can do in a shift. Travel distance is in the cycle twice and is the lever a yard layout holds, while the lift time is small unless the stack is tall.', calculate: p => {
  const cycle = stackerCycleS(p.distanceM, p.speedKph, p.liftHeightM, p.liftSpeedMps, p.handlingS), perHour = movesPerHourFrom(cycle);
  return O('Cycle time', cycle, 's', [
    M('Moves an hour', perHour, 'moves'),
    M('Travel share of the cycle', 2 * p.distanceM / Math.max(p.speedKph / 3.6, .01) / Math.max(cycle, .001) * 100, '%'),
    M('Moves a shift of eight hours', perHour * 8, 'moves'),
    M('Fuel a move', p.fuelPerHourL / Math.max(perHour, .001), 'L'),
    M('Fuel cost a move', p.fuelPerHourL / Math.max(perHour, .001) * p.fuelCostPerL, '$'),
    M('Reading', perHour < 20 ? 'Below twenty moves an hour, shorten the travel or speed the handling' : 'A rate a yard machine should hold', '')]);
}, references: [T('A hundred and eighty metres at 20 km/h', {distanceM:180,speedKph:20,liftHeightM:4,liftSpeedMps:.4,handlingS:35,fuelPerHourL:6,fuelCostPerL:1.1}, stackerCycleS(180,20,4,.4,35)), T('The same machine on a 320 m transfer', {distanceM:320,speedKph:20,liftHeightM:4,liftSpeedMps:.4,handlingS:35,fuelPerHourL:6,fuelCostPerL:1.1}, stackerCycleS(320,20,4,.4,35))] }),
D({ id: 'port-gate-turnaround', sweep: 'trucksPerHour', fields: [F('trucksPerHour','Trucks arriving an hour',60,5,200,5),F('lanes','Gate lanes',4,1,20,1),F('serviceMin','Minutes a truck takes at the gate',4,1,30,.5),F('peakFactor','Peak factor',1.5,1,3,.1),F('hoursOpen','Hours the gate is open',12,4,24,.5)], equation:'the turnaround is the service time plus the waiting, and the waiting follows the utilisation', note:'The turnaround a truck sees at the gate, which is the number hauliers complain about and the one a terminal is judged on. Waiting rises very steeply as the lanes approach full utilisation, so a gate at ninety per cent of capacity looks far worse in reality than the arithmetic suggests.', calculate: p => {
  const turnaround = gateTurnaroundMin(p.trucksPerHour, p.lanes, p.serviceMin, p.peakFactor), utilisation = gateUtilisationPct(p.trucksPerHour, p.lanes, p.serviceMin, p.peakFactor);
  const wait = Math.max(0, turnaround - p.serviceMin);
  return O('Truck turnaround', turnaround, 'min', [
    M('Waiting time', wait, 'min'),
    M('Gate utilisation at the peak', utilisation, '%'),
    M('Gate capacity an hour', p.lanes * 60 / Math.max(p.serviceMin, .01), 'trucks'),
    M('Trucks through the gate a day', p.lanes * 60 / Math.max(p.serviceMin, .01) * .85 * p.hoursOpen, 'trucks'),
    M('Turnaround with one more lane', gateTurnaroundMin(p.trucksPerHour, p.lanes + 1, p.serviceMin, p.peakFactor), 'min'),
    M('Reading', utilisation > 90 ? 'The gate is nearly full at the peak, the queue will be long and erratic' : utilisation > 75 ? 'A busy gate, expect queues at the peak' : 'A gate with room to absorb a busy morning', '')]);
}, references: [T('Sixty trucks an hour over four lanes at four minutes each', {trucksPerHour:60,lanes:4,serviceMin:4,peakFactor:1.5,hoursOpen:12}, gateTurnaroundMin(60,4,4,1.5)), T('A busier eighty trucks an hour', {trucksPerHour:80,lanes:4,serviceMin:4,peakFactor:1.5,hoursOpen:12}, gateTurnaroundMin(80,4,4,1.5))] }),
D({ id: 'port-tide-window', sweep: 'tideM', fields: [F('chartDepthM','Chart depth (m)',14,5,25,.1),F('tideM','Height of tide (m)',2,0,6,.1),F('draftM','Vessel draft (m)',14,5,20,.1),F('squatM','Squat and heel (m)',.6,0,2,.05),F('ukcRequiredM','Under keel clearance required (m)',.8,.2,3,.05),F('tideRateM','Tide rise or fall an hour (m)',.3,.05,2,.05)], equation:'clearance=chart depth+tide−draft−squat', note:'Whether a vessel has the clearance under her keel to enter, and how long the window lasts either side of high water. Clearance is what a ship’s draft is planned around rather than the depth on the chart, and a large ship’s window can be a couple of hours either side of the tide.', calculate: p => {
  const ukc = underKeelM(p.chartDepthM, p.tideM, p.draftM, p.squatM);
  return O('Under keel clearance', ukc, 'm', [
    M('Against the requirement', ukc - p.ukcRequiredM, 'm'),
    M('Window at this tide', tideWindowHours(ukc, p.ukcRequiredM, p.tideRateM), 'h'),
    M('Maximum draft in this depth', p.chartDepthM + p.tideM - p.squatM - p.ukcRequiredM, 'm'),
    M('Clearance on a 1 m tide', underKeelM(p.chartDepthM, 1, p.draftM, p.squatM), 'm'),
    M('Tide needed for the requirement', p.draftM + p.squatM + p.ukcRequiredM - p.chartDepthM, 'm'),
    M('Reading', ukc < p.ukcRequiredM ? 'Not enough water to enter at this state of tide, wait for the flood' : ukc < p.ukcRequiredM * 1.5 ? 'Just enough water, this is a critical passage' : 'Comfortable clearance for this vessel', '')]);
}, references: [T('A 14 m draft over 14 m of charted depth on a 2 m tide', {chartDepthM:14,tideM:2,draftM:14,squatM:.6,ukcRequiredM:.8,tideRateM:.3}, underKeelM(14,2,14,.6)), T('The same vessel at low water', {chartDepthM:14,tideM:.5,draftM:14,squatM:.6,ukcRequiredM:.8,tideRateM:.3}, underKeelM(14,.5,14,.6))] }),
D({ id: 'port-stack-load', sweep: 'stackingHigh', fields: [F('containerKg','Container mass (kg)',26000,5000,40000,500),F('stackingHigh','Containers high',5,1,9,1),F('cornerRatingKg','Corner post rating (kg)',90000,20000,200000,1000),F('footprintM2','Footprint a slot (m²)',14.9,5,40,.1),F('groundKpa','Ground bearing (kPa)',300,50,1000,10)], equation:'the bottom container carries the stack above it, spread over four corners', note:'Whether a stack is inside what the containers and the ground underneath will take, which is the check that stops a yard stacking itself into a collapse. Corner post ratings are set by the box manufacturer and the ground bearing is a survey figure, and the lower of the two limits the stack.', calculate: p => {
  const corner = cornerLoadKg(p.containerKg, p.stackingHigh), pressure = groundPressureKpa(p.containerKg, p.stackingHigh, p.footprintM2);
  const stackLimit = Math.max(1, Math.floor(p.cornerRatingKg * 4 / Math.max(p.containerKg, 1)));
  return O('Load on a bottom corner', corner, 'kg', [
    M('Against the corner rating', corner / Math.max(p.cornerRatingKg, .001) * 100, '%'),
    M('Ground pressure', pressure, 'kPa'),
    M('Against the ground bearing', pressure / Math.max(p.groundKpa, .001) * 100, '%'),
    M('Stack the corner rating allows', stackLimit, 'high'),
    M('Ground pressure at four high', groundPressureKpa(p.containerKg, 4, p.footprintM2), 'kPa'),
    M('Reading', corner > p.cornerRatingKg ? 'Over the corner rating, bring the stack down a tier' : pressure > p.groundKpa ? 'The ground is the limit here, not the container' : 'Inside both the corner rating and the ground bearing', '')]);
}, references: [T('Twenty-six tonne containers stacked five high', {containerKg:26000,stackingHigh:5,cornerRatingKg:90000,footprintM2:14.9,groundKpa:300}, cornerLoadKg(26000,5)), T('A lighter fifteen tonne box stacked five high', {containerKg:15000,stackingHigh:5,cornerRatingKg:90000,footprintM2:14.9,groundKpa:300}, cornerLoadKg(15000,5))] }),
D({ id: 'port-reefer-power', sweep: 'reefers', fields: [F('reefers','Reefer containers plugged in',180,1,5000,1),F('plugKw','Power a reefer (kW)',6,1,20,.5),F('diversityPct','Diversity factor (%)',70,30,100,1),F('gensetKw','Genset rating (kW)',500,50,3000,50),F('voltageV','Supply voltage (V)',400,200,1000,10),F('cableMm2','Cable cross section (mm²)',16,1,240,1)], equation:'the load is the plugs×the power a reefer×the diversity factor', note:'The electrical load a reefer row puts on the supply, and the generating plant behind it. Diversifying the load is what makes a reefer yard affordable, because every plug can draw full power and they very rarely all do at once, and the cable is sized on the current that follows.', calculate: p => {
  const load = reeferLoadKw(p.reefers, p.plugKw, p.diversityPct), currentPerPlug = p.plugKw * 1000 / (Math.sqrt(3) * Math.max(p.voltageV, 1));
  return O('Reefer load', load, 'kW', [
    M('Gensets needed', Math.ceil(load / Math.max(p.gensetKw, .001)), 'gensets'),
    M('Load at full diversity', reeferLoadKw(p.reefers, p.plugKw, 100), 'kW'),
    M('Current a plug', currentPerPlug, 'A'),
    M('Current a square millimetre of cable', currentPerPlug / Math.max(p.cableMm2, .001), 'A a mm²'),
    M('Load a 500 plug yard needs', reeferLoadKw(500, p.plugKw, p.diversityPct), 'kW'),
    M('Reading', currentPerPlug / Math.max(p.cableMm2, .001) > 4 ? 'The cable is carrying too much current for its size, go up a cross section' : 'A cable loading within the usual range for this circuit', '')]);
}, references: [T('A hundred and eighty reefers at 6 kW with 70 % diversity', {reefers:180,plugKw:6,diversityPct:70,gensetKw:500,voltageV:400,cableMm2:16}, reeferLoadKw(180,6,70)), T('The same yard at full diversity', {reefers:180,plugKw:6,diversityPct:100,gensetKw:500,voltageV:400,cableMm2:16}, reeferLoadKw(180,6,100))] }),
D({ id: 'port-yard-vehicle', sweep: 'movesPerCall', fields: [F('movesPerCall','Moves on the call',1800,50,20000,50),F('transferDistanceM','Transfer distance (m)',600,50,3000,10),F('speedKph','Speed (km/h)',25,5,50,.5),F('handlingS','Handling at each end (s)',45,10,180,5),F('vehicles','Vehicles assigned',8,1,60,1),F('callHours','Hours to work the call',14,2,72,.5)], equation:'each move is a return trip at the transfer speed plus the handling', note:'How many yard vehicles a ship working needs, from the distance between the quay and the stack. The transfer distance is the whole game, so a berth working a stack at the far end of the yard needs several more vehicles than one with a nearby stack, whatever the cranes do.', calculate: p => {
  const cycle = yardVehicleCycleS(p.transferDistanceM, p.speedKph, p.handlingS), perHour = movesPerHourFrom(cycle);
  return O('Cycle time', cycle, 's', [
    M('Moves an hour a vehicle', perHour, 'moves'),
    M('Vehicles needed for the call', Math.ceil(p.movesPerCall / Math.max(perHour * p.callHours, .001)), 'vehicles'),
    M('Moves the assigned fleet does an hour', p.vehicles * perHour, 'moves'),
    M('Spare capacity', p.vehicles * perHour * p.callHours - p.movesPerCall, 'moves'),
    M('Vehicles needed for a 300 m transfer', Math.ceil(p.movesPerCall / Math.max(movesPerHourFrom(yardVehicleCycleS(300, p.speedKph, p.handlingS)) * p.callHours, .001)), 'vehicles'),
    M('Reading', p.vehicles * perHour * p.callHours < p.movesPerCall ? 'The fleet cannot finish the call in the hours available' : 'The fleet covers the call with capacity in hand', '')]);
}, references: [T('Eighteen hundred moves over a 600 m transfer', {movesPerCall:1800,transferDistanceM:600,speedKph:25,handlingS:45,vehicles:8,callHours:14}, yardVehicleCycleS(600,25,45)), T('The same call with a 300 m transfer', {movesPerCall:1800,transferDistanceM:300,speedKph:25,handlingS:45,vehicles:8,callHours:14}, yardVehicleCycleS(300,25,45))] }),
D({ id: 'port-terminal-capacity', sweep: 'berths', fields: [F('berths','Berths',4,1,20,1),F('cranesPerBerth','Cranes a berth',3,1,10,1),F('ratePerCraneHour','Moves an hour a crane',28,10,45,.5),F('hoursYear','Operating hours a year',8400,4000,8760,50),F('utilisationPct','Berth utilisation (%)',75,30,95,1),F('teuPerMove','TEU a move',1.5,1,2,.05),F('demandTeu','TEU the market wants',400000,1000,10000000,1000)], equation:'capacity=berths×cranes×the rate×the hours×utilisation', note:'The containers a terminal can handle in a year and whether that leaves room for the market to grow. Capacity is a chain of factors rather than a single number, and the utilisation allowance is the honest part of it, because a berth that is booked solid cannot take a late ship.', calculate: p => {
  const capacity = terminalCapacityTeu(p.berths, p.cranesPerBerth, p.ratePerCraneHour, p.hoursYear, p.utilisationPct, p.teuPerMove);
  return O('Annual capacity', capacity, 'TEU', [
    M('Headroom over the market', capacity / Math.max(p.demandTeu, 1) * 100 - 100, '%'),
    M('Moves a year', capacity / Math.max(p.teuPerMove, .001), 'moves'),
    M('Utilisation needed for the market', p.demandTeu / Math.max(capacity, 1) * p.utilisationPct, '%'),
    M('Capacity with a fifth berth', terminalCapacityTeu(p.berths + 1, p.cranesPerBerth, p.ratePerCraneHour, p.hoursYear, p.utilisationPct, p.teuPerMove), 'TEU'),
    M('Capacity at full utilisation', terminalCapacityTeu(p.berths, p.cranesPerBerth, p.ratePerCraneHour, p.hoursYear, 100, p.teuPerMove), 'TEU'),
    M('Reading', capacity < p.demandTeu ? 'The terminal is short of the market, the extra will go elsewhere' : capacity < p.demandTeu * 1.15 ? 'Only just enough capacity, there is no room for a busy year' : 'Capacity with room for the market to grow', '')]);
}, references: [T('Four berths with three cranes each', {berths:4,cranesPerBerth:3,ratePerCraneHour:28,hoursYear:8400,utilisationPct:75,teuPerMove:1.5,demandTeu:400000}, terminalCapacityTeu(4,3,28,8400,75,1.5)), T('The same terminal with a faster 32 an hour', {berths:4,cranesPerBerth:3,ratePerCraneHour:32,hoursYear:8400,utilisationPct:75,teuPerMove:1.5,demandTeu:400000}, terminalCapacityTeu(4,3,32,8400,75,1.5))] }),
D({ id: 'port-gang-plan', sweep: 'moves', fields: [F('moves','Moves to work',1800,50,20000,50),F('ratePerGangHour','Moves a gang an hour',28,5,45,.5),F('gangSize','People in a gang',12,3,40,1),F('shiftHours','Hours a shift',8,4,12,.5),F('breaksPct','Time lost to breaks and shift change (%)',12,0,30,1),F('hourlyRate','Cost a person an hour ($)',38,5,200,.5),F('callHours','Hours the ship is on the berth',28,4,120,1)], equation:'shifts=the moves÷what a gang does in an effective shift', note:'The gangs and shifts a ship working needs, with the breaks and the shift change taken out of the available hours. The lost time is small in the plan and large in the outcome, because a shift change on a live ship stops the crane rather than pausing the clock.', calculate: p => {
  const shifts = gangShifts(p.moves, p.ratePerGangHour, p.shiftHours, p.breaksPct), effective = p.shiftHours * (1 - p.breaksPct / 100);
  const movesPerShift = p.ratePerGangHour * effective, gangs = Math.ceil(p.callHours / Math.max(p.shiftHours, 1));
  return O('Shifts needed', shifts, 'shifts', [
    M('Moves a gang a shift', movesPerShift, 'moves'),
    M('Effective hours a shift', effective, 'h'),
    M('Labour cost a shift', p.gangSize * p.shiftHours * p.hourlyRate, '$'),
    M('Gangs for this call', gangs, 'gangs'),
    M('Labour cost of the call', shifts * p.gangSize * p.shiftHours * p.hourlyRate, '$'),
    M('Reading', shifts / Math.max(gangs, 1) > 3 ? 'More than three shifts a gang, the call will need reliefs and a handover plan' : 'A shift pattern the call can absorb', '')]);
}, references: [T('Eighteen hundred moves at 28 a gang hour over eight hour shifts', {moves:1800,ratePerGangHour:28,gangSize:12,shiftHours:8,breaksPct:12,hourlyRate:38,callHours:28}, gangShifts(1800,28,8,12)), T('The same moves with a 20 % break allowance', {moves:1800,ratePerGangHour:28,gangSize:12,shiftHours:8,breaksPct:20,hourlyRate:38,callHours:28}, gangShifts(1800,28,8,20))] }),
D({ id: 'port-move-cost', sweep: 'moves', fields: [F('moves','Moves in the year',25000,100,500000,100),F('craneCostPerHour','Crane cost an hour ($)',450,50,3000,50),F('ratePerCraneHour','Moves an hour a crane',28,10,45,.5),F('labourPerMove','Labour a move ($)',9,1,80,.5),F('energyPerMove','Energy a move ($)',3,.5,50,.5),F('tariffPerMove','Tariff a move ($)',85,10,500,1)], equation:'cost a move=crane cost÷the rate, plus the labour and the energy', note:'What a container move costs a terminal and what it sells for, with the crane cost spread over the rate it achieves. The rate is the strongest lever, because the crane cost is a fixed hourly figure and every move an hour more spreads it thinner, which is why terminals chase rate before they chase price.', calculate: p => {
  const perMove = costPerMove(p.craneCostPerHour, p.ratePerCraneHour, p.labourPerMove, p.energyPerMove), cost = perMove * p.moves, revenue = p.tariffPerMove * p.moves;
  return O('Cost a move', perMove, '$', [
    M('Cost of the year', cost, '$'),
    M('Revenue from the year', revenue, '$'),
    M('Margin a move', p.tariffPerMove - perMove, '$'),
    M('Margin', (p.tariffPerMove - perMove) / Math.max(p.tariffPerMove, .001) * 100, '%'),
    M('Break-even tariff', perMove, '$'),
    M('Reading', perMove > p.tariffPerMove ? 'Moves are being handled at a loss at this tariff' : p.tariffPerMove < perMove * 1.15 ? 'A very thin margin on each move' : 'A margin that leaves room for the fixed costs', '')]);
}, references: [T('Twenty-five thousand moves at 28 an hour', {moves:25000,craneCostPerHour:450,ratePerCraneHour:28,labourPerMove:9,energyPerMove:3,tariffPerMove:85}, costPerMove(450,28,9,3)), T('The same volume at 34 moves an hour', {moves:25000,craneCostPerHour:450,ratePerCraneHour:34,labourPerMove:9,energyPerMove:3,tariffPerMove:85}, costPerMove(450,34,9,3))] }),
D({ id: 'port-bunker-fuel', sweep: 'consumptionTPerDay', fields: [F('consumptionTPerDay','Fuel burn a day (t)',28,2,200,.5),F('hours','Hours of steaming',48,1,720,1),F('fuelPricePerT','Fuel price ($ a tonne)',620,200,2000,10),F('tankT','Tank capacity (t)',1800,100,20000,100),F('rangeNm','Range on a full tank (nm)',12000,500,30000,100)], equation:'the fuel is the daily burn×the hours; the cost follows the price', note:'The fuel a passage takes and what it costs, which is the largest single operating cost on a ship. The burn goes with the speed roughly cubed, so the honest way to save fuel is to slow down, and the tank figure is what decides where the ship can bunker and where she cannot.', calculate: p => {
  const fuel = p.consumptionTPerDay * p.hours / 24, cost = fuel * p.fuelPricePerT;
  const daysOnTank = p.tankT / Math.max(p.consumptionTPerDay, .001), nmPerDay = p.rangeNm / Math.max(daysOnTank, .01);
  return O('Fuel for the passage', fuel, 't', [
    M('Cost of the fuel', cost, '$'),
    M('Days of steaming on a full tank', daysOnTank, 'days'),
    M('Fuel a mile', p.consumptionTPerDay * 1000 / Math.max(nmPerDay, .01), 'kg'),
    M('Cost a mile', p.consumptionTPerDay * 1000 / Math.max(nmPerDay, .01) * p.fuelPricePerT / 1000, '$'),
    M('Fuel if the passage takes 24 hours longer', p.consumptionTPerDay * (p.hours + 24) / 24, 't'),
    M('Reading', fuel > p.tankT ? 'More fuel than the tank holds, a bunker stop is needed on the way' : 'A passage that fits the tank with margin', '')]);
}, references: [T('Twenty-eight tonnes a day over forty-eight hours', {consumptionTPerDay:28,hours:48,fuelPricePerT:620,tankT:1800,rangeNm:12000}, 28 * 48 / 24), T('The same passage on a slower 22 tonnes a day', {consumptionTPerDay:22,hours:48,fuelPricePerT:620,tankT:1800,rangeNm:12000}, 22 * 48 / 24)] }),
D({ id: 'port-berth-occupancy', sweep: 'calls', fields: [F('calls','Vessel calls a year',600,10,20000,10),F('serviceHours','Hours on the berth a call',18,1,120,.5),F('berths','Berths available',4,1,40,1),F('daysYear','Days in the year',365,100,366,1),F('targetUtilisationPct','Utilisation you are working to (%)',70,40,90,1)], equation:'utilisation=the berth hours used÷the berth hours available', note:'How full a berth group is through the year, and what that utilisation costs the ships waiting outside. Waiting rises very steeply as utilisation climbs, so a terminal at eighty per cent has far longer queues than one at sixty, and the target figure is a commercial choice rather than a technical one.', calculate: p => {
  const utilisation = berthUtilisationPct(p.calls, p.serviceHours, p.berths, p.daysYear), wait = berthWaitHours(p.calls, p.serviceHours, p.berths, p.daysYear);
  const berthsForTarget = Math.ceil(p.calls * p.serviceHours / Math.max(p.targetUtilisationPct / 100 * p.daysYear * 24, .001));
  return O('Berth utilisation', utilisation, '%', [
    M('Waiting time a call', wait, 'h'),
    M('Berth hours used a year', p.calls * p.serviceHours, 'h'),
    M('Berths for the target utilisation', berthsForTarget, 'berths'),
    M('Calls the berths can take at the target', p.targetUtilisationPct / 100 * p.berths * p.daysYear * 24 / Math.max(p.serviceHours, .001), 'calls'),
    M('Waiting with a fifth berth', berthWaitHours(p.calls, p.serviceHours, p.berths + 1, p.daysYear), 'h'),
    M('Reading', utilisation > 80 ? 'A terminal that is full, the queue will be the complaint' : utilisation > p.targetUtilisationPct ? 'Above the utilisation you are working to' : 'Utilisation inside the target', '')]);
}, references: [T('Six hundred calls of eighteen hours over four berths', {calls:600,serviceHours:18,berths:4,daysYear:365,targetUtilisationPct:70}, berthUtilisationPct(600,18,4,365)), T('A busier nine hundred calls a year', {calls:900,serviceHours:18,berths:4,daysYear:365,targetUtilisationPct:70}, berthUtilisationPct(900,18,4,365))] })
];